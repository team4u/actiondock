import { JSON_HEADERS, request } from "../../shared/api/httpClient";
import type { ExecutionPreset, ExecutionPresetUpsertRequest, ScriptDefinition } from "../../types";

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
