import {
  parseDuration,
} from "@actiondock/core/project";
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
 * 打印服务就绪横幅（顶部固定段，serve 与 mcp serve 共享排版）。
 *
 * @param title 横幅主体标题（如 ActionDock 2.0 HTTP Runner Server）
 * @param scheme 端点协议（http 或 https）
 * @param displayHost 面向展示的主机地址
 * @param port 实际监听端口
 */
export function printServerBanner(
  title: string,
  scheme: string,
  displayHost: string,
  port: number,
  context?: CliContext
): void {
  writeStdout(`\n======================================================`, context);
  writeStdout(`  ${title}`, context);
  writeStdout(`======================================================`, context);
  writeStdout(`  * Listening on:    ${scheme}://${displayHost}:${port}`, context);
}
