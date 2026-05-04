import { emitAuthRequired, getApiKey } from "./auth";
import type {
  AccessToken,
  AccessTokenRequest,
  AiAgentProfile,
  AiAgentRunRecord,
  AiAgentRunRequest,
  AiAgentRunResult,
  AiAgentRunSnapshot,
  AiAgentRunSubmission,
  AiChatRequest,
  AiChatResponse,
  AiModelProfile,
  AiTool,
  AiToolExecutionResult,
  AiToolset,
  ApiErrorPayload,
  ApiResponse,
  ConfigValue,
  ConfigValueDetail,
  ConfigValueRequest,
  CapabilityPackageDescriptor,
  CapabilityPackageDetail,
  CapabilityPackageInstallResult,
  CapabilityPackagePublishPreview,
  CapabilityPackagePublishPreviewRequest,
  CapabilityPackagePublishRequest,
  DevelopmentStatus,
  EventDispatchRecord,
  EventIngestionResponse,
  EventRecord,
  EventSourceDefinition,
  EventTrigger,
  EventTriggerTestRequest,
  EventTriggerTestResult,
  IncomingEventPayload,
  NormalizedEvent,
  ProcessorTestRequest,
  ProcessorTestResult,
  RepositoryDefinition,
  RepositoryInstallRequest,
  RepositoryPluginDescriptor,
  RepositoryPluginInstallRequest,
  RepositoryPluginInstallResult,
  RepositorySkillDescriptor,
  RepositorySkillDetail,
  RepositorySkillPublishRequest,
  RepositoryPluginPublishRequest,
  RepositoryPublishConfigPreview,
  RepositoryPublishConfigPreviewRequest,
  RepositoryPublishRequest,
  RepositoryToolDescriptor,
  RepositoryToolDetail,
  ExecuteRequest,
  ExecutionPreset,
  ExecutionPresetUpsertRequest,
  ExecutionResponse,
  ExecutionRecord,
  PluginConfigView,
  PluginInvokeRequest,
  PluginInvokeResponse,
  PluginReferenceView,
  PluginView,
  SharedStateCompareAndSetRequest,
  SharedStateCompareAndSetResult,
  SharedStateDetail,
  SharedStateRequest,
  SharedStateSummary,
  SkillInstallation,
  SkillArchiveEntry,
  SkillDetail,
  SkillFilePreview,
  SkillPackageResult,
  SkillScanDetail,
  SkillScanItem,
  SkillSyncResponse,
  SkillTarget,
  SkillValidationResult,
  ScriptSchedule,
  ScriptScheduleUpsertRequest,
  ScriptDefinition
} from "./types";

const JSON_HEADERS = {
  "Content-Type": "application/json"
};

export class ApiError extends Error {
  status: number;
  data?: unknown;

  constructor(message: string, status: number, data?: unknown) {
    super(message);
    this.status = status;
    this.data = data;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const token = getApiKey();
  const headers = new Headers(init?.headers ?? {});
  if (!headers.has("Content-Type") && init?.body && !(init?.body instanceof FormData)) {
    headers.set("Content-Type", JSON_HEADERS["Content-Type"]);
  }
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  const response = await fetch(path, {
    ...init,
    headers
  });

  if (response.status === 401) {
    emitAuthRequired();
    throw new ApiError("访问令牌无效或缺失", 401);
  }

  const isJson = response.headers.get("content-type")?.includes("application/json");
  const payload = isJson ? ((await response.json()) as ApiResponse<T> | ApiErrorPayload) : null;

  if (!response.ok) {
    const message = payload && "msg" in payload && payload.msg ? payload.msg : "请求失败";
    const data = payload && "data" in payload ? payload.data : undefined;
    throw new ApiError(message, response.status, data);
  }

  if (!payload || !("data" in payload)) {
    throw new ApiError("接口返回格式不正确", 500);
  }
  return payload.data as T;
}

async function requestBlob(path: string, init?: RequestInit): Promise<Blob> {
  const token = getApiKey();
  const headers = new Headers(init?.headers ?? {});
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }
  const response = await fetch(path, {
    ...init,
    headers
  });
  if (response.status === 401) {
    emitAuthRequired();
    throw new ApiError("访问令牌无效或缺失", 401);
  }
  if (!response.ok) {
    throw new ApiError("请求失败", response.status);
  }
  return response.blob();
}

export function listScripts(): Promise<ScriptDefinition[]> {
  return request<ScriptDefinition[]>("/api/scripts?includeUiSchema=true");
}

export function getScript(id: string): Promise<ScriptDefinition> {
  return request<ScriptDefinition>(`/api/scripts/${id}?includeUiSchema=true`);
}

export function getPublishedScript(id: string): Promise<ScriptDefinition> {
  return request<ScriptDefinition>(`/api/scripts/${id}/published?includeUiSchema=true`);
}

export function createScript(payload: ScriptDefinition): Promise<ScriptDefinition> {
  return request<ScriptDefinition>("/api/scripts?includeUiSchema=true", {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify(payload)
  });
}

export function updateScript(id: string, payload: ScriptDefinition): Promise<ScriptDefinition> {
  return request<ScriptDefinition>(`/api/scripts/${id}?includeUiSchema=true`, {
    method: "PUT",
    headers: JSON_HEADERS,
    body: JSON.stringify(payload)
  });
}

export function deleteScript(id: string): Promise<void> {
  return request<void>(`/api/scripts/${id}`, {
    method: "DELETE"
  });
}

export function validateScript(id: string): Promise<void> {
  return request<void>(`/api/scripts/${id}/validate`, {
    method: "POST"
  });
}

export function publishScript(id: string): Promise<ScriptDefinition> {
  return request<ScriptDefinition>(`/api/scripts/${id}/publish?includeUiSchema=true`, {
    method: "POST"
  });
}

export function discardDraft(id: string): Promise<ScriptDefinition> {
  return request<ScriptDefinition>(`/api/scripts/${id}/discard-draft?includeUiSchema=true`, {
    method: "POST"
  });
}

export function executeScript(payload: ExecuteRequest): Promise<ExecutionResponse> {
  return request<ExecutionResponse>("/api/executions", {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify(payload)
  });
}

export function executePublishedScript(
  id: string,
  payload: Omit<ExecuteRequest, "scriptId">
): Promise<ExecutionResponse> {
  return request<ExecutionResponse>(`/api/scripts/${id}/published/execute`, {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify(payload)
  });
}

export function getExecution(id: string): Promise<ExecutionRecord> {
  return request<ExecutionRecord>(`/api/executions/${id}`);
}

export function listExecutions(scriptId: string): Promise<ExecutionRecord[]> {
  const params = new URLSearchParams({ scriptId });
  return request<ExecutionRecord[]>(`/api/executions?${params.toString()}`);
}

export function listExecutionsByScheduleId(scheduleId: string): Promise<ExecutionRecord[]> {
  const params = new URLSearchParams({ scheduleId });
  return request<ExecutionRecord[]>(`/api/executions?${params.toString()}`);
}

export function deleteExecution(id: string): Promise<void> {
  return request<void>(`/api/executions/${id}`, {
    method: "DELETE"
  });
}

export function clearExecutions(scriptId: string): Promise<void> {
  const params = new URLSearchParams({ scriptId });
  return request<void>(`/api/executions?${params.toString()}`, {
    method: "DELETE"
  });
}

export function listAiModels(): Promise<AiModelProfile[]> {
  return request<AiModelProfile[]>("/api/ai/models");
}

export function getAiModel(id: string): Promise<AiModelProfile> {
  return request<AiModelProfile>(`/api/ai/models/${encodeURIComponent(id)}`);
}

export function saveAiModel(profile: AiModelProfile): Promise<AiModelProfile> {
  const path = profile.id ? `/api/ai/models/${encodeURIComponent(profile.id)}` : "/api/ai/models";
  return request<AiModelProfile>(path, {
    method: profile.id ? "PUT" : "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify(profile)
  });
}

export function createAiModel(profile: AiModelProfile): Promise<AiModelProfile> {
  return request<AiModelProfile>("/api/ai/models", {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify(profile)
  });
}

export function updateAiModel(id: string, profile: AiModelProfile): Promise<AiModelProfile> {
  return request<AiModelProfile>(`/api/ai/models/${encodeURIComponent(id)}`, {
    method: "PUT",
    headers: JSON_HEADERS,
    body: JSON.stringify(profile)
  });
}

export function deleteAiModel(id: string): Promise<void> {
  return request<void>(`/api/ai/models/${encodeURIComponent(id)}`, {
    method: "DELETE"
  });
}

export function testAiModel(id: string, payload: AiChatRequest): Promise<AiChatResponse> {
  return request<AiChatResponse>(`/api/ai/models/${encodeURIComponent(id)}/test`, {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify(payload)
  });
}

export function listAiAgents(): Promise<AiAgentProfile[]> {
  return request<AiAgentProfile[]>("/api/ai/agents");
}

export function getAiAgent(id: string): Promise<AiAgentProfile> {
  return request<AiAgentProfile>(`/api/ai/agents/${encodeURIComponent(id)}`);
}

export function saveAiAgent(profile: AiAgentProfile): Promise<AiAgentProfile> {
  const path = profile.id ? `/api/ai/agents/${encodeURIComponent(profile.id)}` : "/api/ai/agents";
  return request<AiAgentProfile>(path, {
    method: profile.id ? "PUT" : "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify(profile)
  });
}

export function createAiAgent(profile: AiAgentProfile): Promise<AiAgentProfile> {
  return request<AiAgentProfile>("/api/ai/agents", {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify(profile)
  });
}

export function updateAiAgent(id: string, profile: AiAgentProfile): Promise<AiAgentProfile> {
  return request<AiAgentProfile>(`/api/ai/agents/${encodeURIComponent(id)}`, {
    method: "PUT",
    headers: JSON_HEADERS,
    body: JSON.stringify(profile)
  });
}

export function deleteAiAgent(id: string): Promise<void> {
  return request<void>(`/api/ai/agents/${encodeURIComponent(id)}`, {
    method: "DELETE"
  });
}

export function testAiAgent(id: string, payload: AiAgentRunRequest): Promise<AiAgentRunResult> {
  return request<AiAgentRunResult>(`/api/ai/agents/${encodeURIComponent(id)}/test`, {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify(payload)
  });
}

export function startAiAgentRun(payload: AiAgentRunRequest): Promise<AiAgentRunSubmission> {
  return request<AiAgentRunSubmission>("/api/ai/agents/runs", {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify(payload)
  });
}

export function listAiToolsets(): Promise<AiToolset[]> {
  return request<AiToolset[]>("/api/ai/toolsets");
}

export function getAiToolset(id: string): Promise<AiToolset> {
  return request<AiToolset>(`/api/ai/toolsets/${encodeURIComponent(id)}`);
}

export function createAiToolset(toolset: AiToolset): Promise<AiToolset> {
  return request<AiToolset>("/api/ai/toolsets", {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify(toolset)
  });
}

export function updateAiToolset(id: string, toolset: AiToolset): Promise<AiToolset> {
  return request<AiToolset>(`/api/ai/toolsets/${encodeURIComponent(id)}`, {
    method: "PUT",
    headers: JSON_HEADERS,
    body: JSON.stringify(toolset)
  });
}

export function deleteAiToolset(id: string): Promise<void> {
  return request<void>(`/api/ai/toolsets/${encodeURIComponent(id)}`, {
    method: "DELETE"
  });
}

export function listAiTools(): Promise<AiTool[]> {
  return request<AiTool[]>("/api/ai/tools");
}

export function testAiTool(name: string, input: Record<string, unknown>): Promise<AiToolExecutionResult> {
  return request<AiToolExecutionResult>(`/api/ai/tools/${encodeURIComponent(name)}/test`, {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify(input)
  });
}

export function listAiRuns(): Promise<AiAgentRunRecord[]> {
  return request<AiAgentRunRecord[]>("/api/ai/agents/runs");
}

export function getAiRun(id: string): Promise<AiAgentRunSnapshot> {
  return request<AiAgentRunSnapshot>(`/api/ai/agents/runs/${encodeURIComponent(id)}`);
}

export function resumeAiRun(id: string, payload: Record<string, unknown> = {}): Promise<AiAgentRunResult> {
  return request<AiAgentRunResult>(`/api/ai/agents/runs/${encodeURIComponent(id)}/resume`, {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ payload })
  });
}

export function cancelAiRun(id: string): Promise<void> {
  return request<void>(`/api/ai/agents/runs/${encodeURIComponent(id)}/cancel`, {
    method: "POST"
  });
}

export function deleteAiRun(id: string): Promise<void> {
  return request<void>(`/api/ai/agents/runs/${encodeURIComponent(id)}`, {
    method: "DELETE"
  });
}

export function listSchedules(): Promise<ScriptSchedule[]> {
  return request<ScriptSchedule[]>("/api/schedules");
}

export function getSchedule(id: string): Promise<ScriptSchedule> {
  return request<ScriptSchedule>(`/api/schedules/${id}`);
}

export function createSchedule(payload: ScriptScheduleUpsertRequest): Promise<ScriptSchedule> {
  return request<ScriptSchedule>("/api/schedules", {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify(payload)
  });
}

export function updateSchedule(id: string, payload: ScriptScheduleUpsertRequest): Promise<ScriptSchedule> {
  return request<ScriptSchedule>(`/api/schedules/${id}`, {
    method: "PUT",
    headers: JSON_HEADERS,
    body: JSON.stringify(payload)
  });
}

export function listEventSources(): Promise<EventSourceDefinition[]> {
  return request<EventSourceDefinition[]>("/api/event-sources");
}

export function getEventSource(id: string): Promise<EventSourceDefinition> {
  return request<EventSourceDefinition>(`/api/event-sources/${id}`);
}

export function createEventSource(payload: Omit<EventSourceDefinition, "id"> | Partial<EventSourceDefinition>): Promise<EventSourceDefinition> {
  return request<EventSourceDefinition>("/api/event-sources", {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify(payload)
  });
}

export function updateEventSource(id: string, payload: Omit<EventSourceDefinition, "id"> | Partial<EventSourceDefinition>): Promise<EventSourceDefinition> {
  return request<EventSourceDefinition>(`/api/event-sources/${id}`, {
    method: "PUT",
    headers: JSON_HEADERS,
    body: JSON.stringify(payload)
  });
}

export function deleteEventSource(id: string): Promise<void> {
  return request<void>(`/api/event-sources/${id}`, {
    method: "DELETE"
  });
}

export function enableEventSource(id: string): Promise<EventSourceDefinition> {
  return request<EventSourceDefinition>(`/api/event-sources/${id}/enable`, {
    method: "POST"
  });
}

export function disableEventSource(id: string): Promise<EventSourceDefinition> {
  return request<EventSourceDefinition>(`/api/event-sources/${id}/disable`, {
    method: "POST"
  });
}

export function testEventSourceNormalization(id: string, payload: IncomingEventPayload): Promise<NormalizedEvent> {
  return request<NormalizedEvent>(`/api/event-sources/${id}/test-normalization`, {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify(payload)
  });
}

export function listEventSourceEvents(id: string): Promise<EventRecord[]> {
  return request<EventRecord[]>(`/api/event-sources/${id}/events`);
}

export function listEventTriggers(): Promise<EventTrigger[]> {
  return request<EventTrigger[]>("/api/event-triggers");
}

export function getEventTrigger(id: string): Promise<EventTrigger> {
  return request<EventTrigger>(`/api/event-triggers/${id}`);
}

export function createEventTrigger(payload: Omit<EventTrigger, "id"> | Partial<EventTrigger>): Promise<EventTrigger> {
  return request<EventTrigger>("/api/event-triggers", {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify(payload)
  });
}

export function updateEventTrigger(id: string, payload: Omit<EventTrigger, "id"> | Partial<EventTrigger>): Promise<EventTrigger> {
  return request<EventTrigger>(`/api/event-triggers/${id}`, {
    method: "PUT",
    headers: JSON_HEADERS,
    body: JSON.stringify(payload)
  });
}

export function deleteEventTrigger(id: string): Promise<void> {
  return request<void>(`/api/event-triggers/${id}`, {
    method: "DELETE"
  });
}

export function enableEventTrigger(id: string): Promise<EventTrigger> {
  return request<EventTrigger>(`/api/event-triggers/${id}/enable`, {
    method: "POST"
  });
}

export function disableEventTrigger(id: string): Promise<EventTrigger> {
  return request<EventTrigger>(`/api/event-triggers/${id}/disable`, {
    method: "POST"
  });
}

export function testEventTrigger(id: string, payload: EventTriggerTestRequest): Promise<EventTriggerTestResult> {
  return request<EventTriggerTestResult>(`/api/event-triggers/${id}/test`, {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify(payload)
  });
}

export function listEventTriggerDispatches(id: string): Promise<EventDispatchRecord[]> {
  return request<EventDispatchRecord[]>(`/api/event-triggers/${id}/dispatches`);
}

export function listEventRecords(sourceId?: string): Promise<EventRecord[]> {
  const params = new URLSearchParams();
  if (sourceId) {
    params.set("sourceId", sourceId);
  }
  return request<EventRecord[]>(params.size > 0 ? `/api/event-records?${params.toString()}` : "/api/event-records");
}

export function getEventRecord(id: string): Promise<EventRecord> {
  return request<EventRecord>(`/api/event-records/${id}`);
}

export function listEventRecordDispatches(id: string): Promise<EventDispatchRecord[]> {
  return request<EventDispatchRecord[]>(`/api/event-records/${id}/dispatches`);
}

export function testProcessor(payload: ProcessorTestRequest): Promise<ProcessorTestResult> {
  return request<ProcessorTestResult>("/api/processors/test", {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify(payload)
  });
}

export function enableSchedule(id: string): Promise<ScriptSchedule> {
  return request<ScriptSchedule>(`/api/schedules/${id}/enable`, {
    method: "POST"
  });
}

export function disableSchedule(id: string): Promise<ScriptSchedule> {
  return request<ScriptSchedule>(`/api/schedules/${id}/disable`, {
    method: "POST"
  });
}

export function deleteSchedule(id: string): Promise<void> {
  return request<void>(`/api/schedules/${id}`, {
    method: "DELETE"
  });
}

export function listPlugins(): Promise<PluginView[]> {
  return request<PluginView[]>("/api/plugins");
}

export function listPluginReferences(): Promise<PluginReferenceView[]> {
  return request<PluginReferenceView[]>("/api/plugins/references");
}

export function getPlugin(pluginId: string): Promise<PluginView> {
  return request<PluginView>(`/api/plugins/${pluginId}`);
}

export async function installPlugin(file: File): Promise<PluginView> {
  const formData = new FormData();
  formData.append("file", file);
  return request<PluginView>("/api/plugins/install", {
    method: "POST",
    body: formData
  });
}

export async function upgradePlugin(pluginId: string, file: File): Promise<PluginView> {
  const formData = new FormData();
  formData.append("file", file);
  return request<PluginView>(`/api/plugins/${pluginId}/upgrade`, {
    method: "POST",
    body: formData
  });
}

export function startPlugin(pluginId: string): Promise<PluginView> {
  return request<PluginView>(`/api/plugins/${pluginId}/start`, {
    method: "POST"
  });
}

export function stopPlugin(pluginId: string): Promise<PluginView> {
  return request<PluginView>(`/api/plugins/${pluginId}/stop`, {
    method: "POST"
  });
}

export function uninstallPlugin(pluginId: string, force = false): Promise<void> {
  return request<void>(`/api/plugins/${pluginId}${force ? "?force=true" : ""}`, {
    method: "DELETE"
  });
}

export function downloadPluginJar(pluginId: string): Promise<Blob> {
  return fetch(`/api/plugins/${encodeURIComponent(pluginId)}/download`, {
    headers: {
      ...(getApiKey() ? { Authorization: `Bearer ${getApiKey()}` } : {})
    }
  }).then(response => {
    if (!response.ok) {
      throw new Error("下载插件文件失败");
    }
    return response.blob();
  });
}

export function getPluginConfig(pluginId: string): Promise<PluginConfigView> {
  return request<PluginConfigView>(`/api/plugins/${pluginId}/config`);
}

export function updatePluginConfig(pluginId: string, config: Record<string, unknown>): Promise<PluginConfigView> {
  return request<PluginConfigView>(`/api/plugins/${pluginId}/config`, {
    method: "PUT",
    headers: JSON_HEADERS,
    body: JSON.stringify({ config })
  });
}

export function invokePluginAction(
  pluginId: string,
  action: string,
  payload: PluginInvokeRequest
): Promise<PluginInvokeResponse> {
  return request<PluginInvokeResponse>(`/api/plugins/${pluginId}/actions/${action}/invoke`, {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify(payload)
  });
}

export function listConfigValues(): Promise<ConfigValue[]> {
  return request<ConfigValue[]>("/api/config-values");
}

export function getConfigValue(key: string): Promise<ConfigValueDetail> {
  return request<ConfigValueDetail>(`/api/config-values/${encodeURIComponent(key)}`);
}

export function createConfigValue(payload: ConfigValueRequest): Promise<ConfigValue> {
  return request<ConfigValue>("/api/config-values", {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify(payload)
  });
}

export function updateConfigValue(key: string, payload: ConfigValueRequest): Promise<ConfigValue> {
  return request<ConfigValue>(`/api/config-values/${encodeURIComponent(key)}`, {
    method: "PUT",
    headers: JSON_HEADERS,
    body: JSON.stringify(payload)
  });
}

export function deleteConfigValue(key: string): Promise<void> {
  return request<void>(`/api/config-values/${encodeURIComponent(key)}`, {
    method: "DELETE"
  });
}

export function copyConfigValueAsLocalOverride(key: string): Promise<ConfigValueDetail> {
  return request<ConfigValueDetail>(`/api/config-values/${encodeURIComponent(key)}/copy-local-override`, {
    method: "POST"
  });
}

export function restoreConfigValueRepositoryDefault(key: string): Promise<ConfigValueDetail> {
  return request<ConfigValueDetail>(`/api/config-values/${encodeURIComponent(key)}/restore-repository-default`, {
    method: "POST"
  });
}

export function listSharedStateNamespaces(): Promise<string[]> {
  return request<string[]>("/api/shared-state/namespaces");
}

export function listSharedState(namespace: string): Promise<SharedStateSummary[]> {
  const params = new URLSearchParams({ namespace });
  return request<SharedStateSummary[]>(`/api/shared-state?${params.toString()}`);
}

export function getSharedState(namespace: string, key: string): Promise<SharedStateDetail> {
  const params = new URLSearchParams({ namespace, key });
  return request<SharedStateDetail>(`/api/shared-state/detail?${params.toString()}`);
}

export function createSharedState(payload: SharedStateRequest): Promise<SharedStateDetail> {
  return request<SharedStateDetail>("/api/shared-state", {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify(payload)
  });
}

export function updateSharedState(payload: SharedStateRequest): Promise<SharedStateDetail> {
  return request<SharedStateDetail>("/api/shared-state", {
    method: "PUT",
    headers: JSON_HEADERS,
    body: JSON.stringify(payload)
  });
}

export function compareAndSetSharedState(payload: SharedStateCompareAndSetRequest): Promise<SharedStateCompareAndSetResult> {
  return request<SharedStateCompareAndSetResult>("/api/shared-state/cas", {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify(payload)
  });
}

export function deleteSharedState(namespace: string, key: string): Promise<void> {
  const params = new URLSearchParams({ namespace, key });
  return request<void>(`/api/shared-state?${params.toString()}`, {
    method: "DELETE"
  });
}

export function purgeExpiredSharedState(namespace?: string): Promise<number> {
  const params = new URLSearchParams();
  if (namespace) {
    params.set("namespace", namespace);
  }
  const suffix = params.size > 0 ? `?${params.toString()}` : "";
  return request<number>(`/api/shared-state/purge-expired${suffix}`, {
    method: "POST"
  });
}

export function listAccessTokens(): Promise<AccessToken[]> {
  return request<AccessToken[]>("/api/access-tokens");
}

export function createAccessToken(payload: AccessTokenRequest): Promise<AccessToken> {
  return request<AccessToken>("/api/access-tokens", {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify(payload)
  });
}

export function updateAccessToken(id: string, payload: AccessTokenRequest): Promise<AccessToken> {
  return request<AccessToken>(`/api/access-tokens/${encodeURIComponent(id)}`, {
    method: "PUT",
    headers: JSON_HEADERS,
    body: JSON.stringify(payload)
  });
}

export function enableAccessToken(id: string): Promise<AccessToken> {
  return request<AccessToken>(`/api/access-tokens/${encodeURIComponent(id)}/enable`, {
    method: "POST"
  });
}

export function disableAccessToken(id: string): Promise<AccessToken> {
  return request<AccessToken>(`/api/access-tokens/${encodeURIComponent(id)}/disable`, {
    method: "POST"
  });
}

export function deleteAccessToken(id: string): Promise<void> {
  return request<void>(`/api/access-tokens/${encodeURIComponent(id)}`, {
    method: "DELETE"
  });
}

export function listRepositories(): Promise<RepositoryDefinition[]> {
  return request<RepositoryDefinition[]>("/api/repositories");
}

export function createRepository(payload: RepositoryDefinition): Promise<RepositoryDefinition> {
  return request<RepositoryDefinition>("/api/repositories", {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify(payload)
  });
}

export function updateRepository(id: string, payload: RepositoryDefinition): Promise<RepositoryDefinition> {
  return request<RepositoryDefinition>(`/api/repositories/${encodeURIComponent(id)}`, {
    method: "PUT",
    headers: JSON_HEADERS,
    body: JSON.stringify(payload)
  });
}

export function deleteRepository(id: string): Promise<void> {
  return request<void>(`/api/repositories/${encodeURIComponent(id)}`, {
    method: "DELETE"
  });
}

export function syncRepository(id: string): Promise<RepositoryDefinition> {
  return request<RepositoryDefinition>(`/api/repositories/${encodeURIComponent(id)}/sync`, {
    method: "POST"
  });
}

export function listRepositoryTools(): Promise<RepositoryToolDescriptor[]> {
  return request<RepositoryToolDescriptor[]>("/api/repositories/tools");
}

export function listCapabilityPackages(): Promise<CapabilityPackageDescriptor[]> {
  return request<CapabilityPackageDescriptor[]>("/api/repositories/packages");
}

export function listRepositoryPlugins(): Promise<RepositoryPluginDescriptor[]> {
  return request<RepositoryPluginDescriptor[]>("/api/repositories/plugins");
}

export function listRepositorySkills(): Promise<RepositorySkillDescriptor[]> {
  return request<RepositorySkillDescriptor[]>("/api/repositories/skills");
}

export function listToolsByRepository(id: string): Promise<RepositoryToolDescriptor[]> {
  return request<RepositoryToolDescriptor[]>(`/api/repositories/${encodeURIComponent(id)}/tools`);
}

export function listPluginsByRepository(id: string): Promise<RepositoryPluginDescriptor[]> {
  return request<RepositoryPluginDescriptor[]>(`/api/repositories/${encodeURIComponent(id)}/plugins`);
}

export function listSkillsByRepository(id: string): Promise<RepositorySkillDescriptor[]> {
  return request<RepositorySkillDescriptor[]>(`/api/repositories/${encodeURIComponent(id)}/skills`);
}

export function listCapabilityPackagesByRepository(id: string): Promise<CapabilityPackageDescriptor[]> {
  return request<CapabilityPackageDescriptor[]>(`/api/repositories/${encodeURIComponent(id)}/packages`);
}

export function getRepositoryTool(repositoryId: string, toolId: string): Promise<RepositoryToolDetail> {
  return request<RepositoryToolDetail>(`/api/repositories/${encodeURIComponent(repositoryId)}/tools/${encodeURIComponent(toolId)}`);
}

export function getCapabilityPackage(repositoryId: string, packageId: string): Promise<CapabilityPackageDetail> {
  return request<CapabilityPackageDetail>(`/api/repositories/${encodeURIComponent(repositoryId)}/packages/${encodeURIComponent(packageId)}`);
}

export function getRepositorySkill(repositoryId: string, skillId: string): Promise<RepositorySkillDetail> {
  return request<RepositorySkillDetail>(`/api/repositories/${encodeURIComponent(repositoryId)}/skills/${encodeURIComponent(skillId)}`);
}

export function downloadRepositorySkillArchive(repositoryId: string, skillId: string): Promise<Blob> {
  return requestBlob(`/api/repositories/${encodeURIComponent(repositoryId)}/skills/${encodeURIComponent(skillId)}/archive`);
}

export function installRepositoryTool(repositoryId: string, toolId: string, payload: RepositoryInstallRequest): Promise<void> {
  return request<void>(`/api/repositories/${encodeURIComponent(repositoryId)}/tools/${encodeURIComponent(toolId)}/install`, {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify(payload)
  });
}

export function updateRepositoryTool(repositoryId: string, toolId: string, payload: RepositoryInstallRequest): Promise<void> {
  return request<void>(`/api/repositories/${encodeURIComponent(repositoryId)}/tools/${encodeURIComponent(toolId)}/update`, {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify(payload)
  });
}

export function developRepositoryTool(repositoryId: string, toolId: string, payload: { scriptId?: string }): Promise<ScriptDefinition> {
  return request<ScriptDefinition>(`/api/repositories/${encodeURIComponent(repositoryId)}/tools/${encodeURIComponent(toolId)}/develop`, {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify(payload)
  });
}

export function getDevelopmentStatus(scriptId: string): Promise<DevelopmentStatus> {
  return request<DevelopmentStatus>(`/api/scripts/${encodeURIComponent(scriptId)}/development-status`);
}

export function pullDevelopmentScript(scriptId: string, force = false): Promise<ScriptDefinition> {
  return request<ScriptDefinition>(`/api/scripts/${encodeURIComponent(scriptId)}/development-pull?includeUiSchema=true&force=${force}`, {
    method: "POST"
  });
}

export function installRepositoryPlugin(
  repositoryId: string,
  pluginId: string,
  payload: RepositoryPluginInstallRequest
): Promise<RepositoryPluginInstallResult> {
  return request<RepositoryPluginInstallResult>(`/api/repositories/${encodeURIComponent(repositoryId)}/plugins/${encodeURIComponent(pluginId)}/install`, {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify(payload)
  });
}

export function updateRepositoryPlugin(
  repositoryId: string,
  pluginId: string,
  payload: RepositoryPluginInstallRequest
): Promise<RepositoryPluginInstallResult> {
  return request<RepositoryPluginInstallResult>(`/api/repositories/${encodeURIComponent(repositoryId)}/plugins/${encodeURIComponent(pluginId)}/update`, {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify(payload)
  });
}

export function uninstallInstalledTool(scriptId: string): Promise<void> {
  return request<void>(`/api/installed-tools/${encodeURIComponent(scriptId)}`, {
    method: "DELETE"
  });
}

export function forkRepositoryTool(scriptId: string, payload: { id: string; name: string }): Promise<ScriptDefinition> {
  return request<ScriptDefinition>(`/api/scripts/${encodeURIComponent(scriptId)}/fork?includeUiSchema=true`, {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify(payload)
  });
}

export function publishRepositoryTool(repositoryId: string, payload: RepositoryPublishRequest): Promise<RepositoryToolDescriptor> {
  return request<RepositoryToolDescriptor>(`/api/repositories/${encodeURIComponent(repositoryId)}/publish`, {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify(payload)
  });
}

export function previewCapabilityPackagePublish(
  repositoryId: string,
  payload: CapabilityPackagePublishPreviewRequest
): Promise<CapabilityPackagePublishPreview> {
  return request<CapabilityPackagePublishPreview>(`/api/repositories/${encodeURIComponent(repositoryId)}/packages/preview`, {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify(payload)
  });
}

export function publishCapabilityPackage(
  repositoryId: string,
  payload: CapabilityPackagePublishRequest
): Promise<CapabilityPackageDescriptor> {
  return request<CapabilityPackageDescriptor>(`/api/repositories/${encodeURIComponent(repositoryId)}/packages/publish`, {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify(payload)
  });
}

export function previewRepositoryPublishConfig(
  payload: RepositoryPublishConfigPreviewRequest
): Promise<RepositoryPublishConfigPreview> {
  return request<RepositoryPublishConfigPreview>("/api/repositories/publish-config-preview", {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify(payload)
  });
}

export function publishRepositoryPlugin(repositoryId: string, payload: RepositoryPluginPublishRequest): Promise<RepositoryPluginDescriptor> {
  return request<RepositoryPluginDescriptor>(`/api/repositories/${encodeURIComponent(repositoryId)}/publish-plugin`, {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify(payload)
  });
}

export function publishRepositorySkill(repositoryId: string, payload: RepositorySkillPublishRequest): Promise<RepositorySkillDescriptor> {
  return request<RepositorySkillDescriptor>(`/api/repositories/${encodeURIComponent(repositoryId)}/publish-skill`, {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify(payload)
  });
}

export function publishRepositorySkillArchive(
  repositoryId: string,
  payload: { version: string; releaseNotes?: string; archive: File | Blob }
): Promise<RepositorySkillDescriptor> {
  const formData = new FormData();
  formData.append("version", payload.version);
  if (payload.releaseNotes?.trim()) {
    formData.append("releaseNotes", payload.releaseNotes.trim());
  }
  formData.append("archive", payload.archive);
  return request<RepositorySkillDescriptor>(`/api/repositories/${encodeURIComponent(repositoryId)}/publish-skill-archive`, {
    method: "POST",
    body: formData
  });
}

export function listSkills(): Promise<SkillInstallation[]> {
  return request<SkillInstallation[]>("/api/skills");
}

export function getSkill(installationId: string): Promise<SkillInstallation> {
  return request<SkillInstallation>(`/api/skills/${encodeURIComponent(installationId)}`);
}

export function getSkillDetail(installationId: string): Promise<SkillDetail> {
  return request<SkillDetail>(`/api/skills/${encodeURIComponent(installationId)}/detail`);
}

export function downloadInstalledSkillArchive(installationId: string): Promise<Blob> {
  return requestBlob(`/api/skills/${encodeURIComponent(installationId)}/archive`);
}

export function previewSkillFile(installationId: string, path: string): Promise<SkillFilePreview> {
  const params = new URLSearchParams({ path });
  return request<SkillFilePreview>(`/api/skills/${encodeURIComponent(installationId)}/preview?${params.toString()}`);
}

export async function validateSkillArchive(file: File): Promise<SkillValidationResult> {
  const formData = new FormData();
  formData.append("file", file);
  return request<SkillValidationResult>("/api/skills/validate", {
    method: "POST",
    body: formData
  });
}

export async function importSkill(targetId: string, file: File): Promise<SkillInstallation> {
  const formData = new FormData();
  formData.append("targetId", targetId);
  formData.append("file", file);
  return request<SkillInstallation>("/api/skills/import", {
    method: "POST",
    body: formData
  });
}

export function installSkillDirectory(targetId: string, directory: string): Promise<SkillInstallation> {
  return request<SkillInstallation>("/api/skills/install-directory", {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ targetId, directory })
  });
}

export function installSkillDraft(payload: {
  targetId: string;
  repositoryId?: string;
  skillId: string;
  displayName: string;
  version: string;
  owner?: string;
  description: string;
  tags?: string[];
  riskLevel?: string;
  content: string;
}): Promise<SkillInstallation> {
  return request<SkillInstallation>("/api/skills/draft-install", {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify(payload)
  });
}

export function installSkillDraftArchive(payload: {
  targetId: string;
  repositoryId?: string;
  archive: File | Blob;
}): Promise<SkillInstallation> {
  const formData = new FormData();
  formData.append("targetId", payload.targetId);
  if (payload.repositoryId?.trim()) {
    formData.append("repositoryId", payload.repositoryId.trim());
  }
  formData.append("archive", payload.archive);
  return request<SkillInstallation>("/api/skills/draft-install-archive", {
    method: "POST",
    body: formData
  });
}

export function updateSkill(installationId: string, directory: string): Promise<SkillInstallation> {
  return request<SkillInstallation>(`/api/skills/${encodeURIComponent(installationId)}/update`, {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ directory })
  });
}

export function disableSkill(installationId: string): Promise<SkillInstallation> {
  return request<SkillInstallation>(`/api/skills/${encodeURIComponent(installationId)}/disable`, {
    method: "POST"
  });
}

export function restoreSkill(installationId: string): Promise<SkillInstallation> {
  return request<SkillInstallation>(`/api/skills/${encodeURIComponent(installationId)}/restore`, {
    method: "POST"
  });
}

export function deleteSkill(installationId: string): Promise<void> {
  return request<void>(`/api/skills/${encodeURIComponent(installationId)}`, {
    method: "DELETE"
  });
}

export function packageSkillDirectory(directory: string): Promise<SkillPackageResult> {
  return request<SkillPackageResult>("/api/skills/package", {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ directory })
  });
}

export function listSkillTargets(): Promise<SkillTarget[]> {
  return request<SkillTarget[]>("/api/skill-targets");
}

export function createSkillTarget(payload: SkillTarget): Promise<SkillTarget> {
  return request<SkillTarget>("/api/skill-targets", {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify(payload)
  });
}

export function updateSkillTarget(id: string, payload: SkillTarget): Promise<SkillTarget> {
  return request<SkillTarget>(`/api/skill-targets/${encodeURIComponent(id)}`, {
    method: "PUT",
    headers: JSON_HEADERS,
    body: JSON.stringify(payload)
  });
}

export function deleteSkillTarget(id: string): Promise<void> {
  return request<void>(`/api/skill-targets/${encodeURIComponent(id)}`, {
    method: "DELETE"
  });
}

export function scanSkillTarget(id: string): Promise<SkillScanItem[]> {
  return request<SkillScanItem[]>(`/api/skill-targets/${encodeURIComponent(id)}/scan`, {
    method: "POST"
  });
}

export function getScanItemDetail(targetId: string, directoryId: string): Promise<SkillScanDetail> {
  return request<SkillScanDetail>(`/api/skill-targets/${encodeURIComponent(targetId)}/scan/${encodeURIComponent(directoryId)}`);
}

export function previewScanItemFile(targetId: string, directoryId: string, path: string): Promise<SkillFilePreview> {
  return request<SkillFilePreview>(`/api/skill-targets/${encodeURIComponent(targetId)}/scan/${encodeURIComponent(directoryId)}/preview?path=${encodeURIComponent(path)}`);
}

export function deleteScanDirectory(targetId: string, directoryId: string): Promise<void> {
  return request<void>(`/api/skill-targets/${encodeURIComponent(targetId)}/scan/${encodeURIComponent(directoryId)}`, {
    method: "DELETE"
  });
}

export function syncSkillInstallationsToTarget(targetId: string, installationIds: string[]): Promise<SkillSyncResponse> {
  return request<SkillSyncResponse>(`/api/skill-targets/${encodeURIComponent(targetId)}/sync-installations`, {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ installationIds })
  });
}

export function installCapabilityPackage(repositoryId: string, packageId: string): Promise<CapabilityPackageInstallResult> {
  return request<CapabilityPackageInstallResult>(`/api/repositories/${encodeURIComponent(repositoryId)}/packages/${encodeURIComponent(packageId)}/install`, {
    method: "POST"
  });
}

export function updateCapabilityPackage(repositoryId: string, packageId: string): Promise<CapabilityPackageInstallResult> {
  return request<CapabilityPackageInstallResult>(`/api/repositories/${encodeURIComponent(repositoryId)}/packages/${encodeURIComponent(packageId)}/update`, {
    method: "POST"
  });
}

export function uninstallCapabilityPackage(repositoryId: string, packageId: string): Promise<void> {
  return request<void>(`/api/repositories/${encodeURIComponent(repositoryId)}/packages/${encodeURIComponent(packageId)}`, {
    method: "DELETE"
  });
}

export function listPresets(scriptId: string): Promise<ExecutionPreset[]> {
  return request<ExecutionPreset[]>(`/api/scripts/${encodeURIComponent(scriptId)}/presets`);
}

export function createPreset(scriptId: string, payload: ExecutionPresetUpsertRequest): Promise<ExecutionPreset> {
  return request<ExecutionPreset>(`/api/scripts/${encodeURIComponent(scriptId)}/presets`, {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify(payload)
  });
}

export function updatePreset(scriptId: string, presetId: string, payload: ExecutionPresetUpsertRequest): Promise<ExecutionPreset> {
  return request<ExecutionPreset>(`/api/scripts/${encodeURIComponent(scriptId)}/presets/${encodeURIComponent(presetId)}`, {
    method: "PUT",
    headers: JSON_HEADERS,
    body: JSON.stringify(payload)
  });
}

export function deletePreset(scriptId: string, presetId: string): Promise<void> {
  return request<void>(`/api/scripts/${encodeURIComponent(scriptId)}/presets/${encodeURIComponent(presetId)}`, {
    method: "DELETE"
  });
}
