import { formatValue, indent } from "./shared.js";
export function renderSharedStateNamespaces(items) {
    if (items.length === 0) {
        return "没有共享状态命名空间。";
    }
    return items.join("\n");
}
export function renderSharedStateList(items) {
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
export function renderSharedStateDetail(item) {
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
