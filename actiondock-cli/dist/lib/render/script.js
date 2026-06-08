import { formatSupplement } from "./shared.js";
export function renderScriptList(items) {
    if (items.length === 0) {
        return "没有可用脚本。";
    }
    return items
        .map((item) => {
        const name = item.name ? ` ${item.name}` : "";
        const type = item.type ? ` [${item.type}]` : "";
        const published = item.publication?.published ? " published" : " draft-only";
        return `${item.id}${name}${type}${published}`;
    })
        .join("\n");
}
export function renderSchemaDetail(params) {
    const { exampleCliCommand, script, target, fields } = params;
    const lines = [
        `Script: ${script.id}${script.name ? ` (${script.name})` : ""}`,
        `Target: ${target}`,
    ];
    if (script.description) {
        lines.push(`Description: ${script.description}`);
    }
    if (fields.length === 0) {
        lines.push("Input schema: none");
        return lines.join("\n");
    }
    lines.push("Flag fields:");
    const flagFields = fields.filter((field) => field.supportsFlag);
    if (flagFields.length === 0) {
        lines.push("  (none)");
    }
    else {
        for (const field of flagFields) {
            lines.push(`  --${field.name} <${field.kind}>${field.required ? " required" : ""}${formatSupplement(field)}`);
        }
    }
    lines.push("JSON-only fields:");
    const jsonOnlyFields = fields.filter((field) => !field.supportsFlag);
    if (jsonOnlyFields.length === 0) {
        lines.push("  (none)");
    }
    else {
        for (const field of jsonOnlyFields) {
            lines.push(`  ${field.name} <${field.kind}>${field.required ? " required" : ""}${formatSupplement(field)}`);
        }
    }
    if (exampleCliCommand) {
        lines.push("Example CLI:");
        lines.push(`  ${exampleCliCommand}`);
    }
    return lines.join("\n");
}
export function renderScriptDetail(script, target) {
    const lines = [
        `Script: ${script.id}${script.name ? ` (${script.name})` : ""}`,
        `Target: ${target}`,
        `Type: ${script.type ?? "-"}`,
        `Version: ${script.version ?? "-"}`,
        `Published: ${script.publication?.published ? "yes" : "no"}`
    ];
    if (script.description) {
        lines.push(`Description: ${script.description}`);
    }
    if (script.owner) {
        lines.push(`Owner: ${script.owner}`);
    }
    if (script.tags && script.tags.length > 0) {
        lines.push(`Tags: ${script.tags.join(", ")}`);
    }
    if (script.pythonRequirements) {
        lines.push("Python requirements: configured");
    }
    return lines.join("\n");
}
