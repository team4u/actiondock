import {
  createActionDockTarget,
  findProjectRoot,
  resolvePackageRoot,
  resolveTarget,
  type ActionDockTarget,
  type ResolvedTarget,
} from "@actiondock/core";
import { createNodePlatform } from "@actiondock/runtime-node";
import type { Command } from "commander";
import type { CliContext } from "../types";

/**
 * 统一为 Commander 命令节点挂载目标环境解析相关选项（单一事实源）。
 * 包括：-p/--profile, -s/--server, -t/--token, -k/--insecure, --allow-insecure-http。
 *
 * @param command 目标 Commander 命令节点
 * @returns 挂载选项后的命令节点
 */
export function applyTargetOptions(command: Command): Command {
  return command
    .option("-p, --profile <name>", "Query or execute against a specific profile")
    .option("-s, --server <url>", "Remote server URL")
    .option("-t, --token <token>", "Auth token for remote server")
    .option("-k, --insecure", "Allow insecure server connections (skip TLS certificate validation)")
    .option("--allow-insecure-http", "Allow sending auth token over unencrypted HTTP to non-loopback hosts");
}

/**
 * 目标解析与 Target 创建所需的统一选项视图。
 * 与既有命令内联解析逻辑保持逐字段一致，作为唯一事实源供各命令复用。
 */
export interface TargetResolutionOptions {
  /** 显式指定的包标识或路径（对应 -P, --package） */
  package?: string;
  /** 远端 Profile 名称（对应 -p, --profile） */
  profile?: string;
  /** 远端服务地址（对应 -s, --server） */
  server?: string;
  /** 远端鉴权 Token（对应 -t, --token） */
  token?: string;
  /** 自定义数据目录（对应 --data-dir） */
  dataDir?: string;
  /** 是否跳过 TLS 证书合法性校验（对应 -k, --insecure） */
  insecure?: boolean;
  /** 是否允许向非回环地址发送明文 HTTP 请求（对应 --allow-insecure-http） */
  allowInsecureHttp?: boolean;
}

/**
 * 高阶目标执行辅助：统一封装「目标解析 → Target 创建 → 业务回调 → try/finally close」样板。
 *
 * 回调获得创建好的 target 与解析后的目标拓扑信息；无论回调成功或抛出，
 * 都保证 target 资源被正确释放，业务异常原样透传。
 *
 * @param options 命令选项视图（profile/server/token/package/dataDir/insecure/allowInsecureHttp）
 * @param context CLI 上下文
 * @param fn 业务回调（target 为已创建的门面实例，resolved 为拓扑解析结果）
 * @param localOptions 本地分支附加选项（如 scanLinkedPackages）与 localRoot 回退策略
 */
export async function withTarget(
  options: TargetResolutionOptions,
  context: CliContext | undefined,
  fn: (target: ActionDockTarget, resolved: ResolvedTarget) => Promise<void>,
  localOptions?: {
    /** 本地工程根目录（支持惰性工厂，仅在 local 分支求值）；未提供时按 findProjectRoot 回退 */
    localRoot?: string | (() => string | undefined);
    /** 是否扫描全局链接包（对应 scanLinkedPackages） */
    scanLinkedPackages?: boolean;
  }
): Promise<void> {
  const resolved = resolveTarget(
    {
      profile: options.profile,
      server: options.server,
      token: options.token,
      insecure: options.insecure,
      allowInsecureHttp: options.allowInsecureHttp,
    },
    context?.customHome
  );

  // localRoot 仅在 local 分支求值，避免远端模式下触发包寻址副作用
  const localRoot =
    resolved.type === "local"
      ? (typeof localOptions?.localRoot === "function" ? localOptions.localRoot() : localOptions?.localRoot) ??
        findProjectRoot() ??
        undefined
      : undefined;

  const target = await createActionDockTarget(
    resolved.type === "remote"
      ? {
          type: "remote",
          serverUrl: resolved.serverUrl!,
          token: resolved.token,
          insecure: resolved.insecure,
          allowInsecureHttp: resolved.allowInsecureHttp ?? options.allowInsecureHttp,
        }
      : {
          type: "local",
          projectRoot: localRoot,
          customHome: context?.customHome,
          dataDir: options.dataDir || context?.dataDir,
          platform: createNodePlatform({
            customHome: context?.customHome,
            dataDir: options.dataDir || context?.dataDir,
            rootDir: localRoot,
          }),
          ...(localOptions?.scanLinkedPackages !== undefined
            ? { scanLinkedPackages: localOptions.scanLinkedPackages }
            : undefined),
        }
  );

  try {
    await fn(target, resolved);
  } finally {
    await target.close();
  }
}

/**
 * 仅远端模式目标执行辅助：创建远端 Target 并保证资源释放。
 * 适用于 runs cancel 等明确要求远端目标的命令。
 */
export async function withRemoteTarget(
  options: TargetResolutionOptions,
  context: CliContext | undefined,
  fn: (target: ActionDockTarget, resolved: ResolvedTarget) => Promise<void>
): Promise<void> {
  const resolved = resolveTarget(
    {
      profile: options.profile,
      server: options.server,
      token: options.token,
      insecure: options.insecure,
      allowInsecureHttp: options.allowInsecureHttp,
    },
    context?.customHome
  );

  const target = await createActionDockTarget({
    type: "remote",
    serverUrl: resolved.serverUrl!,
    token: resolved.token,
    insecure: resolved.insecure,
    allowInsecureHttp: resolved.allowInsecureHttp ?? options.allowInsecureHttp,
  });

  try {
    await fn(target, resolved);
  } finally {
    await target.close();
  }
}

/**
 * 目标包根目录解析（含 -P 显式寻址与当前工程回退）。
 * 供命令在创建 Target 前统一完成包寻址，返回 null 表示当前目录无工程。
 */
export function resolveLocalPackageRoot(pkgId?: string): string | null {
  if (pkgId) {
    return resolvePackageRoot(pkgId);
  }
  return findProjectRoot();
}
