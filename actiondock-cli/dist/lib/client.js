import http from "node:http";
import https from "node:https";
import fs from "node:fs";
import path from "node:path";
import { URL } from "node:url";
import { ActionDockCliError, isRecord } from "./error.js";
function normalizeScriptDefinition(script) {
    const published = script.published ?? null;
    const publishedFlag = Boolean(script.publication?.published ?? published);
    const dirty = Boolean(script.publication?.dirty);
    return {
        ...script,
        published,
        publication: {
            published: publishedFlag,
            dirty,
            publishedVersion: script.publication?.publishedVersion ?? published?.version,
            publishedAt: script.publication?.publishedAt ?? published?.publishedAt
        }
    };
}
function normalizePublishedRevision(scriptId, revision) {
    return normalizeScriptDefinition({
        id: revision.scriptId || scriptId,
        name: revision.name,
        type: revision.type,
        packaging: revision.packaging,
        source: revision.source,
        pythonRequirements: revision.pythonRequirements,
        inputSchema: revision.inputSchema,
        outputSchema: revision.outputSchema,
        version: revision.version,
        owner: revision.owner,
        description: revision.description,
        tags: revision.tags,
        published: revision,
        publication: {
            published: true,
            dirty: false,
            publishedVersion: revision.version,
            publishedAt: revision.publishedAt
        }
    });
}
export class ActionDockClient {
    options;
    constructor(options) {
        this.options = options;
    }
    async listScripts() {
        return this.requestJson("/api/scripts").then((items) => items.map(normalizeScriptDefinition));
    }
    async getScript(scriptId, draft) {
        if (draft) {
            return this.requestJson(`/api/scripts/${scriptId}`).then(normalizeScriptDefinition);
        }
        return this.requestJson(`/api/scripts/${scriptId}/published`)
            .then((revision) => normalizePublishedRevision(scriptId, revision));
    }
    async createScript(definition) {
        return this.requestJson("/api/scripts", {
            method: "POST",
            body: JSON.stringify(definition)
        }).then(normalizeScriptDefinition);
    }
    async deleteScript(scriptId) {
        await this.requestJson(`/api/scripts/${scriptId}`, {
            method: "DELETE"
        });
    }
    async forkScript(sourceScriptId, payload) {
        return this.requestJson(`/api/scripts/${sourceScriptId}/fork`, {
            method: "POST",
            body: JSON.stringify(payload)
        }).then(normalizeScriptDefinition);
    }
    async patchScript(scriptId, patch) {
        return this.requestJson(`/api/scripts/${scriptId}`, {
            method: "PATCH",
            body: JSON.stringify(patch)
        }).then(normalizeScriptDefinition);
    }
    async validateScript(scriptId) {
        await this.requestJson(`/api/scripts/${scriptId}/validate`, {
            method: "POST"
        });
    }
    async publishScript(scriptId) {
        return this.requestJson(`/api/scripts/${scriptId}/publish`, {
            method: "POST"
        }).then(normalizeScriptDefinition);
    }
    async discardDraft(scriptId) {
        return this.requestJson(`/api/scripts/${scriptId}/discard-draft`, {
            method: "POST"
        }).then(normalizeScriptDefinition);
    }
    async getScriptUpstreamStatus(scriptId) {
        return this.requestJson(`/api/scripts/${scriptId}/upstream`);
    }
    async pullUpstreamScript(scriptId, force = false) {
        return this.requestJson(`/api/scripts/${scriptId}/upstream/pull?force=${force}`, {
            method: "POST"
        }).then(normalizeScriptDefinition);
    }
    async executeScript(options, draft) {
        return this.requestJson(`/api/scripts/${options.scriptId}/execute`, {
            method: "POST",
            body: JSON.stringify({
                input: options.input,
                draft,
                mode: options.mode,
                responseView: options.responseView
            })
        });
    }
    async getExecution(executionId) {
        return this.requestJson(`/api/executions/${executionId}`);
    }
    async listExecutions(params) {
        const search = new URLSearchParams();
        if (params.scriptId) {
            search.set("scriptId", params.scriptId);
        }
        if (params.scheduleId) {
            search.set("scheduleId", params.scheduleId);
        }
        return this.requestJson(`/api/executions?${search.toString()}`);
    }
    async deleteExecution(executionId) {
        await this.requestJson(`/api/executions/${executionId}`, {
            method: "DELETE"
        });
    }
    async clearExecutions(scriptId) {
        const suffix = scriptId ? `?${new URLSearchParams({ scriptId }).toString()}` : "";
        await this.requestJson(`/api/executions${suffix}`, {
            method: "DELETE"
        });
    }
    async listSchedules(scriptId) {
        if (scriptId) {
            return this.requestJson(`/api/scripts/${scriptId}/schedules`);
        }
        return this.requestJson("/api/schedules");
    }
    async getSchedule(scheduleId) {
        return this.requestJson(`/api/schedules/${scheduleId}`);
    }
    async createSchedule(payload) {
        return this.requestJson("/api/schedules", {
            method: "POST",
            body: JSON.stringify(payload)
        });
    }
    async updateSchedule(scheduleId, payload) {
        return this.requestJson(`/api/schedules/${scheduleId}`, {
            method: "PUT",
            body: JSON.stringify(payload)
        });
    }
    async enableSchedule(scheduleId) {
        return this.requestJson(`/api/schedules/${scheduleId}/enable`, {
            method: "POST"
        });
    }
    async disableSchedule(scheduleId) {
        return this.requestJson(`/api/schedules/${scheduleId}/disable`, {
            method: "POST"
        });
    }
    async deleteSchedule(scheduleId) {
        await this.requestJson(`/api/schedules/${scheduleId}`, {
            method: "DELETE"
        });
    }
    async listExecutionPresets(scriptId) {
        return this.requestJson(`/api/scripts/${scriptId}/presets`);
    }
    async createExecutionPreset(scriptId, payload) {
        return this.requestJson(`/api/scripts/${scriptId}/presets`, {
            method: "POST",
            body: JSON.stringify(payload)
        });
    }
    async updateExecutionPreset(scriptId, presetId, payload) {
        return this.requestJson(`/api/scripts/${scriptId}/presets/${presetId}`, {
            method: "PUT",
            body: JSON.stringify(payload)
        });
    }
    async deleteExecutionPreset(scriptId, presetId) {
        await this.requestJson(`/api/scripts/${scriptId}/presets/${presetId}`, {
            method: "DELETE"
        });
    }
    async listWebhooks() {
        return this.requestJson("/api/webhooks");
    }
    async getWebhookUpstreamStatus(webhookId) {
        return this.requestJson(`/api/webhooks/${webhookId}/upstream`);
    }
    async pullUpstreamWebhook(webhookId, force = false) {
        return this.requestJson(`/api/webhooks/${webhookId}/upstream/pull?force=${force}`, {
            method: "POST"
        });
    }
    async getWebhook(webhookId) {
        return this.requestJson(`/api/webhooks/${webhookId}`);
    }
    async createWebhook(definition) {
        return this.requestJson("/api/webhooks", {
            method: "POST",
            body: JSON.stringify(definition)
        });
    }
    async updateWebhook(webhookId, definition) {
        return this.requestJson(`/api/webhooks/${webhookId}`, {
            method: "PUT",
            body: JSON.stringify(definition)
        });
    }
    async enableWebhook(webhookId) {
        return this.requestJson(`/api/webhooks/${webhookId}/enable`, {
            method: "POST"
        });
    }
    async disableWebhook(webhookId) {
        return this.requestJson(`/api/webhooks/${webhookId}/disable`, {
            method: "POST"
        });
    }
    async deleteWebhook(webhookId) {
        await this.requestJson(`/api/webhooks/${webhookId}`, {
            method: "DELETE"
        });
    }
    async invokeWebhook(webhookId, payload) {
        return this.requestWebhook(`/api/webhooks/${webhookId}`, {
            method: "POST",
            body: JSON.stringify(payload)
        });
    }
    async listPlugins() {
        return this.requestJson("/api/plugins");
    }
    async listRepositories(purpose) {
        const suffix = purpose ? `?${new URLSearchParams({ purpose }).toString()}` : "";
        return this.requestJson(`/api/repositories${suffix}`);
    }
    async createRepository(payload) {
        return this.requestJson("/api/repositories", {
            method: "POST",
            body: JSON.stringify(payload)
        });
    }
    async updateRepository(repositoryId, payload) {
        return this.requestJson(`/api/repositories/${repositoryId}`, {
            method: "PUT",
            body: JSON.stringify(payload)
        });
    }
    async deleteRepository(repositoryId) {
        await this.requestJson(`/api/repositories/${repositoryId}`, {
            method: "DELETE"
        });
    }
    async syncRepository(repositoryId) {
        return this.requestJson(`/api/repositories/${repositoryId}/sync`, {
            method: "POST"
        });
    }
    async resolveProjectRepository(repositoryId) {
        return this.requestJson(`/api/repositories/resolve?${new URLSearchParams({ repositoryId }).toString()}`);
    }
    async listRepositoryScripts(repositoryId) {
        if (repositoryId) {
            return this.requestJson(`/api/repositories/${repositoryId}/scripts`);
        }
        return this.requestJson("/api/repositories/scripts");
    }
    async getRepositoryScript(repositoryId, scriptId) {
        return this.requestJson(`/api/repositories/${repositoryId}/scripts/${scriptId}`);
    }
    async installRepositoryTool(repositoryId, scriptId, payload) {
        return this.requestJson(`/api/repositories/${repositoryId}/scripts/${scriptId}/local-assets`, {
            method: "POST",
            body: JSON.stringify({ mode: "LOCKED", ...payload })
        });
    }
    async updateRepositoryTool(repositoryId, scriptId, payload) {
        return this.requestJson(`/api/repositories/${repositoryId}/scripts/${scriptId}/local-assets/update`, {
            method: "POST",
            body: JSON.stringify(payload)
        });
    }
    async createRepositoryToolWorkingCopy(repositoryId, scriptId, localAssetId) {
        return this.requestJson(`/api/repositories/${repositoryId}/scripts/${scriptId}/local-assets`, {
            method: "POST",
            body: JSON.stringify({
                mode: "TRACKED",
                installSchedules: false,
                installScriptDependencies: false,
                installPluginDependencies: false,
                forcePluginUpgrade: false,
                ...(localAssetId ? { localAssetId } : {})
            })
        });
    }
    async uninstallRepositoryTool(scriptId) {
        await this.requestJson(`/api/installed-scripts/${scriptId}`, {
            method: "DELETE"
        });
    }
    async listRepositoryWebhooks() {
        return this.requestJson("/api/repositories/webhooks");
    }
    async listRepositoryWebhooksByRepository(repositoryId) {
        return this.requestJson(`/api/repositories/${repositoryId}/webhooks`);
    }
    async getRepositoryWebhook(repositoryId, webhookId) {
        return this.requestJson(`/api/repositories/${repositoryId}/webhooks/${webhookId}`);
    }
    async installRepositoryWebhook(repositoryId, webhookId, payload) {
        return this.requestJson("/api/resource-lifecycle/operations", {
            method: "POST",
            body: JSON.stringify({
                resourceType: "REPOSITORY_WEBHOOK",
                operation: "add-local",
                repositoryId,
                resourceId: webhookId,
                payload: { mode: "LOCKED", ...payload }
            })
        }).then((operation) => operation.result);
    }
    async updateRepositoryWebhook(repositoryId, webhookId, payload) {
        return this.requestJson("/api/resource-lifecycle/operations", {
            method: "POST",
            body: JSON.stringify({
                resourceType: "REPOSITORY_WEBHOOK",
                operation: "update-local",
                repositoryId,
                resourceId: webhookId,
                payload
            })
        }).then((operation) => operation.result);
    }
    async createRepositoryWebhookWorkingCopy(repositoryId, webhookId, localAssetId) {
        return this.requestJson("/api/resource-lifecycle/operations", {
            method: "POST",
            body: JSON.stringify({
                resourceType: "REPOSITORY_WEBHOOK",
                operation: "add-local",
                repositoryId,
                resourceId: webhookId,
                payload: {
                    mode: "TRACKED",
                    installSchedules: false,
                    installScriptDependencies: false,
                    installPluginDependencies: false,
                    forcePluginUpgrade: false,
                    ...(localAssetId ? { localAssetId } : {})
                }
            })
        }).then((operation) => operation.result);
    }
    async publishRepositoryWebhook(repositoryId, payload) {
        return this.requestJson("/api/resource-lifecycle/operations", {
            method: "POST",
            body: JSON.stringify({
                resourceType: "REPOSITORY_WEBHOOK",
                operation: "publish",
                repositoryId,
                payload
            })
        }).then((operation) => operation.result);
    }
    async getPlugin(pluginId) {
        return this.requestJson(`/api/plugins/${pluginId}`);
    }
    async listPluginReferences() {
        return this.requestJson("/api/plugins/references");
    }
    async getPluginConfig(pluginId) {
        return this.requestJson(`/api/plugins/${pluginId}/config`);
    }
    async savePluginConfig(pluginId, config) {
        return this.requestJson(`/api/plugins/${pluginId}/config`, {
            method: "PUT",
            body: JSON.stringify({ config })
        });
    }
    async invokePlugin(pluginId, action, payload) {
        return this.requestJson(`/api/plugins/${pluginId}/actions/${action}/invoke`, {
            method: "POST",
            body: JSON.stringify(payload)
        });
    }
    async installPlugin(jarPath) {
        return this.uploadPluginJar("/api/plugins/install", jarPath);
    }
    async upgradePlugin(pluginId, jarPath) {
        return this.uploadPluginJar(`/api/plugins/${pluginId}/upgrade`, jarPath);
    }
    async startPlugin(pluginId) {
        return this.requestJson(`/api/plugins/${pluginId}/start`, {
            method: "POST"
        });
    }
    async stopPlugin(pluginId) {
        return this.requestJson(`/api/plugins/${pluginId}/stop`, {
            method: "POST"
        });
    }
    async uninstallPlugin(pluginId, force = false) {
        await this.requestJson(`/api/plugins/${pluginId}?${new URLSearchParams({ force: String(force) }).toString()}`, {
            method: "DELETE"
        });
    }
    async downloadPlugin(pluginId) {
        const response = await this.requestBinary(`/api/plugins/${pluginId}/download`);
        return {
            filename: parseContentDispositionFilename(response.headers["content-disposition"]) ?? `${pluginId}.jar`,
            content: response.body
        };
    }
    async listConfigValues() {
        return this.requestJson("/api/config-values");
    }
    async getConfigValue(key) {
        return this.requestJson(`/api/config-values/${encodeURIComponent(key)}`);
    }
    async createConfigValue(payload) {
        return this.requestJson("/api/config-values", {
            method: "POST",
            body: JSON.stringify(payload)
        });
    }
    async updateConfigValue(key, payload) {
        return this.requestJson(`/api/config-values/${encodeURIComponent(key)}`, {
            method: "PUT",
            body: JSON.stringify(payload)
        });
    }
    async copyConfigValueLocalOverride(key) {
        return this.requestJson(`/api/config-values/${encodeURIComponent(key)}/copy-local-override`, {
            method: "POST"
        });
    }
    async restoreConfigValueRepositoryDefault(key) {
        return this.requestJson(`/api/config-values/${encodeURIComponent(key)}/restore-repository-default`, {
            method: "POST"
        });
    }
    async deleteConfigValue(key) {
        await this.requestJson(`/api/config-values/${encodeURIComponent(key)}`, {
            method: "DELETE"
        });
    }
    async listAccessTokens() {
        return this.requestJson("/api/access-tokens");
    }
    async createAccessToken(name) {
        return this.requestJson("/api/access-tokens", {
            method: "POST",
            body: JSON.stringify({ name })
        });
    }
    async renameAccessToken(tokenId, name) {
        return this.requestJson(`/api/access-tokens/${tokenId}`, {
            method: "PUT",
            body: JSON.stringify({ name })
        });
    }
    async enableAccessToken(tokenId) {
        return this.requestJson(`/api/access-tokens/${tokenId}/enable`, {
            method: "POST"
        });
    }
    async disableAccessToken(tokenId) {
        return this.requestJson(`/api/access-tokens/${tokenId}/disable`, {
            method: "POST"
        });
    }
    async deleteAccessToken(tokenId) {
        await this.requestJson(`/api/access-tokens/${tokenId}`, {
            method: "DELETE"
        });
    }
    async putSharedState(payload) {
        return this.requestJson("/api/shared-state", {
            method: "PUT",
            body: JSON.stringify(payload)
        });
    }
    async listSharedStateNamespaces() {
        return this.requestJson("/api/shared-state/namespaces");
    }
    async listSharedState(namespace) {
        return this.requestJson(`/api/shared-state?${new URLSearchParams({ namespace }).toString()}`);
    }
    async getSharedState(namespace, key) {
        return this.requestJson(`/api/shared-state/detail?${new URLSearchParams({ namespace, key }).toString()}`);
    }
    async compareAndSetSharedState(payload) {
        return this.requestJson("/api/shared-state/cas", {
            method: "POST",
            body: JSON.stringify(payload)
        });
    }
    async deleteSharedState(namespace, key) {
        await this.requestJson(`/api/shared-state?${new URLSearchParams({ namespace, key }).toString()}`, {
            method: "DELETE"
        });
    }
    async purgeExpiredSharedState(namespace) {
        const suffix = namespace ? `?${new URLSearchParams({ namespace }).toString()}` : "";
        return this.requestJson(`/api/shared-state/purge-expired${suffix}`, {
            method: "POST"
        });
    }
    async listRepositoryKnowledge(repositoryId) {
        const path = repositoryId
            ? `/api/repositories/${repositoryId}/knowledge`
            : "/api/repositories/knowledge";
        return this.requestJson(path);
    }
    async getRepositoryKnowledge(repositoryId, knowledgeId) {
        return this.requestJson(`/api/repositories/${repositoryId}/knowledge/${knowledgeId}`);
    }
    async installRepositoryKnowledge(repositoryId, knowledgeId) {
        return this.requestJson(`/api/repositories/${repositoryId}/knowledge/${knowledgeId}/install`, {
            method: "POST"
        });
    }
    async uninstallRepositoryKnowledge(repositoryId, knowledgeId) {
        await this.requestJson(`/api/repositories/${repositoryId}/knowledge/${knowledgeId}`, {
            method: "DELETE"
        });
    }
    async requestJson(pathname, init) {
        const url = new URL(`${this.options.serverUrl}${pathname}`);
        const method = init?.method ?? "GET";
        const headers = this.buildHeaders(init?.headers, init?.body);
        const body = init?.body;
        const transport = url.protocol === "https:" ? https : http;
        const payload = await new Promise((resolve, reject) => {
            const request = transport.request(url, {
                method,
                headers,
            }, (response) => {
                const chunks = [];
                response.on("data", (chunk) => {
                    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
                });
                response.on("end", () => {
                    resolve({
                        statusCode: response.statusCode ?? 500,
                        bodyText: Buffer.concat(chunks).toString("utf8")
                    });
                });
            });
            request.on("error", (error) => {
                reject(error);
            });
            if (body) {
                request.write(body);
            }
            request.end();
        }).catch((error) => {
            const detail = error instanceof Error ? error.message : String(error);
            throw new ActionDockCliError(`请求 ActionDock 服务失败: ${detail}`, 4);
        });
        const parsed = parseMaybeJson(payload.bodyText);
        if (payload.statusCode < 200 || payload.statusCode >= 300) {
            const message = isRecord(parsed) && typeof parsed.msg === "string"
                ? parsed.msg
                : `请求失败: HTTP ${payload.statusCode}`;
            const exitCode = payload.statusCode === 401 || payload.statusCode === 403 ? 3 : 5;
            throw new ActionDockCliError(message, exitCode, parsed ?? payload.bodyText);
        }
        if (!isRecord(parsed) || typeof parsed.status !== "number" || !("data" in parsed)) {
            throw new ActionDockCliError(`服务端响应格式非法: ${pathname}`, 5, parsed ?? payload.bodyText);
        }
        return parsed.data;
    }
    async requestBinary(pathname, init) {
        const url = new URL(`${this.options.serverUrl}${pathname}`);
        const method = init?.method ?? "GET";
        const headers = this.buildHeaders(init?.headers, init?.body);
        const body = init?.body;
        const transport = url.protocol === "https:" ? https : http;
        const payload = await new Promise((resolve, reject) => {
            const request = transport.request(url, { method, headers }, (response) => {
                const chunks = [];
                response.on("data", (chunk) => {
                    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
                });
                response.on("end", () => {
                    resolve({
                        statusCode: response.statusCode ?? 500,
                        body: Buffer.concat(chunks),
                        headers: response.headers
                    });
                });
            });
            request.on("error", (error) => {
                reject(error);
            });
            if (body) {
                request.write(body);
            }
            request.end();
        }).catch((error) => {
            const detail = error instanceof Error ? error.message : String(error);
            throw new ActionDockCliError(`请求 ActionDock 服务失败: ${detail}`, 4);
        });
        if (payload.statusCode < 200 || payload.statusCode >= 300) {
            const text = payload.body.toString("utf8");
            const parsed = parseMaybeJson(text);
            const message = isRecord(parsed) && typeof parsed.msg === "string"
                ? parsed.msg
                : `请求失败: HTTP ${payload.statusCode}`;
            const exitCode = payload.statusCode === 401 || payload.statusCode === 403 ? 3 : 5;
            throw new ActionDockCliError(message, exitCode, parsed ?? text);
        }
        return {
            body: payload.body,
            headers: payload.headers
        };
    }
    async requestWebhook(pathname, init) {
        const url = new URL(`${this.options.serverUrl}${pathname}`);
        const method = init?.method ?? "GET";
        const headers = this.buildHeaders(init?.headers, init?.body);
        const body = init?.body;
        const transport = url.protocol === "https:" ? https : http;
        const payload = await new Promise((resolve, reject) => {
            const request = transport.request(url, { method, headers }, (response) => {
                const chunks = [];
                response.on("data", (chunk) => {
                    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
                });
                response.on("end", () => {
                    resolve({
                        statusCode: response.statusCode ?? 500,
                        bodyText: Buffer.concat(chunks).toString("utf8"),
                        headers: response.headers
                    });
                });
            });
            request.on("error", (error) => reject(error));
            if (body) {
                request.write(body);
            }
            request.end();
        }).catch((error) => {
            const detail = error instanceof Error ? error.message : String(error);
            throw new ActionDockCliError(`请求 ActionDock 服务失败: ${detail}`, 4);
        });
        const parsedBody = parseMaybeJson(payload.bodyText);
        const normalizedHeaders = {};
        for (const [key, value] of Object.entries(payload.headers)) {
            if (value === undefined) {
                continue;
            }
            normalizedHeaders[key] = Array.isArray(value) ? value.map(String) : [String(value)];
        }
        if (payload.statusCode < 200 || payload.statusCode >= 300) {
            const message = isRecord(parsedBody) && typeof parsedBody.msg === "string"
                ? parsedBody.msg
                : `请求失败: HTTP ${payload.statusCode}`;
            const exitCode = payload.statusCode === 401 || payload.statusCode === 403 ? 3 : 5;
            throw new ActionDockCliError(message, exitCode, parsedBody ?? payload.bodyText);
        }
        return {
            status: payload.statusCode,
            headers: normalizedHeaders,
            body: parsedBody
        };
    }
    buildHeaders(headers, body) {
        const result = new Headers(headers);
        if (!result.has("Accept")) {
            result.set("Accept", "application/json");
        }
        if (body && !result.has("Content-Type")) {
            result.set("Content-Type", "application/json");
        }
        if (this.options.token && !result.has("Authorization")) {
            result.set("Authorization", `Bearer ${this.options.token}`);
        }
        result.set("Connection", "close");
        return Object.fromEntries(result.entries());
    }
    uploadPluginJar(pathname, jarPath) {
        const { body, boundary } = buildMultipartFileBody(jarPath);
        return this.requestJson(pathname, {
            method: "POST",
            headers: {
                "Content-Type": `multipart/form-data; boundary=${boundary}`,
                "Content-Length": String(body.byteLength)
            },
            body
        });
    }
}
function parseContentDispositionFilename(header) {
    const value = Array.isArray(header) ? header[0] : header;
    const match = value?.match(/filename="([^"]+)"/i) ?? value?.match(/filename=([^;]+)/i);
    return match?.[1]?.trim();
}
function buildMultipartFileBody(jarPath) {
    const filename = path.basename(jarPath);
    const fileBytes = fs.readFileSync(jarPath);
    const boundary = `----actiondock-cli-${Date.now().toString(16)}`;
    return {
        boundary,
        body: Buffer.concat([
            Buffer.from(`--${boundary}\r\n`
                + `Content-Disposition: form-data; name="file"; filename="${escapeMultipartFilename(filename)}"\r\n`
                + "Content-Type: application/java-archive\r\n\r\n", "utf8"),
            fileBytes,
            Buffer.from(`\r\n--${boundary}--\r\n`, "utf8")
        ])
    };
}
function parseMaybeJson(text) {
    if (!text.trim()) {
        return null;
    }
    try {
        return JSON.parse(text);
    }
    catch {
        return text;
    }
}
function escapeMultipartFilename(filename) {
    return filename.replace(/["\r\n]/g, "_");
}
