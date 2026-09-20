/**
 * scripts 域共享的语义化版本纯函数库（单一事实源）。
 * 本文件为 Node 直接运行时实现，与 semver.ts 类型声明保持同步（见该文件头部形态说明）。
 */

const SEMVER_REGEX = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/;

export function parseSemver(v) {
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

export function normalizeSemver(v) {
  const cleaned = v.trim().replace(/^v/, "");
  return SEMVER_REGEX.test(cleaned) ? cleaned : null;
}

export function bumpSemver(current, type, preId = "beta") {
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

export function extractPrereleaseTag(version) {
  const match = version.match(/-([a-zA-Z]+)(?:\.|\b)/);
  return match ? match[1].toLowerCase() : null;
}
