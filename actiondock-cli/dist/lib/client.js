import http from "node:http";
import https from "node:https";
import fs from "node:fs";
import path from "node:path";
import { URL } from "node:url";
import { ActionDockCliError, isRecord } from "./error.js";
export class ActionDockClient {
    options;
    constructor(options) {
        this.options = options;
    }
    async listScripts() {
        return this.requestJson("/api/scripts");
    }
    async getScript(scriptId, draft) {
        return this.requestJson(draft ? `/api/scripts/${scriptId}` : `/api/scripts/${scriptId}/published`);
    }
    async createScript(definition) {
        return this.requestJson("/api/scripts", {
            method: "POST",
            body: JSON.stringify(definition)
        });
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
        });
    }
    async patchScript(scriptId, patch) {
        return this.requestJson(`/api/scripts/${scriptId}`, {
            method: "PATCH",
            body: JSON.stringify(patch)
        });
    }
    async validateScript(scriptId) {
        await this.requestJson(`/api/scripts/${scriptId}/validate`, {
            method: "POST"
        });
    }
    async publishScript(scriptId) {
        return this.requestJson(`/api/scripts/${scriptId}/publish`, {
            method: "POST"
        });
    }
    async discardDraft(scriptId) {
        return this.requestJson(`/api/scripts/${scriptId}/discard-draft`, {
            method: "POST"
        });
    }
    async getScriptDevelopmentStatus(scriptId) {
        return this.requestJson(`/api/scripts/${scriptId}/development-status`);
    }
    async pullDevelopmentScript(scriptId, force = false) {
        return this.requestJson(`/api/scripts/${scriptId}/development-pull?force=${force}`, {
            method: "POST"
        });
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
    async listEventSources() {
        return this.requestJson("/api/event-sources");
    }
    async getEventSourceDevelopmentStatus(sourceId) {
        return this.requestJson(`/api/event-sources/${sourceId}/development-status`);
    }
    async pullDevelopmentEventSource(sourceId, force = false) {
        return this.requestJson(`/api/event-sources/${sourceId}/development-pull?force=${force}`, {
            method: "POST"
        });
    }
    async getEventSource(sourceId) {
        return this.requestJson(`/api/event-sources/${sourceId}`);
    }
    async createEventSource(definition) {
        return this.requestJson("/api/event-sources", {
            method: "POST",
            body: JSON.stringify(definition)
        });
    }
    async updateEventSource(sourceId, definition) {
        return this.requestJson(`/api/event-sources/${sourceId}`, {
            method: "PUT",
            body: JSON.stringify(definition)
        });
    }
    async enableEventSource(sourceId) {
        return this.requestJson(`/api/event-sources/${sourceId}/enable`, {
            method: "POST"
        });
    }
    async disableEventSource(sourceId) {
        return this.requestJson(`/api/event-sources/${sourceId}/disable`, {
            method: "POST"
        });
    }
    async deleteEventSource(sourceId) {
        await this.requestJson(`/api/event-sources/${sourceId}`, {
            method: "DELETE"
        });
    }
    async testEventSourceNormalization(sourceId, payload) {
        return this.requestJson(`/api/event-sources/${sourceId}/test-normalization`, {
            method: "POST",
            body: JSON.stringify(payload)
        });
    }
    async ingestEventSource(sourceId, payload) {
        return this.requestJson(`/api/event-sources/${sourceId}/events`, {
            method: "POST",
            body: JSON.stringify(payload)
        });
    }
    async listEventSourceEvents(sourceId, limit) {
        const search = new URLSearchParams();
        if (typeof limit === "number" && limit > 0) {
            search.set("limit", String(limit));
        }
        const suffix = search.size > 0 ? `?${search.toString()}` : "";
        return this.requestJson(`/api/event-sources/${sourceId}/events${suffix}`);
    }
    async listEventTriggers() {
        return this.requestJson("/api/event-triggers");
    }
    async getEventTrigger(triggerId) {
        return this.requestJson(`/api/event-triggers/${triggerId}`);
    }
    async createEventTrigger(definition) {
        return this.requestJson("/api/event-triggers", {
            method: "POST",
            body: JSON.stringify(definition)
        });
    }
    async updateEventTrigger(triggerId, definition) {
        return this.requestJson(`/api/event-triggers/${triggerId}`, {
            method: "PUT",
            body: JSON.stringify(definition)
        });
    }
    async enableEventTrigger(triggerId) {
        return this.requestJson(`/api/event-triggers/${triggerId}/enable`, {
            method: "POST"
        });
    }
    async disableEventTrigger(triggerId) {
        return this.requestJson(`/api/event-triggers/${triggerId}/disable`, {
            method: "POST"
        });
    }
    async deleteEventTrigger(triggerId) {
        await this.requestJson(`/api/event-triggers/${triggerId}`, {
            method: "DELETE"
        });
    }
    async testEventTrigger(triggerId, payload) {
        return this.requestJson(`/api/event-triggers/${triggerId}/test`, {
            method: "POST",
            body: JSON.stringify(payload)
        });
    }
    async listEventTriggerDispatches(triggerId) {
        return this.requestJson(`/api/event-triggers/${triggerId}/dispatches`);
    }
    async listEventRecords(sourceId) {
        const suffix = sourceId ? `?${new URLSearchParams({ sourceId }).toString()}` : "";
        return this.requestJson(`/api/event-records${suffix}`);
    }
    async getEventRecord(recordId) {
        return this.requestJson(`/api/event-records/${recordId}`);
    }
    async listEventRecordDispatches(recordId) {
        return this.requestJson(`/api/event-records/${recordId}/dispatches`);
    }
    async testProcessor(payload) {
        return this.requestJson("/api/processors/test", {
            method: "POST",
            body: JSON.stringify(payload)
        });
    }
    async listPlugins() {
        return this.requestJson("/api/plugins");
    }
    async listRepositories() {
        return this.requestJson("/api/repositories");
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
    async listRepositoryTools(repositoryId) {
        if (repositoryId) {
            return this.requestJson(`/api/repositories/${repositoryId}/tools`);
        }
        return this.requestJson("/api/repositories/tools");
    }
    async getRepositoryTool(repositoryId, toolId) {
        return this.requestJson(`/api/repositories/${repositoryId}/tools/${toolId}`);
    }
    async installRepositoryTool(repositoryId, toolId, payload) {
        return this.requestJson(`/api/repositories/${repositoryId}/tools/${toolId}/install`, {
            method: "POST",
            body: JSON.stringify(payload)
        });
    }
    async updateRepositoryTool(repositoryId, toolId, payload) {
        return this.requestJson(`/api/repositories/${repositoryId}/tools/${toolId}/update`, {
            method: "POST",
            body: JSON.stringify(payload)
        });
    }
    async developRepositoryTool(repositoryId, toolId, scriptId) {
        return this.requestJson(`/api/repositories/${repositoryId}/tools/${toolId}/develop`, {
            method: "POST",
            body: JSON.stringify(scriptId ? { scriptId } : {})
        });
    }
    async uninstallRepositoryTool(scriptId) {
        await this.requestJson(`/api/installed-tools/${scriptId}`, {
            method: "DELETE"
        });
    }
    async listRepositoryEventSources() {
        return this.requestJson("/api/repositories/event-sources");
    }
    async listRepositoryEventSourcesByRepository(repositoryId) {
        return this.requestJson(`/api/repositories/${repositoryId}/event-sources`);
    }
    async getRepositoryEventSource(repositoryId, eventSourceId) {
        return this.requestJson(`/api/repositories/${repositoryId}/event-sources/${eventSourceId}`);
    }
    async installRepositoryEventSource(repositoryId, eventSourceId, payload) {
        return this.requestJson("/api/resource-lifecycle/operations", {
            method: "POST",
            body: JSON.stringify({
                resourceType: "REPOSITORY_EVENT_SOURCE",
                operation: "install",
                repositoryId,
                resourceId: eventSourceId,
                payload
            })
        });
    }
    async updateRepositoryEventSource(repositoryId, eventSourceId, payload) {
        return this.requestJson("/api/resource-lifecycle/operations", {
            method: "POST",
            body: JSON.stringify({
                resourceType: "REPOSITORY_EVENT_SOURCE",
                operation: "update",
                repositoryId,
                resourceId: eventSourceId,
                payload
            })
        });
    }
    async developRepositoryEventSource(repositoryId, eventSourceId, sourceId) {
        return this.requestJson("/api/resource-lifecycle/operations", {
            method: "POST",
            body: JSON.stringify({
                resourceType: "REPOSITORY_EVENT_SOURCE",
                operation: "develop",
                repositoryId,
                resourceId: eventSourceId,
                payload: sourceId ? { scriptId: sourceId } : {}
            })
        });
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
