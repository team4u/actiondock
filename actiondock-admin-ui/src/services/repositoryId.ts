import type { RepositoryType } from "../shared/types";

function lastPathSegment(value: string): string {
  return value
    .trim()
    .replace(/[\\/]+$/, "")
    .replace(/\.git$/i, "")
    .split(/[/:\\]/)
    .filter((item) => item.length > 0)
    .slice(-1)[0] ?? "";
}

export function normalizeRepositoryId(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/[-._]{2,}/g, "-")
    .replace(/^[-._]+|[-._]+$/g, "");
}

export function suggestRepositoryId(type: RepositoryType | undefined, url: string | undefined): string {
  if (!url?.trim()) {
    return "";
  }
  if (type !== "GIT" && type !== "LOCAL_DIR") {
    return "";
  }
  return normalizeRepositoryId(lastPathSegment(url));
}
