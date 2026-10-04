/**
 * 工程脚本共享的语义化版本纯函数库。
 * 直接复用核心纯函数模块，不依赖构建产物或加载钩子。
 */
import { parseSemVer, type SemVer } from "../../packages/core/src/utils/semver.ts";

export type Semver = SemVer;

/**
 * 解析语义化版本号（容忍可选的 v/= 前缀），非法输入抛出错误。
 */
export function parseSemver(v: string): Semver {
  const parsed = parseSemVer(v);
  if (!parsed) {
    throw new Error(`非法的语义化版本号: '${v}'`);
  }
  return parsed;
}

/**
 * 校验语义化版本号（容忍可选的 v/= 前缀），返回去除前缀后的规范版本串，非法输入返回 null。
 */
export function normalizeSemver(v: string): string | null {
  const parsed = parseSemVer(v);
  if (!parsed) return null;
  return `${parsed.major}.${parsed.minor}.${parsed.patch}${parsed.prerelease ? `-${parsed.prerelease}` : ""}`;
}

export type BumpType = "patch" | "minor" | "major" | "prerelease";

/**
 * 按指定类型递增版本号。prerelease 类型在已有预发布后缀时递增其序号，
 * 否则从 patch 递增并附加 `${preId}.0`。
 */
export function bumpSemver(current: string, type: BumpType, preId = "beta"): string {
  const parsed = parseSemver(current);
  if (type === "major") {
    return `${parsed.major + 1}.0.0`;
  }
  if (type === "minor") {
    return `${parsed.major}.${parsed.minor + 1}.0`;
  }
  if (type === "patch") {
    if (parsed.prerelease) {
      return `${parsed.major}.${parsed.minor}.${parsed.patch}`;
    }
    return `${parsed.major}.${parsed.minor}.${parsed.patch + 1}`;
  }
  if (type === "prerelease") {
    if (parsed.prerelease) {
      const match = parsed.prerelease.match(/^(.*?)(?:\.(\d+))?$/);
      if (match) {
        const id = match[1];
        const num = match[2] ? parseInt(match[2], 10) + 1 : 0;
        return `${parsed.major}.${parsed.minor}.${parsed.patch}-${id}.${num}`;
      }
    }
    return `${parsed.major}.${parsed.minor}.${parsed.patch + 1}-${preId}.0`;
  }
  return current;
}

/**
 * 从版本号解析预发布分发标签（如 `2.0.9-beta.0` 提取 `beta`），非预发布返回 null。
 */
export function extractPrereleaseTag(version: string): string | null {
  const parsed = parseSemVer(version);
  if (!parsed || !parsed.prerelease) return null;
  const match = parsed.prerelease.match(/^([a-zA-Z]+)(?:\.|\b)/);
  return match ? match[1].toLowerCase() : null;
}
