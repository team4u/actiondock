import {
  resolvePackageRoot,
} from "@actiondock/core/registry";
import {
  findProjectRoot,
  loadProjectConfig,
} from "@actiondock/core";
import {
  loadManifest,
  type ActionDockManifest,
  type ProjectTransaction,
} from "@actiondock/core/project";
import { resolve } from "node:path";
import { ArgumentError, ExecutionError, notInProjectError, packageNotFoundError, wrapAsExecutionError } from "../errors";

/**
 * 「未显式指定包且当前目录无工程」的统一补救提示（单一事实源）。
 */
export const PACKAGE_HINT_MESSAGE =
  "Please specify -P, --package <id> or cd into a project directory.";

/**
 * 远端目标拓扑的最小字段视图（与 core 的 ResolvedTarget 远端分支兼容）。
 */
export interface RemoteTargetLike {
  serverUrl?: string;
  profileName?: string;
}

/**
 * 拼接远端目标标题后缀（单一事实源）。
 *
 * 形如 `on remote server <url> (Profile: <name>)`，供列表类命令的
 * 标题拼接复用（如 `Actions ${remoteTargetSuffix(target)}`），
 * 消除五处同构模板漂移。
 *
 * @param resolved 目标拓扑解析结果（远端分支）
 */
export function remoteTargetSuffix(resolved: RemoteTargetLike): string {
  const profile = resolved.profileName ? ` (Profile: ${resolved.profileName})` : "";
  return `on remote server ${resolved.serverUrl}${profile}`;
}

/**
 * 拼接远端目标标题标签（单一事实源）。
 *
 * 形如 `Remote Server <url> (Profile: <name>)`，与 remoteTargetSuffix 共享
 * 同一拼接实现，供 state、config 等直接以远端目标为标题主体的命令复用。
 *
 * @param resolved 目标拓扑解析结果（远端分支）
 */
export function remoteTargetLabel(resolved: RemoteTargetLike): string {
  return `Remote Server ${resolved.serverUrl}${
    resolved.profileName ? ` (Profile: ${resolved.profileName})` : ""
  }`;
}

/**
 * 解析意图字符串（从显式 --intent 或位置模式参数聚合）。
 * 多个关键字使用 '|'（正则逻辑或）连接。
 */
export function resolveIntent(
  optionsIntent?: string,
  positionalPatterns?: string[]
): string | undefined {
  const parts: string[] = [];
  if (optionsIntent && optionsIntent.trim()) {
    parts.push(optionsIntent.trim());
  }
  if (positionalPatterns && positionalPatterns.length > 0) {
    for (const p of positionalPatterns) {
      if (typeof p === "string" && p.trim()) {
        parts.push(p.trim());
      }
    }
  }
  if (parts.length === 0) return undefined;
  if (parts.length === 1) return parts[0];
  return parts.join("|");
}

/**
 * 解析人类可读的字节大小字符串为整数字节数。
 * 例如：'1mb' -> 1048576, '500kb' -> 512000, '1048576' -> 1048576
 */
export function parseByteSize(str: string): number {
  const trimmed = str.trim().toLowerCase();
  const match = trimmed.match(/^(\d+(?:\.\d+)?)\s*([a-z]+)?$/);
  if (!match) {
    const num = Number(trimmed);
    if (!isNaN(num) && num > 0) return num;
    throw new ArgumentError(`Invalid byte size format: '${str}'. Examples: '1mb', '500kb', '1048576'`);
  }

  const value = parseFloat(match[1]);
  const unit = match[2] || "b";

  switch (unit) {
    case "b":
    case "bytes":
      return Math.floor(value);
    case "k":
    case "kb":
    case "kib":
      return Math.floor(value * 1024);
    case "m":
    case "mb":
    case "mib":
      return Math.floor(value * 1024 * 1024);
    case "g":
    case "gb":
    case "gib":
      return Math.floor(value * 1024 * 1024 * 1024);
    default:
      throw new ArgumentError(`Unsupported byte size unit '${unit}' in '${str}'`);
  }
}

/**
 * 将逗号分隔或多次指定的选项转换为字符串数组。
 */
export function parseListOption(val: string, prev: string[] = []): string[] {
  const parts = val.split(",").map((s) => s.trim()).filter(Boolean);
  return [...prev, ...parts];
}

/**
 * 根据 Package 选项或键前缀解析目标工程物理根目录。
 */
export function getTargetRoot(
  packageOption?: string,
  keyHint?: string
): { root: string; key: string } {
  let targetPackage = packageOption;
  let effectiveKey = keyHint || "";

  if (!targetPackage && keyHint && keyHint.includes("/")) {
    const slashIdx = keyHint.lastIndexOf("/");
    targetPackage = keyHint.slice(0, slashIdx);
    effectiveKey = keyHint.slice(slashIdx + 1);
  }

  const root = resolvePackageRoot(targetPackage) || (targetPackage ? null : findProjectRoot());
  if (!root) {
    if (targetPackage) {
      throw packageNotFoundError(targetPackage);
    } else {
      throw notInProjectError(PACKAGE_HINT_MESSAGE);
    }
  }
  return { root, key: effectiveKey };
}

/**
 * 包根目录寻址脚手架（单一事实源）：显式指定包且寻址失败抛 packageNotFoundError，
 * 未指定包且当前目录无工程抛 notInProjectError（附带 -P 补救提示）。
 *
 * 与 getTargetRoot 的差异：不消费 pkg/ 键前缀提示，寻址失败必抛错而非返回 null；
 * 与 resolveLocalPackageRoot 的差异：后者保留 null 返回值供降级视图使用；
 * 与 resolveLocalRunScope 的差异：后者在工程清单损坏时降级为链接包视图而非报错，语义不同不并入。
 */

/** requirePackageRoot 的返回视图（未请求加载工程配置时仅含根目录）。 */
export interface PackageRootScope {
  /** 目标包根目录 */
  root: string;
}

/** requirePackageRoot 的返回视图（loadConfig 为真时附带非空工程配置）。 */
export interface PackageRootWithConfigScope {
  /** 目标包根目录 */
  root: string;
  /** 目标工程配置（仅在 loadConfig 为真时返回，值恒存在） */
  projConfig: ReturnType<typeof loadProjectConfig>;
}

/**
 * 解析目标包根目录（重载入口：loadConfig 为真时一并返回工程配置）。
 *
 * @param packageOption 显式指定的包标识或路径（对应 -P, --package）
 * @param options 可选项：loadConfig 请求加载工程配置；hint 覆盖无工程时的补救提示行
 */

export function requirePackageRoot(
  packageOption: string | undefined,
  options: { loadConfig: true; hint?: string }
): PackageRootWithConfigScope;
export function requirePackageRoot(
  packageOption: string | undefined,
  options?: { loadConfig?: false; hint?: string }
): PackageRootScope;
export function requirePackageRoot(
  packageOption: string | undefined,
  options?: { loadConfig?: boolean; hint?: string }
): PackageRootScope | PackageRootWithConfigScope {
  const root = packageOption ? resolvePackageRoot(packageOption) : findProjectRoot();
  if (!root) {
    if (packageOption) {
      throw packageNotFoundError(packageOption);
    }
    throw notInProjectError(options?.hint ?? PACKAGE_HINT_MESSAGE);
  }
  return options?.loadConfig
    ? { root, projConfig: loadProjectConfig(root) }
    : { root };
}

/**
 * 依赖类命令（ad add / ad remove）的工程根目录与清单解析脚手架（单一事实源）。
 *
 * 与 requirePackageRoot 的差异：-P 语义为工程目录路径而非包标识，
 * 显式路径不做注册表寻址（不抛 packageNotFoundError，缺失清单由后续存在性检查报错）。
 *
 * @param packageOption 显式指定的工程目录路径（对应 -P, --package <path>）
 * @returns 工程根目录与已验存的 actiondock.json 清单
 */
export function requireProjectManifestRoot(packageOption: string | undefined): {
  root: string;
  manifest: ActionDockManifest;
} {
  const root = packageOption ? resolve(packageOption) : findProjectRoot();

  if (!root) {
    throw notInProjectError(
      "Please specify -P, --package <path> or cd into a project directory."
    );
  }

  const manifest = loadManifest(root);
  if (!manifest) {
    throw new ArgumentError(`actiondock.json not found in ${root}`);
  }

  return { root, manifest };
}

/**
 * 依赖事务失败回滚辅助（ad add / ad remove 共享）：回滚事务后按统一规则透传异常。
 *
 * 回滚与包裹规则：
 * - 先执行事务回滚快照，保留原始磁盘状态；
 * - ActionDockError 与 CliError 原样透传（保留 code 与 details）；
 * - 其余包裹为 ExecutionError 并保留原始 code，缺省时回退 fallbackCode。
 *
 * @param tx 已开启的工程事务快照
 * @param err 业务回调抛出的原始异常
 * @param fallbackCode 包裹分支缺省错误码（命令专属，如 ADD_DEPENDENCY_FAILED）
 */
export async function rollbackAndRethrow(
  tx: ProjectTransaction,
  err: unknown,
  fallbackCode: string
): Promise<never> {
  await tx.rollback({ frozenInstall: false });
  const passthrough = wrapAsExecutionError(err);
  if (passthrough !== err) {
    const original = err as { message: string; code?: string };
    throw new ExecutionError(original.message, err, original.code || fallbackCode);
  }
  throw passthrough;
}

/**
 * 聚合命令自身选项与根程序全局选项（如 --json、--data-dir 等）。
 */
export function getEffectiveOptions(rawOptions: any, cmd?: any): any {
  if (cmd && typeof cmd.optsWithGlobals === "function") {
    return { ...cmd.optsWithGlobals(), ...rawOptions };
  }
  return rawOptions || {};
}

/**
 * 解析意图过滤回退策略。
 *
 * 统一事实源：机器输出模式（--json）仅在显式传 --fallback 时回退，
 * 人类交互模式默认回退（可被 --no-fallback 关闭）。
 *
 * 回退标志的显式性判定完全依据 Commander 解析结果（由调用方传入）：
 * 同时注册 --fallback 与 --no-fallback 的命令，未指定时 fallback 为
 * undefined、显式 --fallback 为 true、--no-fallback 为 false，
 * 不再直读 process.argv，消除隐藏的全局依赖。
 *
 * @param options 命令选项视图（含 fallback 与 json 字段）
 */
export function resolveFallbackStrategy(
  options: { fallback?: boolean; json?: boolean }
): { isMachine: boolean; shouldFallback: boolean } {
  const isMachine = Boolean(options.json);
  return {
    isMachine,
    shouldFallback: isMachine ? options.fallback === true : options.fallback !== false,
  };
}
