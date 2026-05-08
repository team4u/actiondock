import { JSON_HEADERS, request } from "../../shared/api/httpClient";
import type { ExecuteRequest, ExecutionResponse, ScriptDefinition } from "../../shared/types";

export function listCapabilities(): Promise<ScriptDefinition[]> {
  return request<ScriptDefinition[]>("/api/scripts?includeUiSchema=true");
}

export function getCapability(id: string): Promise<ScriptDefinition> {
  return request<ScriptDefinition>(`/api/scripts/${id}?includeUiSchema=true`);
}

export function getPublishedCapability(id: string): Promise<ScriptDefinition> {
  return request<ScriptDefinition>(`/api/scripts/${id}/published?includeUiSchema=true`);
}

export function createCapability(payload: ScriptDefinition): Promise<ScriptDefinition> {
  return request<ScriptDefinition>("/api/scripts?includeUiSchema=true", {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify(payload)
  });
}

export function updateCapability(id: string, payload: ScriptDefinition): Promise<ScriptDefinition> {
  return request<ScriptDefinition>(`/api/scripts/${id}?includeUiSchema=true`, {
    method: "PUT",
    headers: JSON_HEADERS,
    body: JSON.stringify(payload)
  });
}

export function deleteCapability(id: string): Promise<void> {
  return request<void>(`/api/scripts/${id}`, {
    method: "DELETE"
  });
}

export function validateCapability(id: string): Promise<void> {
  return request<void>(`/api/scripts/${id}/validate`, {
    method: "POST"
  });
}

export function publishCapability(id: string): Promise<ScriptDefinition> {
  return request<ScriptDefinition>(`/api/scripts/${id}/publish?includeUiSchema=true`, {
    method: "POST"
  });
}

export function discardCapabilityDraft(id: string): Promise<ScriptDefinition> {
  return request<ScriptDefinition>(`/api/scripts/${id}/discard-draft?includeUiSchema=true`, {
    method: "POST"
  });
}

export function executeCapability(
  id: string,
  payload: Omit<ExecuteRequest, "scriptId">
): Promise<ExecutionResponse> {
  return request<ExecutionResponse>(`/api/scripts/${id}/execute`, {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify(payload)
  });
}
