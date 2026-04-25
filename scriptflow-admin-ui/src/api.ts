import type {
  ApiErrorPayload,
  ApiResponse,
  ConfigValue,
  ConfigValueRequest,
  RepositoryDefinition,
  RepositoryInstallRequest,
  RepositoryPublishRequest,
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
  const headers = new Headers(init?.headers ?? {});
  if (!headers.has("Content-Type") && init?.body) {
    headers.set("Content-Type", JSON_HEADERS["Content-Type"]);
  }

  const response = await fetch(path, {
    ...init,
    headers
  });

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

async function uploadPluginFile(path: string, file: File, fallbackMessage: string): Promise<PluginView> {
  const formData = new FormData();
  formData.append("file", file);

  const headers = new Headers();

  const response = await fetch(path, {
    method: "POST",
    headers,
    body: formData
  });

  const payload = (await response.json()) as ApiResponse<PluginView> | ApiErrorPayload;
  if (!response.ok) {
    const message = "msg" in payload && payload.msg ? payload.msg : fallbackMessage;
    const data = "data" in payload ? payload.data : undefined;
    throw new ApiError(message, response.status, data);
  }
  if (!("data" in payload)) {
    throw new ApiError("接口返回格式不正确", 500);
  }
  return payload.data as PluginView;
}

export async function installPlugin(file: File): Promise<PluginView> {
  return uploadPluginFile("/api/plugins/install", file, "上传插件失败");
}

export async function upgradePlugin(pluginId: string, file: File): Promise<PluginView> {
  return uploadPluginFile(`/api/plugins/${pluginId}/upgrade`, file, "升级插件失败");
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

export function listToolsByRepository(id: string): Promise<RepositoryToolDescriptor[]> {
  return request<RepositoryToolDescriptor[]>(`/api/repositories/${encodeURIComponent(id)}/tools`);
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
