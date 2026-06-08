import type { SharedStateDetail, SharedStateSummary } from "../types.js";
import { formatValue, indent } from "./shared.js";

export function renderSharedStateNamespaces(items: string[]): string {
  if (items.length === 0) {
    return "没有共享状态命名空间。";
  }
  return items.join("\n");
}

export function renderSharedStateList(items: SharedStateSummary[]): string {
  if (items.length === 0) {
    return "没有共享状态条目。";
  }

  return items
    .map((item) => {
      const secret = item.secret ? " secret" : "";
      const version = item.version != null ? ` v${item.version}` : "";
      return `${item.namespace}/${item.key}${version}${secret}`;
    })
    .join("\n");
}

export function renderSharedStateDetail(item: SharedStateDetail): string {
  const lines = [
    `Entry: ${item.namespace}/${item.key}`,
    `Secret: ${item.secret ? "yes" : "no"}`,
    `Version: ${item.version ?? "-"}`
  ];
  if (item.expiresAt) {
    lines.push(`ExpiresAt: ${item.expiresAt}`);
  }
  if (item.value !== undefined) {
    lines.push("Value:");
    lines.push(indent(formatValue(item.value)));
  }
  return lines.join("\n");
}
