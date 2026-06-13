/**
 * 任务手册表单/发布相关的纯函数工具。
 * <p>
 * 供 PlaybookPage、PlaybookFormDrawer、PlaybookPublishDrawer 等共享。
 */

/** 规范化任务手册 ID：小写、仅保留字母数字与 ._- 分隔符。 */
export function sanitizePlaybookId(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** 在语义化版本的 patch 段递增；非法版本返回 null，空版本返回 0.1.0。 */
export function bumpPatchVersion(version?: string): string | null {
  if (!version) {
    return "0.1.0";
  }
  const parts = version.split(".");
  if (parts.length !== 3 || parts.some((part) => part.trim() === "" || Number.isNaN(Number(part)))) {
    return null;
  }
  return `${parts[0]}.${parts[1]}.${Number(parts[2]) + 1}`;
}
