import { emitAuthRequired, getApiKey } from "./auth";
import type {
  ApiErrorPayload,
  ApiResponse,
  ExecuteRequest,
  ExecutionRecord,
  ScriptDefinition
} from "./types";

const JSON_HEADERS = {
  "Content-Type": "application/json"
};

export class ApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const token = getApiKey();
  const headers = new Headers(init?.headers ?? {});
  if (!headers.has("Content-Type") && init?.body) {
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
    throw new ApiError("API Key 无效或缺失", 401);
  }

  const isJson = response.headers.get("content-type")?.includes("application/json");
  const payload = isJson ? ((await response.json()) as ApiResponse<T> | ApiErrorPayload) : null;

  if (!response.ok) {
    const message = payload && "msg" in payload && payload.msg ? payload.msg : "请求失败";
    throw new ApiError(message, response.status);
  }

  if (!payload || !("data" in payload)) {
    throw new ApiError("接口返回格式不正确", 500);
  }
  return payload.data as T;
}

export function listScripts(): Promise<ScriptDefinition[]> {
  return request<ScriptDefinition[]>("/api/scripts");
}

export function getScript(id: string): Promise<ScriptDefinition> {
  return request<ScriptDefinition>(`/api/scripts/${id}`);
}

export function createScript(payload: ScriptDefinition): Promise<ScriptDefinition> {
  return request<ScriptDefinition>("/api/scripts", {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify(payload)
  });
}

export function updateScript(id: string, payload: ScriptDefinition): Promise<ScriptDefinition> {
  return request<ScriptDefinition>(`/api/scripts/${id}`, {
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
  return request<ScriptDefinition>(`/api/scripts/${id}/publish`, {
    method: "POST"
  });
}

export function executeScript(payload: ExecuteRequest): Promise<ExecutionRecord> {
  return request<ExecutionRecord>("/api/executions", {
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
