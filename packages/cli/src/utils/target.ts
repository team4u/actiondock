import {
  connectActionDock,
  createActionDock,
  createNodePlatform,
  findProjectRoot,
  resolvePackageRoot,
  resolveTarget,
  type ActionDockService,
  type ResolvedTarget,
} from "@actiondock/core";
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
 * 目标解析与 Service 创建所需的统一选项视图。
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
 * 目标拓扑解析单一入口：从命令选项视图解析远端/本地目标拓扑信息。
 *
 * 收拢全部解析字段（profile/server/token/insecure/allowInsecureHttp），
 * 消除命令间逐字段内联复制导致的漂移（如漏传 allowInsecureHttp）。
 *
 * @param options 命令选项视图（支持直接传入 Commander 解析后的 options 对象）
 * @param context CLI 上下文
 * @returns 解析后的目标拓扑信息（仅信息解析，不创建 Service 实例）
 */
export function resolveTargetFromOptions(
  options: TargetResolutionOptions,
  context?: CliContext
): ResolvedTarget {
  return resolveTarget(
    {
      profile: options.profile,
      server: options.server,
      token: options.token,
      insecure: options.insecure,
      allowInsecureHttp: options.allowInsecureHttp,
    },
    context?.customHome
  );
}

/**
 * 高阶服务执行辅助：统一封装「目标解析 → Service 创建 → 业务回调 → try/finally close」样板。
 *
 * 回调获得创建好的 service 与解析后的目标拓扑信息；无论回调成功或抛出，
 * 都保证 service 资源被正确释放，业务异常原样透传。
 *
 * 默认旁观打开：内部创建的本地 Host 以非收割模式打开存储（不置 recoverOrphans），
 * 供 ad state / ad runs / ad config 等查询命令与运行中的 serve 进程并发访问同一库；
 * 需要持有者语义的执行命令通过 localOptions.ownDataDir 显式声明。
 *
 * @param options 命令选项视图（profile/server/token/package/dataDir/insecure/allowInsecureHttp）
 * @param context CLI 上下文
 * @param fn 业务回调（service 为已创建的服务端口实例，resolved 为拓扑解析结果）
 * @param localOptions 本地分支附加选项（如 scanLinkedPackages）与 localRoot 回退策略
 */
export async function withService(
  options: TargetResolutionOptions,
  context: CliContext | undefined,
  fn: (service: ActionDockService, resolved: ResolvedTarget) => Promise<void>,
  localOptions?: {
    /** 本地工程根目录（支持惰性工厂，仅在 local 分支求值）；未提供时按 findProjectRoot 回退 */
    localRoot?: string | (() => string | undefined);
    /** 是否扫描全局链接包（对应 scanLinkedPackages） */
    scanLinkedPackages?: boolean;
    /**
     * 是否以数据目录持有者身份打开本地 Host：true 时 App 存储打开阶段收割遗留孤儿运行。
     * 执行类命令（ad run）应置 true；查询类命令（state/runs/config/list/describe）
     * 保持缺省 false，避免误收割并发 serve 进程的在途运行记录。
     */
    ownDataDir?: boolean;
  }
): Promise<void> {
  const resolved = resolveTargetFromOptions(options, context);

  // localRoot 仅在 local 分支求值，避免远端模式下触发包寻址副作用
  const localRoot =
    resolved.type === "local"
      ? (typeof localOptions?.localRoot === "function" ? localOptions.localRoot() : localOptions?.localRoot) ??
        findProjectRoot() ??
        undefined
      : undefined;

  const service =
    resolved.type === "remote"
      ? await connectActionDock({
          serverUrl: resolved.serverUrl!,
          token: resolved.token,
          insecure: resolved.insecure,
          allowInsecureHttp: resolved.allowInsecureHttp ?? options.allowInsecureHttp,
        })
      : await createActionDock({
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
          ...(localOptions?.ownDataDir === true ? { recoverOrphans: true } : undefined),
        });

  try {
    await fn(service, resolved);
  } finally {
    await service.close();
  }
}

/**
 * 仅远端模式目标执行辅助：创建远端 Service 并保证资源释放。
 * 适用于 runs cancel 等明确要求远端目标的命令。
 */
export async function withRemoteService(
  options: TargetResolutionOptions,
  context: CliContext | undefined,
  fn: (service: ActionDockService, resolved: ResolvedTarget) => Promise<void>
): Promise<void> {
  const resolved = resolveTargetFromOptions(options, context);

  const service = await connectActionDock({
    serverUrl: resolved.serverUrl!,
    token: resolved.token,
    insecure: resolved.insecure,
    allowInsecureHttp: resolved.allowInsecureHttp ?? options.allowInsecureHttp,
  });

  try {
    await fn(service, resolved);
  } finally {
    await service.close();
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
