import { inspect } from "node:util";
export function renderToolList(items) {
    if (items.length === 0) {
        return "没有可用工具。";
    }
    return items
        .map((item) => {
        const name = item.name ? ` ${item.name}` : "";
        const type = item.type ? ` [${item.type}]` : "";
        const published = item.publishedSnapshot ? " published" : " draft-only";
        return `${item.id}${name}${type}${published}`;
    })
        .join("\n");
}
export function renderSchemaDetail(params) {
    const { script, target, fields } = params;
    const lines = [
        `Script: ${script.id}${script.name ? ` (${script.name})` : ""}`,
        `Target: ${target}`,
    ];
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
    return lines.join("\n");
}
export function renderExecution(response) {
    const lines = [];
    if (response.id) {
        lines.push(`Execution: ${response.id}`);
    }
    if (response.scriptId) {
        lines.push(`Script: ${response.scriptId}`);
    }
    if (response.status) {
        lines.push(`Status: ${response.status}`);
    }
    if (response.submitMode) {
        lines.push(`Mode: ${response.submitMode}`);
    }
    if (response.triggerSource) {
        lines.push(`Trigger: ${response.triggerSource}`);
    }
    if (response.errorMessage) {
        lines.push(`Error: ${response.errorMessage}`);
    }
    if (response.input !== undefined) {
        lines.push("Input:");
        lines.push(indent(formatValue(response.input)));
    }
    if (response.output !== undefined) {
        lines.push("Output:");
        lines.push(indent(formatValue(response.output)));
    }
    if (response.debug) {
        lines.push("Debug:");
        lines.push(indent(formatValue(response.debug)));
    }
    if (response.logs && response.logs.length > 0) {
        lines.push(`Logs: ${response.logs.length}`);
    }
    return lines.join("\n");
}
export function renderExecutionList(items) {
    if (items.length === 0) {
        return "没有执行记录。";
    }
    return items
        .map((item) => {
        const script = item.scriptId ? ` ${item.scriptId}` : "";
        const status = item.status ? ` ${item.status}` : "";
        const mode = item.submitMode ? ` ${item.submitMode}` : "";
        return `${item.id ?? "-"}${script}${status}${mode}`;
    })
        .join("\n");
}
export function renderScheduleList(items) {
    if (items.length === 0) {
        return "没有定时任务。";
    }
    return items
        .map((item) => {
        const script = item.scriptId ? ` ${item.scriptId}` : "";
        const name = item.name ? ` ${item.name}` : "";
        const enabled = typeof item.enabled === "boolean" ? ` ${item.enabled ? "enabled" : "disabled"}` : "";
        const cron = item.cronExpression ? ` ${item.cronExpression}` : "";
        return `${item.id}${script}${name}${enabled}${cron}`;
    })
        .join("\n");
}
export function renderScheduleDetail(item) {
    const lines = [
        `Schedule: ${item.id}`,
        `Script: ${item.scriptId}`,
        `Name: ${item.name ?? "-"}`,
        `Enabled: ${item.enabled ? "yes" : "no"}`,
        `Cron: ${item.cronExpression ?? "-"}`
    ];
    if (item.nextRunAt) {
        lines.push(`NextRunAt: ${item.nextRunAt}`);
    }
    if (item.lastTriggeredAt) {
        lines.push(`LastTriggeredAt: ${item.lastTriggeredAt}`);
    }
    if (item.lastExecutionId) {
        lines.push(`LastExecution: ${item.lastExecutionId}${item.lastExecutionStatus ? ` ${item.lastExecutionStatus}` : ""}`);
    }
    if (item.input !== undefined) {
        lines.push("Input:");
        lines.push(indent(formatValue(item.input)));
    }
    return lines.join("\n");
}
export function renderPluginList(items) {
    if (items.length === 0) {
        return "没有插件。";
    }
    return items
        .map((item) => {
        const name = item.name ? ` ${item.name}` : "";
        const version = item.version ? `@${item.version}` : "";
        const actions = Array.isArray(item.actions) ? ` actions=${item.actions.length}` : "";
        const source = "sourceType" in item && item.sourceType ? ` ${item.sourceType}` : "";
        return `${item.pluginId}${version}${name}${source}${actions}`;
    })
        .join("\n");
}
export function renderPluginDetail(plugin) {
    const lines = [
        `Plugin: ${plugin.pluginId}${plugin.name ? ` (${plugin.name})` : ""}`,
    ];
    if (plugin.version) {
        lines.push(`Version: ${plugin.version}`);
    }
    if ("sourceType" in plugin && plugin.sourceType) {
        lines.push(`Source: ${plugin.sourceType}`);
    }
    if ("state" in plugin && plugin.state) {
        lines.push(`State: ${plugin.state}`);
    }
    if ("started" in plugin && typeof plugin.started === "boolean") {
        lines.push(`Started: ${plugin.started ? "yes" : "no"}`);
    }
    if (plugin.actions.length === 0) {
        lines.push("Actions: none");
    }
    else {
        lines.push("Actions:");
        for (const action of plugin.actions) {
            lines.push(`  ${action.action}${action.title ? ` (${action.title})` : ""}`);
        }
    }
    return lines.join("\n");
}
export function renderPluginConfig(config) {
    return [
        `Plugin: ${config.pluginId}`,
        "Config:",
        indent(formatValue(config.config ?? {}))
    ].join("\n");
}
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
function formatSupplement(field) {
    const fragments = [];
    if (field.enumValues.length > 0) {
        fragments.push(`enum=${field.enumValues.join("|")}`);
    }
    if (field.defaultValue !== undefined) {
        fragments.push(`default=${JSON.stringify(field.defaultValue)}`);
    }
    if (field.description) {
        fragments.push(field.description);
    }
    return fragments.length > 0 ? ` (${fragments.join("; ")})` : "";
}
function indent(text) {
    return text
        .split("\n")
        .map((line) => `  ${line}`)
        .join("\n");
}
function formatValue(value) {
    if (typeof value === "string") {
        return value;
    }
    try {
        return JSON.stringify(value, null, 2);
    }
    catch {
        return inspect(value, { depth: 6, colors: false });
    }
}
