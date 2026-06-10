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
