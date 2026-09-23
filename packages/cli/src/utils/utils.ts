import {
  resolvePackageRoot,
} from "@actiondock/core/registry";
import {
  findProjectRoot,
} from "@actiondock/core";
import { ArgumentError, notInProjectError, packageNotFoundError } from "../errors";

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
      throw notInProjectError(
        "Please specify -P, --package <id> or cd into a project directory."
      );
    }
  }
  return { root, key: effectiveKey };
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
