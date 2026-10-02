/**
 * scripts 域共享的语义化版本纯函数库（与 core parseSemVer 单一事实源对齐）。
 * 本文件为 Node 直接运行时实现，与 semver.ts 声明保持同步（见该文件头部形态说明）。
 */

function parseSemVer(v) {
  const match = v.trim().replace(/^[v=]/, "").match(/^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/);
  if (!match) return null;
  return {
    major: parseInt(match[1], 10),
    minor: parseInt(match[2], 10),
    patch: parseInt(match[3], 10),
    prerelease: match[4],
  };
}

export function parseSemver(v) {
  const parsed = parseSemVer(v);
  if (!parsed) {
    throw new Error(`非法的语义化版本号: '${v}'`);
  }
  return parsed;
}

export function normalizeSemver(v) {
  const parsed = parseSemVer(v);
  if (!parsed) return null;
  return `${parsed.major}.${parsed.minor}.${parsed.patch}${parsed.prerelease ? `-${parsed.prerelease}` : ""}`;
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
  const parsed = parseSemVer(version);
  if (!parsed || !parsed.prerelease) return null;
  const match = parsed.prerelease.match(/^([a-zA-Z]+)(?:\.|\b)/);
  return match ? match[1].toLowerCase() : null;
}
