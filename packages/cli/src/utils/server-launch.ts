import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  parseDuration,
} from "@actiondock/core/project";
import type { ServerViewOptions } from "@actiondock/core/server";
import { ArgumentError } from "../errors";
import { writeStderr, writeStdout } from "../renderer";
import type { CliContext } from "../types";
import { parseByteSize } from "./utils";

/**
 * 服务类命令（ad serve、ad mcp serve、ad mcp、ad run）的共享启动脚手架（单一事实源）。
 *
 * 收敛端口/主机/token 解析（含 ACTIONDOCK_TOKEN 环境变量回退）、
 * maxBodyBytes 与 timeoutMs 的 try-catch 包装、corsOrigins 归一化、
 * 停止信号注册与横幅打印，消除 serve.ts 与 mcp.ts 的逐行重复。
 */

/**
 * 解析监听端口：解析失败时回退缺省端口。
 *
 * @param rawPort 命令行原始端口串
 * @param defaultPort 缺省端口（ad serve 为 5177，ad mcp serve 为 5178）
 * @param falsyFallsBack 是否对零值也回退（mcp serve 旧行为为 parseInt || default，
 *   端口 0 会回退缺省；ad serve 为 NaN 判定，端口 0 保留）
 */
export function resolveServerPort(
  rawPort: string,
  defaultPort: number,
  falsyFallsBack?: boolean
): number {
  const parsed = parseInt(rawPort, 10);
  if (falsyFallsBack) {
    return parsed || defaultPort;
  }
  return Number.isNaN(parsed) ? defaultPort : parsed;
}

/**
 * 解析监听主机：未指定时回退 127.0.0.1。
 */
export function resolveServerHost(rawHost: string | undefined): string {
  return rawHost || "127.0.0.1";
}

/**
 * 解析鉴权 Token：显式参数优先，其次 --token-env 指定的环境变量，最后 ACTIONDOCK_TOKEN 兜底。
 *
 * @param token 显式 -t/--token 参数
 * @param tokenEnv --token-env 指定的环境变量名
 */
export function resolveServerToken(token?: string, tokenEnv?: string): string | undefined {
  return (
    token ||
    (tokenEnv && typeof process !== "undefined" ? process.env?.[tokenEnv] : undefined) ||
    (typeof process !== "undefined" ? process.env?.ACTIONDOCK_TOKEN : undefined)
  );
}

/**
 * 解析请求体大小上限（--max-body）：格式非法时抛 ArgumentError。
 */
export function resolveMaxBodyBytes(maxBody: string | undefined): number | undefined {
  if (!maxBody) return undefined;
  try {
    return parseByteSize(maxBody);
  } catch (err: any) {
    throw new ArgumentError(`Invalid max-body format: ${err.message}`);
  }
}

/**
 * 解析执行超时（--timeout）：格式非法时抛 ArgumentError。
 */
export function resolveTimeoutMs(timeout: string | undefined): number | undefined {
  if (!timeout) return undefined;
  try {
    return parseDuration(timeout);
  } catch (err: any) {
    throw new ArgumentError(`Invalid timeout format: ${err.message}`);
  }
}

/**
 * 归一化 CORS 来源列表：空列表归一为 undefined。
 */
export function normalizeCorsOrigins(corsOrigin: string[] | undefined): string[] | undefined {
  return corsOrigin && corsOrigin.length > 0 ? corsOrigin : undefined;
}

/**
 * 注册 SIGINT/SIGTERM 停止信号处理器（serve 与 mcp serve 共享同一语义）。
 *
 * 停止失败必须可见：写入 stderr 一行并标记失败退出码；
 * 无论成功与否最终强制进程退出。
 *
 * @param server 目标服务实例（提供 stop 方法）
 * @param serverName 横幅与停止消息中的服务名（如 ActionDock server / MCP HTTP server）
 */
export function registerStopSignalHandler(
  server: { stop(): Promise<unknown> | unknown },
  serverName: string,
  context?: CliContext
): void {
  const stopSignalHandler = () => {
    writeStdout(`\nStopping ${serverName}...`, context);
    Promise.resolve(server.stop())
      .catch((err: unknown) => {
        // 停止失败必须可见：写入 stderr 一行并标记失败退出码
        writeStderr(
          `[ERROR] Failed to stop ${serverName} gracefully: ${err instanceof Error ? err.message : String(err)}`,
          context
        );
        process.exitCode = 1;
      })
      .finally(() => {
        process.exit(typeof process.exitCode === "number" ? process.exitCode : 0);
      });
  };

  process.once("SIGINT", stopSignalHandler);
  process.once("SIGTERM", stopSignalHandler);
}

/**
 * 虚拟视图简要展示信息。
 */
export interface ServerViewSummary {
  name: string;
  enableMcp?: boolean;
}

/**
 * 打印服务横幅的可选配置参数。
 */
export interface PrintServerBannerOptions {
  views?: Record<string, ServerViewOptions> | ServerViewOptions[];
  endpointHost?: string;
  enableMcp?: boolean;
}

/**
 * 从指定文件路径加载虚拟视图配置字典。
 *
 * @param filePath 视图配置文件路径
 * @returns 解析后的视图字典或数组
 */
export function loadViewsFromFile(
  filePath: string
): Record<string, ServerViewOptions> | ServerViewOptions[] {
  const resolvedPath = resolve(filePath);
  if (!existsSync(resolvedPath)) {
    throw new ArgumentError(`Views file not found: ${resolvedPath}`);
  }
  let parsed: unknown;
  try {
    const content = readFileSync(resolvedPath, "utf-8");
    parsed = JSON.parse(content);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new ArgumentError(`Failed to read views file: ${msg}`);
  }

  if (!parsed || typeof parsed !== "object") {
    throw new ArgumentError("Invalid views file: expected a JSON object or array");
  }

  if (Array.isArray(parsed)) {
    return parsed as ServerViewOptions[];
  }

  const obj = parsed as Record<string, unknown>;
  if (obj.views && typeof obj.views === "object") {
    return obj.views as Record<string, ServerViewOptions> | ServerViewOptions[];
  }
  if (obj.server && typeof obj.server === "object" && (obj.server as Record<string, unknown>).views) {
    const srv = obj.server as Record<string, unknown>;
    return srv.views as Record<string, ServerViewOptions> | ServerViewOptions[];
  }

  return parsed as Record<string, ServerViewOptions>;
}

/**
 * 合并项目配置与独立配置文件中的虚拟视图定义。
 * 命令行 --views-file 优先级高于项目配置文件 actiondock.json 中的 server.views。
 *
 * @param configViews 项目配置中的 views
 * @param fileViews 独立配置文件中的 views
 */
export function mergeServerViews(
  configViews?: Record<string, ServerViewOptions> | ServerViewOptions[],
  fileViews?: Record<string, ServerViewOptions> | ServerViewOptions[]
): Record<string, ServerViewOptions> | ServerViewOptions[] | undefined {
  if (!configViews && !fileViews) {
    return undefined;
  }
  if (!configViews) {
    return fileViews;
  }
  if (!fileViews) {
    return configViews;
  }

  if (!Array.isArray(configViews) && !Array.isArray(fileViews)) {
    return { ...configViews, ...fileViews };
  }

  const merged: Record<string, ServerViewOptions> = {};
  const addEntry = (item: ServerViewOptions, fallbackKey: string) => {
    const key = item.name?.trim() || fallbackKey;
    merged[key] = { ...item, name: key };
  };

  if (Array.isArray(configViews)) {
    configViews.forEach((item, index) => addEntry(item, item.name || `view_${index}`));
  } else {
    Object.entries(configViews).forEach(([k, v]) => addEntry(v, k));
  }

  if (Array.isArray(fileViews)) {
    fileViews.forEach((item, index) => addEntry(item, item.name || `view_${index}`));
  } else {
    Object.entries(fileViews).forEach(([k, v]) => addEntry(v, k));
  }

  return merged;
}

/**
 * 从服务视图配置中提取所有命名空间视图列表（排除 default 默认视图）。
 *
 * @param views 视图字典或数组
 * @returns 命名空间视图简要信息列表
 */
export function extractNamespacedViews(
  views?: Record<string, ServerViewOptions> | ServerViewOptions[]
): ServerViewSummary[] {
  if (!views) return [];
  const result: ServerViewSummary[] = [];

  if (Array.isArray(views)) {
    for (let i = 0; i < views.length; i++) {
      const item = views[i];
      if (!item) continue;
      const name = item.name?.trim() || `view_${i}`;
      if (name === "default") continue;
      result.push({
        name,
        enableMcp: item.enableMcp,
      });
    }
  } else if (typeof views === "object") {
    for (const [key, item] of Object.entries(views)) {
      if (!item) continue;
      const name = item.name?.trim() || key.trim();
      if (name === "default") continue;
      result.push({
        name,
        enableMcp: item.enableMcp,
      });
    }
  }

  return result;
}

/**
 * 打印服务命名空间虚拟视图列表。
 *
 * @param views 视图配置字典或数组
 * @param scheme 访问协议（http 或 https）
 * @param endpointHost 面向调用的端点主机地址
 * @param port 监听端口
 * @param context CLI 上下文
 * @param options 额外选项（如全局 enableMcp）
 */
export function printServerViews(
  views: Record<string, ServerViewOptions> | ServerViewOptions[] | undefined,
  scheme: string,
  endpointHost: string,
  port: number,
  context?: CliContext,
  options?: { enableMcp?: boolean }
): void {
  const namespaced = extractNamespacedViews(views);
  if (namespaced.length === 0) {
    return;
  }

  writeStdout(`  * Views:`, context);
  for (const v of namespaced) {
    const encodedName = encodeURIComponent(v.name);
    writeStdout(`    - ${v.name}:`, context);
    writeStdout(`      - HTTP Root:    ${scheme}://${endpointHost}:${port}/views/${encodedName}`, context);
    const mcpEnabled = options?.enableMcp !== false && v.enableMcp !== false;
    const mcpDesc = mcpEnabled
      ? `${scheme}://${endpointHost}:${port}/views/${encodedName}/mcp`
      : "Disabled";
    writeStdout(`      - MCP Endpoint: ${mcpDesc}`, context);
  }
}

/**
 * 打印服务就绪横幅（顶部固定段，支持展示命名空间视图）。
 *
 * @param title 横幅主体标题（如 ActionDock 2.0 HTTP Runner Server）
 * @param scheme 端点协议（http 或 https）
 * @param displayHost 面向展示的主机地址
 * @param port 实际监听端口
 * @param contextOrOptions 命令行上下文或横幅配置选项
 * @param maybeOptions 横幅配置选项（包含 views 等信息）
 */
export function printServerBanner(
  title: string,
  scheme: string,
  displayHost: string,
  port: number,
  contextOrOptions?: CliContext | PrintServerBannerOptions,
  maybeOptions?: PrintServerBannerOptions
): void {
  let context: CliContext | undefined;
  let options: PrintServerBannerOptions | undefined;

  if (
    contextOrOptions &&
    ("views" in contextOrOptions || "endpointHost" in contextOrOptions || "enableMcp" in contextOrOptions)
  ) {
    options = contextOrOptions as PrintServerBannerOptions;
  } else {
    context = contextOrOptions as CliContext | undefined;
    options = maybeOptions;
  }

  writeStdout(`\n======================================================`, context);
  writeStdout(`  ${title}`, context);
  writeStdout(`======================================================`, context);
  writeStdout(`  * Listening on:    ${scheme}://${displayHost}:${port}`, context);

  if (options?.views) {
    const endpointHost = options.endpointHost || displayHost;
    printServerViews(options.views, scheme, endpointHost, port, context, {
      enableMcp: options.enableMcp,
    });
  }
}

