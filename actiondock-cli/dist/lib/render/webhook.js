import { formatValue, indent } from "./shared.js";
export function renderWebhookList(items) {
    if (items.length === 0) {
        return "没有Webhook。";
    }
    return items
        .map((item) => {
        const key = item.key ? ` ${item.key}` : "";
        const name = item.name ? ` ${item.name}` : "";
        const enabled = typeof item.enabled === "boolean" ? ` ${item.enabled ? "enabled" : "disabled"}` : "";
        const transport = item.transport?.type ? ` ${item.transport.type}` : "";
        return `${item.id}${key}${name}${enabled}${transport}`;
    })
        .join("\n");
}
export function renderWebhookDetail(item) {
    const lines = [
        `Webhook: ${item.id}`,
        `Key: ${item.key ?? "-"}`,
        `Name: ${item.name ?? "-"}`,
        `Enabled: ${item.enabled ? "yes" : "no"}`,
        `Transport: ${item.transport?.type ?? "-"}`
    ];
    if (item.transport?.endpointPath) {
        lines.push(`EndpointPath: ${item.transport.endpointPath}`);
    }
    if (item.webhookScriptId) {
        lines.push(`WebhookScript: ${item.webhookScriptId}`);
    }
    if (item.description) {
        lines.push(`Description: ${item.description}`);
    }
    if (item.lastReceivedAt) {
        lines.push(`LastReceivedAt: ${item.lastReceivedAt}`);
    }
    if (item.sampleRequest && Object.keys(item.sampleRequest).length > 0) {
        lines.push("SampleRequest:");
        lines.push(indent(formatValue(item.sampleRequest)));
    }
    return lines.join("\n");
}
export function renderWebhookInvokeResult(result) {
    const lines = [
        `HTTP ${result.status}`
    ];
    if (Object.keys(result.headers).length > 0) {
        lines.push("Headers:");
        lines.push(indent(formatValue(result.headers)));
    }
    if (result.body !== undefined) {
        lines.push("Body:");
        lines.push(indent(formatValue(result.body)));
    }
    return lines.join("\n");
}
