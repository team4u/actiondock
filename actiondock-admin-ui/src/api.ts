import { emitAuthRequired, getApiKey } from "./auth";
import type {
  AccessToken,
  AccessTokenRequest,
  ApiErrorPayload,
  ApiResponse,
  ConfigValue,
  ConfigValueRequest,
  RepositoryDefinition,
  DevelopmentStatus,
  RepositoryInstallRequest,
  RepositoryPublishRequest,
  RepositoryPluginDescriptor,
  RepositoryPluginInstallRequest,
  RepositoryPluginInstallResult,
  RepositoryPluginPublishRequest,
  RepositoryToolDescriptor,
  RepositoryToolDetail,
  ExecuteRequest,
  ExecutionResponse,
  ExecutionRecord,
  PluginConfigView,
  PluginInvokeRequest,
  PluginInvokeResponse,
  PluginView,
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

export function uninstallPlugin(pluginId: string): Promise<void> {
  return request<void>(`/api/plugins/${pluginId}`, {
    method: "DELETE"
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

export function getConfigValue(key: string): Promise<ConfigValue> {
  return request<ConfigValue>(`/api/config-values/${encodeURIComponent(key)}`);
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

export function listRepositoryPlugins(): Promise<RepositoryPluginDescriptor[]> {
  return request<RepositoryPluginDescriptor[]>("/api/repositories/plugins");
}

export function listToolsByRepository(id: string): Promise<RepositoryToolDescriptor[]> {
  return request<RepositoryToolDescriptor[]>(`/api/repositories/${encodeURIComponent(id)}/tools`);
}

export function listPluginsByRepository(id: string): Promise<RepositoryPluginDescriptor[]> {
  return request<RepositoryPluginDescriptor[]>(`/api/repositories/${encodeURIComponent(id)}/plugins`);
}

export function getRepositoryTool(repositoryId: string, toolId: string): Promise<RepositoryToolDetail> {
  return request<RepositoryToolDetail>(`/api/repositories/${encodeURIComponent(repositoryId)}/tools/${encodeURIComponent(toolId)}`);
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

export function publishRepositoryPlugin(repositoryId: string, payload: RepositoryPluginPublishRequest): Promise<RepositoryPluginDescriptor> {
  return request<RepositoryPluginDescriptor>(`/api/repositories/${encodeURIComponent(repositoryId)}/publish-plugin`, {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify(payload)
  });
}
