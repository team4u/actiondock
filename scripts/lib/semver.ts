/**
 * scripts 域共享的语义化版本纯函数库（单一事实源）。
 *
 * 形态说明：scripts 不依赖任何构建产物，本库以 .ts 源 + 同名 .js 实现的
 * 双文件形态存在 —— TypeScript 检查解析 .ts 声明，Node 直接运行时解析
 * .js 实现，两侧零构建开销。修改版本逻辑时必须同步修改两个文件。
 */

export interface Semver {
  major: number;
  minor: number;
  patch: number;
  prerelease?: string;
}

const SEMVER_REGEX = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/;

/**
 * 解析语义化版本号（容忍可选的 v 前缀），非法输入抛出错误。
 */
export function parseSemver(v: string): Semver {
  const cleaned = v.trim().replace(/^v/, "");
  const match = cleaned.match(SEMVER_REGEX);
  if (!match) {
    throw new Error(`非法的语义化版本号: '${v}'`);
  }
  return {
    major: parseInt(match[1], 10),
    minor: parseInt(match[2], 10),
    patch: parseInt(match[3], 10),
    prerelease: match[4],
  };
}

/**
 * 校验语义化版本号（容忍可选的 v 前缀），返回去除前缀后的规范版本串，非法输入返回 null。
 */
export function normalizeSemver(v: string): string | null {
  const cleaned = v.trim().replace(/^v/, "");
  return SEMVER_REGEX.test(cleaned) ? cleaned : null;
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
  const match = version.match(/-([a-zA-Z]+)(?:\.|\b)/);
  return match ? match[1].toLowerCase() : null;
}
