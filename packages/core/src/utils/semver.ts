/**
 * 语义化版本元数据结构。
 */
export interface SemVer {
  major: number;
  minor: number;
  patch: number;
  prerelease?: string;
}

/**
 * 解析基础 SemVer 版本字符串（单一事实源）。
 * 仅接受可选 v/= 前缀的严格三段式语义化版本，可携带预发布后缀；
 * 其余形态（两段式、非数值等）返回 null，由调用方自行兜底。
 *
 * 本模块不依赖任何 Node 内建与 core 领域模块，可在无 loader 的原生
 * Node 直接以 .ts 形态导入（工程脚本域复用此处单一事实源）。
 */
export function parseSemVer(v: string): SemVer | null {
  const match = v.trim().replace(/^[v=]/, "").match(/^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/);
  if (!match) return null;
  return {
    major: parseInt(match[1], 10),
    minor: parseInt(match[2], 10),
    patch: parseInt(match[3], 10),
    prerelease: match[4],
  };
}
