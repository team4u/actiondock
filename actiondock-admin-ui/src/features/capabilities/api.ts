import { JSON_HEADERS, request } from "../../shared/api/httpClient";
import type { ExecuteRequest, ExecutionResponse, PublishedScriptRevision, ScriptDefinition } from "../../shared/types";
import {
  fromPublishedScriptRevision,
  normalizeScriptDefinition,
  normalizeScriptDefinitions
} from "../../services/scriptPublication";

export function listCapabilities(): Promise<ScriptDefinition[]> {
  return request<ScriptDefinition[]>("/api/scripts?includeUiSchema=true").then(normalizeScriptDefinitions);
}

export function getCapability(id: string): Promise<ScriptDefinition> {
  return request<ScriptDefinition>(`/api/scripts/${id}?includeUiSchema=true`).then(normalizeScriptDefinition);
}

export function getPublishedCapability(id: string): Promise<ScriptDefinition> {
  return request<PublishedScriptRevision>(`/api/scripts/${id}/published?includeUiSchema=true`)
    .then((revision) => fromPublishedScriptRevision(revision, id) as ScriptDefinition);
}

export function createCapability(payload: ScriptDefinition): Promise<ScriptDefinition> {
  return request<ScriptDefinition>("/api/scripts?includeUiSchema=true", {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify(payload)
  }).then(normalizeScriptDefinition);
}

export function updateCapability(id: string, payload: ScriptDefinition): Promise<ScriptDefinition> {
  return request<ScriptDefinition>(`/api/scripts/${id}?includeUiSchema=true`, {
    method: "PUT",
    headers: JSON_HEADERS,
    body: JSON.stringify(payload)
  }).then(normalizeScriptDefinition);
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
  }).then(normalizeScriptDefinition);
}

export function discardCapabilityDraft(id: string): Promise<ScriptDefinition> {
  return request<ScriptDefinition>(`/api/scripts/${id}/discard-draft?includeUiSchema=true`, {
    method: "POST"
  }).then(normalizeScriptDefinition);
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
