import http from "node:http";
import https from "node:https";
import fs from "node:fs";
import path from "node:path";
import { URL } from "node:url";

import { ActionDockCliError, isRecord } from "./error.js";
import type {
  ApiEnvelope,
  ExecutionResponse,
  PluginConfigView,
  PluginInvokeRequest,
  PluginInvokeResponse,
  PluginReferenceView,
  PluginView,
  ScriptScheduleUpsertRequest,
  ScriptScheduleView,
  ScriptDefinition,
  SharedStateCompareAndSetRequest,
  SharedStateCompareAndSetResult,
  SharedStateDetail,
  SharedStateSummary,
  SharedStateRequest
} from "./types.js";

export interface ClientOptions {
  serverUrl: string;
  token?: string;
}

export interface ExecuteOptions {
  scriptId: string;
  input: Record<string, unknown>;
  mode: "SYNC" | "ASYNC";
  responseView: "RESULT" | "DEBUG";
}

interface RequestOptions {
  method?: string;
  headers?: HeadersInit;
  body?: Buffer | string;
}

export class ActionDockClient {
  constructor(private readonly options: ClientOptions) {}

  async listScripts(): Promise<ScriptDefinition[]> {
    return this.requestJson<ScriptDefinition[]>("/api/scripts");
  }

  async getScript(scriptId: string, draft: boolean): Promise<ScriptDefinition> {
    return this.requestJson<ScriptDefinition>(draft ? `/api/scripts/${scriptId}` : `/api/scripts/${scriptId}/published`);
  }

  async executeScript(options: ExecuteOptions, draft: boolean): Promise<ExecutionResponse> {
    if (draft) {
      return this.requestJson<ExecutionResponse>("/api/executions", {
        method: "POST",
        body: JSON.stringify({
          scriptId: options.scriptId,
          input: options.input,
          mode: options.mode,
          responseView: options.responseView
        })
      });
    }

    return this.requestJson<ExecutionResponse>(`/api/scripts/${options.scriptId}/published/execute`, {
      method: "POST",
      body: JSON.stringify({
        input: options.input,
        mode: options.mode,
        responseView: options.responseView
      })
    });
  }

  async getExecution(executionId: string): Promise<ExecutionResponse> {
    return this.requestJson<ExecutionResponse>(`/api/executions/${executionId}`);
  }

  async listExecutions(params: { scriptId?: string; scheduleId?: string }): Promise<ExecutionResponse[]> {
    const search = new URLSearchParams();
    if (params.scriptId) {
      search.set("scriptId", params.scriptId);
    }
    if (params.scheduleId) {
      search.set("scheduleId", params.scheduleId);
    }
    return this.requestJson<ExecutionResponse[]>(`/api/executions?${search.toString()}`);
  }

  async deleteExecution(executionId: string): Promise<void> {
    await this.requestJson<null>(`/api/executions/${executionId}`, {
      method: "DELETE"
    });
  }

  async clearExecutions(scriptId?: string): Promise<void> {
    const suffix = scriptId ? `?${new URLSearchParams({ scriptId }).toString()}` : "";
    await this.requestJson<null>(`/api/executions${suffix}`, {
      method: "DELETE"
    });
  }

  async listSchedules(scriptId?: string): Promise<ScriptScheduleView[]> {
    if (scriptId) {
      return this.requestJson<ScriptScheduleView[]>(`/api/scripts/${scriptId}/schedules`);
    }
    return this.requestJson<ScriptScheduleView[]>("/api/schedules");
  }

  async getSchedule(scheduleId: string): Promise<ScriptScheduleView> {
    return this.requestJson<ScriptScheduleView>(`/api/schedules/${scheduleId}`);
  }

  async createSchedule(payload: ScriptScheduleUpsertRequest): Promise<ScriptScheduleView> {
    return this.requestJson<ScriptScheduleView>("/api/schedules", {
      method: "POST",
      body: JSON.stringify(payload)
    });
  }

  async updateSchedule(scheduleId: string, payload: ScriptScheduleUpsertRequest): Promise<ScriptScheduleView> {
    return this.requestJson<ScriptScheduleView>(`/api/schedules/${scheduleId}`, {
      method: "PUT",
      body: JSON.stringify(payload)
    });
  }

  async enableSchedule(scheduleId: string): Promise<ScriptScheduleView> {
    return this.requestJson<ScriptScheduleView>(`/api/schedules/${scheduleId}/enable`, {
      method: "POST"
    });
  }

  async disableSchedule(scheduleId: string): Promise<ScriptScheduleView> {
    return this.requestJson<ScriptScheduleView>(`/api/schedules/${scheduleId}/disable`, {
      method: "POST"
    });
  }

  async deleteSchedule(scheduleId: string): Promise<void> {
    await this.requestJson<null>(`/api/schedules/${scheduleId}`, {
      method: "DELETE"
    });
  }

  async listPlugins(): Promise<PluginView[]> {
    return this.requestJson<PluginView[]>("/api/plugins");
  }

  async getPlugin(pluginId: string): Promise<PluginView> {
    return this.requestJson<PluginView>(`/api/plugins/${pluginId}`);
  }

  async listPluginReferences(): Promise<PluginReferenceView[]> {
    return this.requestJson<PluginReferenceView[]>("/api/plugins/references");
  }

  async getPluginConfig(pluginId: string): Promise<PluginConfigView> {
    return this.requestJson<PluginConfigView>(`/api/plugins/${pluginId}/config`);
  }

  async invokePlugin(
    pluginId: string,
    action: string,
    payload: PluginInvokeRequest
  ): Promise<PluginInvokeResponse> {
    return this.requestJson<PluginInvokeResponse>(`/api/plugins/${pluginId}/actions/${action}/invoke`, {
      method: "POST",
      body: JSON.stringify(payload)
    });
  }

  async installPlugin(jarPath: string): Promise<PluginView> {
    const filename = path.basename(jarPath);
    const fileBytes = fs.readFileSync(jarPath);
    const boundary = `----actiondock-cli-${Date.now().toString(16)}`;
    const body = Buffer.concat([
      Buffer.from(
        `--${boundary}\r\n`
        + `Content-Disposition: form-data; name="file"; filename="${escapeMultipartFilename(filename)}"\r\n`
        + "Content-Type: application/java-archive\r\n\r\n",
        "utf8"
      ),
      fileBytes,
      Buffer.from(`\r\n--${boundary}--\r\n`, "utf8")
    ]);

    return this.requestJson<PluginView>("/api/plugins/install", {
      method: "POST",
      headers: {
        "Content-Type": `multipart/form-data; boundary=${boundary}`,
        "Content-Length": String(body.byteLength)
      },
      body
    });
  }

  async putSharedState(payload: SharedStateRequest): Promise<SharedStateDetail> {
    return this.requestJson<SharedStateDetail>("/api/shared-state", {
      method: "PUT",
      body: JSON.stringify(payload)
    });
  }

  async listSharedStateNamespaces(): Promise<string[]> {
    return this.requestJson<string[]>("/api/shared-state/namespaces");
  }

  async listSharedState(namespace: string): Promise<SharedStateSummary[]> {
    return this.requestJson<SharedStateSummary[]>(`/api/shared-state?${new URLSearchParams({ namespace }).toString()}`);
  }

  async getSharedState(namespace: string, key: string): Promise<SharedStateDetail> {
    return this.requestJson<SharedStateDetail>(
      `/api/shared-state/detail?${new URLSearchParams({ namespace, key }).toString()}`
    );
  }

  async compareAndSetSharedState(
    payload: SharedStateCompareAndSetRequest
  ): Promise<SharedStateCompareAndSetResult> {
    return this.requestJson<SharedStateCompareAndSetResult>("/api/shared-state/cas", {
      method: "POST",
      body: JSON.stringify(payload)
    });
  }

  async deleteSharedState(namespace: string, key: string): Promise<void> {
    await this.requestJson<null>(`/api/shared-state?${new URLSearchParams({ namespace, key }).toString()}`, {
      method: "DELETE"
    });
  }

  async purgeExpiredSharedState(namespace?: string): Promise<number> {
    const suffix = namespace ? `?${new URLSearchParams({ namespace }).toString()}` : "";
    return this.requestJson<number>(`/api/shared-state/purge-expired${suffix}`, {
      method: "POST"
    });
  }

  private async requestJson<T>(pathname: string, init?: RequestOptions): Promise<T> {
    const url = new URL(`${this.options.serverUrl}${pathname}`);
    const method = init?.method ?? "GET";
    const headers = this.buildHeaders(init?.headers, init?.body);
    const body = init?.body;
    const transport = url.protocol === "https:" ? https : http;
    const payload = await new Promise<{ statusCode: number; bodyText: string }>((resolve, reject) => {
      const request = transport.request(url, {
        method,
        headers,
      }, (response) => {
        const chunks: Buffer[] = [];
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
    }).catch((error: unknown) => {
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

    return (parsed as unknown as ApiEnvelope<T>).data;
  }

  private buildHeaders(headers: HeadersInit | undefined, body: Buffer | string | undefined): Record<string, string> {
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

function parseMaybeJson(text: string): unknown {
  if (!text.trim()) {
    return null;
  }
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function escapeMultipartFilename(filename: string): string {
  return filename.replace(/["\r\n]/g, "_");
}
