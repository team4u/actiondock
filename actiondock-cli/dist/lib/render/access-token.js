export function renderAccessTokenList(items) {
    if (items.length === 0) {
        return "没有访问令牌。";
    }
    return items
        .map((item) => {
        const name = item.name ? ` ${item.name}` : "";
        const enabled = item.enabled ? " enabled" : " disabled";
        const preview = item.tokenPreview ? ` ${item.tokenPreview}` : "";
        return `${item.id}${name}${enabled}${preview}`;
    })
        .join("\n");
}
export function renderAccessTokenDetail(item) {
    const lines = [
        `AccessToken: ${item.id}`,
        `Name: ${item.name ?? "-"}`,
        `Enabled: ${item.enabled ? "yes" : "no"}`,
        `Preview: ${item.tokenPreview ?? "-"}`
    ];
    if (item.tokenValue) {
        lines.push(`TokenValue: ${item.tokenValue}`);
    }
    if (item.lastUsedAt) {
        lines.push(`LastUsedAt: ${item.lastUsedAt}`);
    }
    return lines.join("\n");
}
