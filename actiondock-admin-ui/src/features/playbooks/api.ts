import { JSON_HEADERS, request } from "../../shared/api/httpClient";
import type { Playbook, PlaybookGroup } from "../../shared/types";

export function listPlaybookGroups(): Promise<PlaybookGroup[]> {
  return request<PlaybookGroup[]>("/api/playbook-groups");
}

export function createPlaybookGroup(payload: PlaybookGroup): Promise<PlaybookGroup> {
  return request<PlaybookGroup>("/api/playbook-groups", {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify(payload)
  });
}

export function updatePlaybookGroup(id: string, payload: PlaybookGroup): Promise<PlaybookGroup> {
  return request<PlaybookGroup>(`/api/playbook-groups/${encodeURIComponent(id)}`, {
    method: "PUT",
    headers: JSON_HEADERS,
    body: JSON.stringify(payload)
  });
}

export function deletePlaybookGroup(id: string): Promise<void> {
  return request<void>(`/api/playbook-groups/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export function listPlaybooks(params: {
  groupId?: string;
  repositoryId?: string;
  tag?: string;
  enabled?: boolean;
  managed?: boolean;
  keyword?: string;
} = {}): Promise<Playbook[]> {
  const search = new URLSearchParams();
  if (params.groupId) search.set("groupId", params.groupId);
  if (params.repositoryId) search.set("repositoryId", params.repositoryId);
  if (params.tag) search.set("tag", params.tag);
  if (params.enabled !== undefined) search.set("enabled", String(params.enabled));
  if (params.managed !== undefined) search.set("managed", String(params.managed));
  if (params.keyword) search.set("keyword", params.keyword);
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
