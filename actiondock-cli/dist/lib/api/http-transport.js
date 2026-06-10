import http from "node:http";
import https from "node:https";
import fs from "node:fs";
import path from "node:path";
import { URL } from "node:url";
import { ActionDockCliError, isRecord } from "../error.js";
export class HttpTransport {
    serverUrl;
    token;
    constructor(options) {
        this.serverUrl = options.serverUrl;
        this.token = options.token;
    }
    async requestJson(pathname, init) {
        const { statusCode, bodyText } = await this.rawRequest(pathname, init);
        const parsed = parseMaybeJson(bodyText);
        if (statusCode < 200 || statusCode >= 300) {
            throw this.createHttpError(statusCode, parsed, bodyText);
        }
        if (!isRecord(parsed) || typeof parsed.status !== "number" || !("data" in parsed)) {
            throw new ActionDockCliError(`服务端响应格式非法: ${pathname}`, 5, parsed ?? bodyText);
        }
        return parsed.data;
    }
    async requestRawJson(pathname, init) {
        const { statusCode, bodyText } = await this.rawRequest(pathname, init);
        const parsed = parseMaybeJson(bodyText);
        if (statusCode < 200 || statusCode >= 300) {
            throw this.createHttpError(statusCode, parsed, bodyText);
        }
        return parsed ?? bodyText;
    }
    async requestBinary(pathname, init) {
        const url = new URL(`${this.serverUrl}${pathname}`);
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
            throw this.createHttpError(payload.statusCode, parsed, text);
        }
        return {
            body: payload.body,
            headers: payload.headers
        };
    }
    async requestFullResponse(pathname, init) {
        const { statusCode, bodyText, rawHeaders } = await this.rawRequestWithHeaders(pathname, init);
        const parsedBody = parseMaybeJson(bodyText);
        const normalizedHeaders = {};
        for (const [key, value] of Object.entries(rawHeaders)) {
            if (value === undefined) {
                continue;
            }
            normalizedHeaders[key] = Array.isArray(value) ? value.map(String) : [String(value)];
        }
        if (statusCode < 200 || statusCode >= 300) {
            throw this.createHttpError(statusCode, parsedBody, bodyText);
        }
        return {
            status: statusCode,
            headers: normalizedHeaders,
            body: parsedBody
        };
    }
    uploadFile(pathname, jarPath) {
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
    async rawRequest(pathname, init) {
        const url = new URL(`${this.serverUrl}${pathname}`);
        const method = init?.method ?? "GET";
        const headers = this.buildHeaders(init?.headers, init?.body);
        const body = init?.body;
        const transport = url.protocol === "https:" ? https : http;
        return new Promise((resolve, reject) => {
            const request = transport.request(url, { method, headers }, (response) => {
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
    }
    async rawRequestWithHeaders(pathname, init) {
        const url = new URL(`${this.serverUrl}${pathname}`);
        const method = init?.method ?? "GET";
        const headers = this.buildHeaders(init?.headers, init?.body);
        const body = init?.body;
        const transport = url.protocol === "https:" ? https : http;
        return new Promise((resolve, reject) => {
            const request = transport.request(url, { method, headers }, (response) => {
                const chunks = [];
                response.on("data", (chunk) => {
                    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
                });
                response.on("end", () => {
                    resolve({
                        statusCode: response.statusCode ?? 500,
                        bodyText: Buffer.concat(chunks).toString("utf8"),
                        rawHeaders: response.headers
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
    }
    buildHeaders(headers, body) {
        const result = new Headers(headers);
        if (!result.has("Accept")) {
            result.set("Accept", "application/json");
        }
        if (body && !result.has("Content-Type")) {
            result.set("Content-Type", "application/json");
        }
        if (this.token && !result.has("Authorization")) {
            result.set("Authorization", `Bearer ${this.token}`);
        }
        result.set("Connection", "close");
        return Object.fromEntries(result.entries());
    }
    createHttpError(statusCode, parsed, bodyText) {
        const message = isRecord(parsed)
            ? (typeof parsed.msg === "string" ? parsed.msg
                : typeof parsed.message === "string" ? parsed.message
                    : `请求失败: HTTP ${statusCode}`)
            : `请求失败: HTTP ${statusCode}`;
        const exitCode = statusCode === 401 || statusCode === 403 ? 3 : 5;
        return new ActionDockCliError(message, exitCode, isRecord(parsed) ? parsed : bodyText);
    }
}
export function parseContentDispositionFilename(header) {
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
