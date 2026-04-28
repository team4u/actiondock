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
    async executeScript(options, draft) {
        if (draft) {
            return this.requestJson("/api/executions", {
                method: "POST",
                body: JSON.stringify({
                    scriptId: options.scriptId,
                    input: options.input,
                    mode: options.mode,
                    responseView: options.responseView
                })
            });
        }
        return this.requestJson(`/api/scripts/${options.scriptId}/published/execute`, {
            method: "POST",
            body: JSON.stringify({
                input: options.input,
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
    async listPlugins() {
        return this.requestJson("/api/plugins");
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
