import { JSON_HEADERS, request } from "../../shared/api/httpClient";
import type { CapabilityView, ExecuteRequest, ExecutionResponse, ScriptDefinition } from "../../shared/types";

export function listCapabilities(): Promise<CapabilityView[]> {
  return request<CapabilityView[]>("/api/capabilities?includeUiSchema=true");
}

export function getCapability(id: string): Promise<CapabilityView> {
  return request<CapabilityView>(`/api/capabilities/${id}?includeUiSchema=true`);
}

export function createCapability(payload: ScriptDefinition): Promise<CapabilityView> {
  return request<CapabilityView>("/api/capabilities?includeUiSchema=true", {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify(payload)
  });
}

export function updateCapability(id: string, payload: ScriptDefinition): Promise<CapabilityView> {
  return request<CapabilityView>(`/api/capabilities/${id}?includeUiSchema=true`, {
    method: "PUT",
    headers: JSON_HEADERS,
    body: JSON.stringify(payload)
  });
}

export function deleteCapability(id: string): Promise<void> {
  return request<void>(`/api/capabilities/${id}`, {
    method: "DELETE"
  });
}

export function validateCapability(id: string): Promise<void> {
  return request<void>(`/api/capabilities/${id}/validate`, {
    method: "POST"
  });
}

export function publishCapability(id: string): Promise<CapabilityView> {
  return request<CapabilityView>(`/api/capabilities/${id}/publish?includeUiSchema=true`, {
    method: "POST"
  });
}

export function discardCapabilityDraft(id: string): Promise<CapabilityView> {
  return request<CapabilityView>(`/api/capabilities/${id}/discard-draft?includeUiSchema=true`, {
    method: "POST"
  });
}

export function executeCapability(
  id: string,
  payload: Omit<ExecuteRequest, "scriptId"> & { draft?: boolean }
): Promise<ExecutionResponse> {
  return request<ExecutionResponse>(`/api/capabilities/${id}/execute`, {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify(payload)
  });
}
