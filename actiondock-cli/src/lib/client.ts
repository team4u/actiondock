import http from "node:http";
import https from "node:https";
import fs from "node:fs";
import path from "node:path";
import { URL } from "node:url";

import { ActionDockCliError, isRecord } from "./error.js";
import type {
  ApiEnvelope,
  CapabilityView,
  EventDispatchRecord,
  EventIngestionView,
  EventRecord,
  DevelopmentStatus,
  EventSourceDefinition,
  EventTrigger,
  EventTriggerTestRequest,
  EventTriggerTestResult,
  ExecutionResponse,
  IncomingEventPayload,
  PluginConfigView,
  PluginInvokeRequest,
  PluginInvokeResponse,
  PluginReferenceView,
  PluginView,
  ProcessorTestRequest,
  ProcessorTestResult,
  NormalizedEvent,
  RepositoryDefinition,
  RepositoryEventSourceDescriptor,
  RepositoryEventSourceDetail,
  RepositoryEventSourceInstallation,
  RepositoryInstallRequest,
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

  async listCapabilities(): Promise<CapabilityView[]> {
    return this.requestJson<CapabilityView[]>("/api/capabilities");
  }

  async getCapability(capabilityId: string): Promise<CapabilityView> {
    return this.requestJson<CapabilityView>(`/api/capabilities/${capabilityId}`);
  }

  async patchCapability(capabilityId: string, patch: Record<string, unknown>): Promise<CapabilityView> {
    return this.requestJson<CapabilityView>(`/api/capabilities/${capabilityId}`, {
      method: "PATCH",
      body: JSON.stringify({
        draftBinding: patch
      })
    });
  }

  async publishCapability(capabilityId: string): Promise<CapabilityView> {
    return this.requestJson<CapabilityView>(`/api/capabilities/${capabilityId}/publish`, {
      method: "POST"
    });
  }

  async discardCapabilityDraft(capabilityId: string): Promise<CapabilityView> {
    return this.requestJson<CapabilityView>(`/api/capabilities/${capabilityId}/discard-draft`, {
      method: "POST"
    });
  }

  async executeCapability(options: ExecuteOptions, draft: boolean): Promise<ExecutionResponse> {
    return this.requestJson<ExecutionResponse>(`/api/capabilities/${options.scriptId}/execute`, {
      method: "POST",
      body: JSON.stringify({
        input: options.input,
        draft,
        mode: options.mode,
        responseView: options.responseView
      })
    });
  }

  async listScripts(): Promise<ScriptDefinition[]> {
    return this.requestJson<ScriptDefinition[]>("/api/scripts");
  }

  async getScript(scriptId: string, draft: boolean): Promise<ScriptDefinition> {
    return this.requestJson<ScriptDefinition>(draft ? `/api/scripts/${scriptId}` : `/api/scripts/${scriptId}/published`);
  }

  async createScript(definition: ScriptDefinition): Promise<ScriptDefinition> {
    return this.requestJson<ScriptDefinition>("/api/scripts", {
      method: "POST",
      body: JSON.stringify(definition)
    });
  }

  async patchScript(scriptId: string, patch: Record<string, unknown>): Promise<ScriptDefinition> {
    return this.requestJson<ScriptDefinition>(`/api/scripts/${scriptId}`, {
      method: "PATCH",
      body: JSON.stringify(patch)
    });
  }

  async validateScript(scriptId: string): Promise<void> {
    await this.requestJson<null>(`/api/scripts/${scriptId}/validate`, {
      method: "POST"
    });
  }

  async publishScript(scriptId: string): Promise<ScriptDefinition> {
    return this.requestJson<ScriptDefinition>(`/api/scripts/${scriptId}/publish`, {
      method: "POST"
    });
  }

  async discardDraft(scriptId: string): Promise<ScriptDefinition> {
    return this.requestJson<ScriptDefinition>(`/api/scripts/${scriptId}/discard-draft`, {
      method: "POST"
    });
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

  async listEventSources(): Promise<EventSourceDefinition[]> {
    return this.requestJson<EventSourceDefinition[]>("/api/event-sources");
  }

  async getEventSourceDevelopmentStatus(sourceId: string): Promise<DevelopmentStatus> {
    return this.requestJson<DevelopmentStatus>(`/api/event-sources/${sourceId}/development-status`);
  }

  async pullDevelopmentEventSource(sourceId: string, force = false): Promise<EventSourceDefinition> {
    return this.requestJson<EventSourceDefinition>(`/api/event-sources/${sourceId}/development-pull?force=${force}`, {
      method: "POST"
    });
  }

  async getEventSource(sourceId: string): Promise<EventSourceDefinition> {
    return this.requestJson<EventSourceDefinition>(`/api/event-sources/${sourceId}`);
  }

  async createEventSource(definition: EventSourceDefinition): Promise<EventSourceDefinition> {
    return this.requestJson<EventSourceDefinition>("/api/event-sources", {
      method: "POST",
      body: JSON.stringify(definition)
    });
  }

  async updateEventSource(sourceId: string, definition: EventSourceDefinition): Promise<EventSourceDefinition> {
    return this.requestJson<EventSourceDefinition>(`/api/event-sources/${sourceId}`, {
      method: "PUT",
      body: JSON.stringify(definition)
    });
  }

  async enableEventSource(sourceId: string): Promise<EventSourceDefinition> {
    return this.requestJson<EventSourceDefinition>(`/api/event-sources/${sourceId}/enable`, {
      method: "POST"
    });
  }

  async disableEventSource(sourceId: string): Promise<EventSourceDefinition> {
    return this.requestJson<EventSourceDefinition>(`/api/event-sources/${sourceId}/disable`, {
      method: "POST"
    });
  }

  async deleteEventSource(sourceId: string): Promise<void> {
    await this.requestJson<null>(`/api/event-sources/${sourceId}`, {
      method: "DELETE"
    });
  }

  async testEventSourceNormalization(sourceId: string, payload: IncomingEventPayload): Promise<NormalizedEvent> {
    return this.requestJson<NormalizedEvent>(`/api/event-sources/${sourceId}/test-normalization`, {
      method: "POST",
      body: JSON.stringify(payload)
    });
  }

  async ingestEventSource(sourceId: string, payload: IncomingEventPayload): Promise<EventIngestionView> {
    return this.requestJson<EventIngestionView>(`/api/event-sources/${sourceId}/events`, {
      method: "POST",
      body: JSON.stringify(payload)
    });
  }

  async listEventSourceEvents(sourceId: string, limit?: number): Promise<EventRecord[]> {
    const search = new URLSearchParams();
    if (typeof limit === "number" && limit > 0) {
      search.set("limit", String(limit));
    }
    const suffix = search.size > 0 ? `?${search.toString()}` : "";
    return this.requestJson<EventRecord[]>(`/api/event-sources/${sourceId}/events${suffix}`);
  }

  async listEventTriggers(): Promise<EventTrigger[]> {
    return this.requestJson<EventTrigger[]>("/api/event-triggers");
  }

  async getEventTrigger(triggerId: string): Promise<EventTrigger> {
    return this.requestJson<EventTrigger>(`/api/event-triggers/${triggerId}`);
  }

  async createEventTrigger(definition: EventTrigger): Promise<EventTrigger> {
    return this.requestJson<EventTrigger>("/api/event-triggers", {
      method: "POST",
      body: JSON.stringify(definition)
    });
  }

  async updateEventTrigger(triggerId: string, definition: EventTrigger): Promise<EventTrigger> {
    return this.requestJson<EventTrigger>(`/api/event-triggers/${triggerId}`, {
      method: "PUT",
      body: JSON.stringify(definition)
    });
  }

  async enableEventTrigger(triggerId: string): Promise<EventTrigger> {
    return this.requestJson<EventTrigger>(`/api/event-triggers/${triggerId}/enable`, {
      method: "POST"
    });
  }

  async disableEventTrigger(triggerId: string): Promise<EventTrigger> {
    return this.requestJson<EventTrigger>(`/api/event-triggers/${triggerId}/disable`, {
      method: "POST"
    });
  }

  async deleteEventTrigger(triggerId: string): Promise<void> {
    await this.requestJson<null>(`/api/event-triggers/${triggerId}`, {
      method: "DELETE"
    });
  }

  async testEventTrigger(triggerId: string, payload: EventTriggerTestRequest): Promise<EventTriggerTestResult> {
    return this.requestJson<EventTriggerTestResult>(`/api/event-triggers/${triggerId}/test`, {
      method: "POST",
      body: JSON.stringify(payload)
    });
  }

  async listEventTriggerDispatches(triggerId: string): Promise<EventDispatchRecord[]> {
    return this.requestJson<EventDispatchRecord[]>(`/api/event-triggers/${triggerId}/dispatches`);
  }

  async listEventRecords(sourceId?: string): Promise<EventRecord[]> {
    const suffix = sourceId ? `?${new URLSearchParams({ sourceId }).toString()}` : "";
    return this.requestJson<EventRecord[]>(`/api/event-records${suffix}`);
  }

  async getEventRecord(recordId: string): Promise<EventRecord> {
    return this.requestJson<EventRecord>(`/api/event-records/${recordId}`);
  }

  async listEventRecordDispatches(recordId: string): Promise<EventDispatchRecord[]> {
    return this.requestJson<EventDispatchRecord[]>(`/api/event-records/${recordId}/dispatches`);
  }

  async testProcessor(payload: ProcessorTestRequest): Promise<ProcessorTestResult> {
    return this.requestJson<ProcessorTestResult>("/api/processors/test", {
      method: "POST",
      body: JSON.stringify(payload)
    });
  }

  async listPlugins(): Promise<PluginView[]> {
    return this.requestJson<PluginView[]>("/api/plugins");
  }

  async listRepositories(): Promise<RepositoryDefinition[]> {
    return this.requestJson<RepositoryDefinition[]>("/api/repositories");
  }

  async listRepositoryEventSources(): Promise<RepositoryEventSourceDescriptor[]> {
    return this.requestJson<RepositoryEventSourceDescriptor[]>("/api/repositories/event-sources");
  }

  async listRepositoryEventSourcesByRepository(repositoryId: string): Promise<RepositoryEventSourceDescriptor[]> {
    return this.requestJson<RepositoryEventSourceDescriptor[]>(`/api/repositories/${repositoryId}/event-sources`);
  }

  async getRepositoryEventSource(repositoryId: string, eventSourceId: string): Promise<RepositoryEventSourceDetail> {
    return this.requestJson<RepositoryEventSourceDetail>(`/api/repositories/${repositoryId}/event-sources/${eventSourceId}`);
  }

  async installRepositoryEventSource(
    repositoryId: string,
    eventSourceId: string,
    payload: RepositoryInstallRequest
  ): Promise<RepositoryEventSourceInstallation> {
    return this.requestJson<RepositoryEventSourceInstallation>("/api/resource-lifecycle/operations", {
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

  async updateRepositoryEventSource(
    repositoryId: string,
    eventSourceId: string,
    payload: RepositoryInstallRequest
  ): Promise<RepositoryEventSourceInstallation> {
    return this.requestJson<RepositoryEventSourceInstallation>("/api/resource-lifecycle/operations", {
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

  async developRepositoryEventSource(
    repositoryId: string,
    eventSourceId: string,
    sourceId?: string
  ): Promise<EventSourceDefinition> {
    return this.requestJson<EventSourceDefinition>("/api/resource-lifecycle/operations", {
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
