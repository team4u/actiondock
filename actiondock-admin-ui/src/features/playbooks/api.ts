import { JSON_HEADERS, request } from "../../shared/api/httpClient";
import type { Playbook, PlaybookSession, PlaybookSessionDetail, PlaybookSessionStatus } from "../../shared/types";

export function listPlaybooks(params: {
  repositoryId?: string;
  tag?: string;
  enabled?: boolean;
  managed?: boolean;
  intent?: string;
} = {}): Promise<Playbook[]> {
  const search = new URLSearchParams();
  if (params.repositoryId) search.set("repositoryId", params.repositoryId);
  if (params.tag) search.set("tag", params.tag);
  if (params.enabled !== undefined) search.set("enabled", String(params.enabled));
  if (params.managed !== undefined) search.set("managed", String(params.managed));
  if (params.intent) search.set("intent", params.intent);
  const suffix = search.toString() ? `?${search.toString()}` : "";
  return request<Playbook[]>(`/api/playbooks${suffix}`);
}

export function createPlaybook(payload: Playbook): Promise<Playbook> {
  return request<Playbook>("/api/playbooks", {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify(payload)
  });
}

export function updatePlaybook(id: string, payload: Playbook): Promise<Playbook> {
  return request<Playbook>(`/api/playbooks/${encodeURIComponent(id)}`, {
    method: "PUT",
    headers: JSON_HEADERS,
    body: JSON.stringify(payload)
  });
}

export function deletePlaybook(id: string): Promise<void> {
  return request<void>(`/api/playbooks/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export function listPlaybookSessions(params: {
  playbookId?: string;
  status?: PlaybookSessionStatus;
  agentRunId?: string;
  intent?: string;
} = {}): Promise<PlaybookSession[]> {
  const search = new URLSearchParams();
  if (params.playbookId) search.set("playbookId", params.playbookId);
  if (params.status) search.set("status", params.status);
  if (params.agentRunId) search.set("agentRunId", params.agentRunId);
  if (params.intent) search.set("intent", params.intent);
  const suffix = search.toString() ? `?${search.toString()}` : "";
  return request<PlaybookSession[]>(`/api/playbook-sessions${suffix}`);
}

export function getPlaybookSession(id: string): Promise<PlaybookSessionDetail> {
  return request<PlaybookSessionDetail>(`/api/playbook-sessions/${encodeURIComponent(id)}`);
}
