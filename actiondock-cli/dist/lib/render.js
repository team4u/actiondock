import { inspect } from "node:util";
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
    const { script, target, fields } = params;
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
    if (response.webhookId) {
        lines.push(`Webhook: ${response.webhookId}`);
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
export function renderExecutionPresetList(items) {
    if (items.length === 0) {
        return "没有执行参数预设。";
    }
    return items
        .map((item) => {
        const name = item.name ? ` ${item.name}` : "";
        const managed = item.managed ? " managed" : "";
        return `${item.id}${name}${managed}`;
    })
        .join("\n");
}
export function renderExecutionPresetDetail(item) {
    const lines = [
        `Preset: ${item.id}`,
        `Script: ${item.scriptId}`,
        `Name: ${item.name}`,
        `Managed: ${item.managed ? "yes" : "no"}`,
        `Editable: ${item.editable === false ? "no" : "yes"}`,
        "Input:",
        indent(formatValue(item.input ?? {}))
    ];
    if (item.repositoryId) {
        lines.push(`Repository: ${item.repositoryId}`);
    }
    if (item.repositoryPackageId) {
        lines.push(`Package: ${item.repositoryPackageId}${item.repositoryVersion ? `@${item.repositoryVersion}` : ""}`);
    }
    return lines.join("\n");
}
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
export function renderRepositoryWebhookList(items) {
    if (items.length === 0) {
        return "没有仓库Webhook。";
    }
    return items
        .map((item) => {
        const local = item.localState
            ? ` local=${item.localState.localAssetId}@${item.localState.version ?? item.version} ${item.localState.mode}`
            : " not-installed";
        return `${item.repositoryId}/${item.webhookId} ${item.displayName}@${item.version}${local}`;
    })
        .join("\n");
}
export function renderRepositoryWebhookDetail(item) {
    const descriptor = item.descriptor;
    const lines = [
        `RepositoryWebhook: ${descriptor.repositoryId}/${descriptor.webhookId}`,
        `Name: ${descriptor.displayName}`,
        `Version: ${descriptor.version}`,
        `Installed: ${descriptor.localState ? `yes (${descriptor.localState.localAssetId})` : "no"}`,
        `Trusted: ${descriptor.trusted ? "yes" : "no"}`
    ];
    if (descriptor.localState?.mode === "TRACKED") {
        lines.push(`WorkingCopy: ${descriptor.localState.localAssetId}`);
    }
    if (descriptor.owner) {
        lines.push(`Owner: ${descriptor.owner}`);
    }
    if (descriptor.description) {
        lines.push(`Description: ${descriptor.description}`);
    }
    if (item.webhook.transport?.type) {
        lines.push(`Transport: ${item.webhook.transport.type}`);
    }
    if (item.webhook.webhookScriptId) {
        lines.push(`WebhookScript: ${item.webhook.webhookScriptId}`);
    }
    if (descriptor.scriptDependencies.length > 0) {
        lines.push("ScriptDependencies:");
        for (const dependency of descriptor.scriptDependencies) {
            lines.push(`  - ${dependency.scriptId} => ${dependency.repositoryId}/${dependency.repositoryScriptId ?? dependency.repositoryScriptId}${dependency.versionRange ? ` ${dependency.versionRange}` : ""}`);
        }
    }
    if (item.configTemplate.length > 0) {
        lines.push(`ConfigTemplates: ${item.configTemplate.length}`);
    }
    return lines.join("\n");
}
export function renderRepositoryLocalAsset(item) {
    const lines = [
        `RepositoryAsset: ${item.repositoryId}/${item.upstreamAssetId}`,
        `LocalAsset: ${item.localAssetId}`,
        `Type: ${item.assetType}`,
        `Mode: ${item.mode}`,
        `Version: ${item.version ?? "-"}`
    ];
    if (item.latestVersion) {
        lines.push(`LatestVersion: ${item.latestVersion}`);
    }
    if (item.name) {
        lines.push(`Name: ${item.name}`);
    }
    return lines.join("\n");
}
export function renderRepositoryList(items) {
    if (items.length === 0) {
        return "没有仓库。";
    }
    return items
        .map((item) => {
        const enabled = item.enabled ? " enabled" : " disabled";
        const purpose = item.purpose ? ` ${item.purpose}` : "";
        return `${item.id} ${item.name}${enabled}${purpose} ${item.type} ${item.url}`;
    })
        .join("\n");
}
export function renderRepositoryDetail(item) {
    const lines = [
        `Repository: ${item.id}`,
        `Name: ${item.name}`,
        `Type: ${item.type}`,
        `Purpose: ${item.purpose ?? "-"}`,
        `Url: ${item.url}`,
        `Enabled: ${item.enabled ? "yes" : "no"}`,
        `TrustLevel: ${item.trustLevel ?? "-"}`
    ];
    if (item.branch) {
        lines.push(`Branch: ${item.branch}`);
    }
    if (item.description) {
        lines.push(`Description: ${item.description}`);
    }
    if (item.lastSyncedAt) {
        lines.push(`LastSyncedAt: ${item.lastSyncedAt}`);
    }
    return lines.join("\n");
}
export function renderProjectRepositoryResolution(item) {
    const lines = [
        `Repository: ${item.repositoryId}`,
        `Type: ${item.type}`,
        `Purpose: ${item.purpose}`,
        `Root: ${item.root}`,
        `Entry: ${item.entryPath}`,
        `Enabled: ${item.enabled ? "yes" : "no"}`,
        `Exists: ${item.exists ? "yes" : "no"}`,
        "Content:",
        item.content
    ];
    return lines.join("\n");
}
export function renderRepositoryScriptList(items) {
    if (items.length === 0) {
        return "没有仓库脚本。";
    }
    return items
        .map((item) => {
        const installed = item.installed ? ` installed=${item.installedVersion ?? item.version}` : " not-installed";
        const workingCopy = item.workingCopyId ? ` working-copy=${item.workingCopyId}` : "";
        const type = item.type ? ` ${item.type}` : "";
        return `${item.repositoryId}/${item.scriptId} ${item.displayName}@${item.version}${type}${installed}${workingCopy}`;
    })
        .join("\n");
}
export function renderRepositoryScriptDetail(item) {
    const descriptor = item.descriptor;
    const lines = [
        `RepositoryScript: ${descriptor.repositoryId}/${descriptor.scriptId}`,
        `InstalledScript: ${descriptor.installedScriptId ?? "-"}`,
        `Name: ${descriptor.displayName}`,
        `Version: ${descriptor.version}`,
        `Type: ${descriptor.type ?? "-"}`,
        `Packaging: ${descriptor.packaging ?? "-"}`,
        `Installed: ${descriptor.installed ? `yes${descriptor.installedVersion ? ` (${descriptor.installedVersion})` : ""}` : "no"}`,
        `Trusted: ${descriptor.trusted ? "yes" : "no"}`
    ];
    if (descriptor.owner) {
        lines.push(`Owner: ${descriptor.owner}`);
    }
    if (descriptor.description) {
        lines.push(`Description: ${descriptor.description}`);
    }
    if (descriptor.scriptDependencies?.length > 0) {
        lines.push(`ScriptDependencies: ${descriptor.scriptDependencies.length}`);
    }
    if (descriptor.pluginDependencies && descriptor.pluginDependencies.length > 0) {
        lines.push(`PluginDependencies: ${descriptor.pluginDependencies.length}`);
    }
    if (item.configTemplate.length > 0) {
        lines.push(`ConfigTemplates: ${item.configTemplate.length}`);
    }
    if (descriptor.workingCopyId) {
        lines.push(`WorkingCopy: ${descriptor.workingCopyId}`);
    }
    if (item.scheduleTemplate.length > 0) {
        lines.push(`ScheduleTemplates: ${item.scheduleTemplate.length}`);
    }
    return lines.join("\n");
}
export function renderUpstreamStatus(item) {
    if (!item) {
        return "No upstream binding";
    }
    const lines = [
        `ResourceId: ${item.localAssetId}`,
        `Repository: ${item.repositoryId}`,
        `RepositoryAsset: ${item.upstreamAssetId}`,
        `SyncState: ${item.syncState}`,
        `Dirty: ${item.dirty ? "yes" : "no"}`,
        `RemoteChanged: ${item.remoteChanged ? "yes" : "no"}`
    ];
    if (item.upstreamVersion) {
        lines.push(`RepositoryVersion: ${item.upstreamVersion}`);
    }
    if (item.remoteVersion) {
        lines.push(`RemoteVersion: ${item.remoteVersion}`);
    }
    if (item.lastSyncedAt) {
        lines.push(`LastSyncedAt: ${item.lastSyncedAt}`);
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
export function renderPluginList(items) {
    if (items.length === 0) {
        return "没有插件。";
    }
    return items
        .map((item) => {
        const name = item.name ? ` ${item.name}` : "";
        const version = item.version ? `@${item.version}` : "";
        const actionCount = "actionCount" in item
            ? item.actionCount
            : Array.isArray(item.actions)
                ? item.actions.length
                : undefined;
        const actions = typeof actionCount === "number" ? ` actions=${actionCount}` : "";
        const source = item.sourceType ? ` ${item.sourceType}` : "";
        return `${item.pluginId}${version}${name}${source}${actions}`;
    })
        .join("\n");
}
export function renderPluginDetail(plugin) {
    const lines = [
        `Plugin: ${plugin.pluginId}${plugin.name ? ` (${plugin.name})` : ""}`,
    ];
    if (plugin.description) {
        lines.push(`Description: ${plugin.description}`);
    }
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
            lines.push(`  ${action.action}${action.title ? ` (${action.title})` : ""}${action.description ? ` - ${action.description}` : ""}`);
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
export function renderConfigValueList(items) {
    if (items.length === 0) {
        return "没有配置值。";
    }
    return items
        .map((item) => {
        const secret = item.secret ? " secret" : "";
        const managed = item.managed ? " managed" : "";
        const overridden = item.overridden ? " overridden" : "";
        const value = item.valueMasked ?? (item.hasValue ? "<set>" : "<empty>");
        return `${item.key} ${value}${secret}${managed}${overridden}`;
    })
        .join("\n");
}
export function renderConfigValueDetail(item) {
    const lines = [
        `ConfigValue: ${item.key}`,
        `Value: ${item.valueMasked ?? item.value ?? (item.hasValue ? "<set>" : "<empty>")}`,
        `Secret: ${item.secret ? "yes" : "no"}`,
        `Managed: ${item.managed ? "yes" : "no"}`,
        `Overridden: ${item.overridden ? "yes" : "no"}`,
        `PublishMode: ${item.publishMode ?? "-"}`
    ];
    if (item.description) {
        lines.push(`Description: ${item.description}`);
    }
    if (item.repositoryId) {
        lines.push(`Repository: ${item.repositoryId}${(item.repositoryScriptId ?? item.repositoryScriptId) ? `/${item.repositoryScriptId ?? item.repositoryScriptId}` : ""}${item.repositoryVersion ? `@${item.repositoryVersion}` : ""}`);
    }
    if ("impactedScripts" in item && item.impactedScripts) {
        lines.push(`ImpactedScripts: ${item.impactedScripts.length}`);
    }
    return lines.join("\n");
}
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
