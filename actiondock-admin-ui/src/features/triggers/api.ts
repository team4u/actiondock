import { JSON_HEADERS, request } from "../../shared/api/httpClient";
import type {
  UpstreamStatus,
  WebhookDefinition,
  ScriptSchedule,
  ScriptScheduleUpsertRequest,
  WebhookRequest,
  WebhookTestResult
} from "../../shared/types";

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

export function listWebhooks(): Promise<WebhookDefinition[]> {
  return request<WebhookDefinition[]>("/api/webhooks");
}

export function getWebhook(id: string): Promise<WebhookDefinition> {
  return request<WebhookDefinition>(`/api/webhooks/${id}`);
}

export function createWebhook(payload: Omit<WebhookDefinition, "id"> | Partial<WebhookDefinition>): Promise<WebhookDefinition> {
  return request<WebhookDefinition>("/api/webhooks", {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify(payload)
  });
}

export function updateWebhook(id: string, payload: Omit<WebhookDefinition, "id"> | Partial<WebhookDefinition>): Promise<WebhookDefinition> {
  return request<WebhookDefinition>(`/api/webhooks/${id}`, {
    method: "PUT",
    headers: JSON_HEADERS,
    body: JSON.stringify(payload)
  });
}

export function deleteWebhook(id: string): Promise<void> {
  return request<void>(`/api/webhooks/${id}`, {
    method: "DELETE"
  });
}

export function enableWebhook(id: string): Promise<WebhookDefinition> {
  return request<WebhookDefinition>(`/api/webhooks/${id}/enable`, {
    method: "POST"
  });
}

export function disableWebhook(id: string): Promise<WebhookDefinition> {
  return request<WebhookDefinition>(`/api/webhooks/${id}/disable`, {
    method: "POST"
  });
}

export function testWebhook(id: string, payload: WebhookRequest): Promise<WebhookTestResult> {
  return request<WebhookTestResult>(`/api/webhooks/${id}/test-webhook`, {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify(payload)
  });
}

export function getWebhookUpstreamStatus(id: string): Promise<UpstreamStatus | null> {
  return request<UpstreamStatus | null>(`/api/webhooks/${id}/upstream`);
}

export function pullUpstreamWebhook(id: string, force = false): Promise<WebhookDefinition> {
  return request<WebhookDefinition>(`/api/webhooks/${id}/upstream/pull?force=${force}`, {
    method: "POST"
  });
}
