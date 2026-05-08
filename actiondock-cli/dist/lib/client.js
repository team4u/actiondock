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
    async invokePlugin(pluginId, action, payload) {
        return this.requestJson(`/api/plugins/${pluginId}/actions/${action}/invoke`, {
            method: "POST",
            body: JSON.stringify(payload)
        });
    }
    async installPlugin(jarPath) {
        const filename = path.basename(jarPath);
        const fileBytes = fs.readFileSync(jarPath);
        const boundary = `----actiondock-cli-${Date.now().toString(16)}`;
        const body = Buffer.concat([
            Buffer.from(`--${boundary}\r\n`
                + `Content-Disposition: form-data; name="file"; filename="${escapeMultipartFilename(filename)}"\r\n`
                + "Content-Type: application/java-archive\r\n\r\n", "utf8"),
            fileBytes,
            Buffer.from(`\r\n--${boundary}--\r\n`, "utf8")
        ]);
        return this.requestJson("/api/plugins/install", {
            method: "POST",
            headers: {
                "Content-Type": `multipart/form-data; boundary=${boundary}`,
                "Content-Length": String(body.byteLength)
            },
            body
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
