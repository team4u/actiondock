import { resolvePackageRoot, findProjectRoot } from "@actiondock/core";
import { ArgumentError } from "./errors";

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
    const slashIdx = keyHint.indexOf("/");
    targetPackage = keyHint.slice(0, slashIdx);
    effectiveKey = keyHint.slice(slashIdx + 1);
  }

  const root = resolvePackageRoot(targetPackage) || (targetPackage ? null : findProjectRoot());
  if (!root) {
    if (targetPackage) {
      throw new ArgumentError(`Package '${targetPackage}' not found in linked packages or path`);
    } else {
      throw new ArgumentError(
        "Not in an ActionDock project (actiondock.json not found). Please specify -P, --package <id> or cd into a project directory."
      );
    }
  }
  return { root, key: effectiveKey };
}

/**
 * 聚合命令自身选项与根程序全局选项（如 --json、--envelope、--data-dir 等）。
 */
export function getEffectiveOptions(rawOptions: any, cmd?: any): any {
  if (cmd && typeof cmd.optsWithGlobals === "function") {
    return { ...cmd.optsWithGlobals(), ...rawOptions };
  }
  return rawOptions || {};
}
