import { JSON_HEADERS, request } from "../../shared/api/httpClient";
import type {
  DevelopmentStatus,
  EventDispatchRecord,
  EventRecord,
  EventSourceDefinition,
  EventTrigger,
  EventTriggerTestRequest,
  EventTriggerTestResult,
  IncomingEventPayload,
  NormalizedEvent,
  ProcessorTestRequest,
  ProcessorTestResult,
  ScriptSchedule,
  ScriptScheduleUpsertRequest
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

export function listEventSources(): Promise<EventSourceDefinition[]> {
  return request<EventSourceDefinition[]>("/api/event-sources");
}

export function getEventSource(id: string): Promise<EventSourceDefinition> {
  return request<EventSourceDefinition>(`/api/event-sources/${id}`);
}

export function createEventSource(payload: Omit<EventSourceDefinition, "id"> | Partial<EventSourceDefinition>): Promise<EventSourceDefinition> {
  return request<EventSourceDefinition>("/api/event-sources", {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify(payload)
  });
}

export function updateEventSource(id: string, payload: Omit<EventSourceDefinition, "id"> | Partial<EventSourceDefinition>): Promise<EventSourceDefinition> {
  return request<EventSourceDefinition>(`/api/event-sources/${id}`, {
    method: "PUT",
    headers: JSON_HEADERS,
    body: JSON.stringify(payload)
  });
}

export function deleteEventSource(id: string): Promise<void> {
  return request<void>(`/api/event-sources/${id}`, {
    method: "DELETE"
  });
}

export function enableEventSource(id: string): Promise<EventSourceDefinition> {
  return request<EventSourceDefinition>(`/api/event-sources/${id}/enable`, {
    method: "POST"
  });
}

export function disableEventSource(id: string): Promise<EventSourceDefinition> {
  return request<EventSourceDefinition>(`/api/event-sources/${id}/disable`, {
    method: "POST"
  });
}

export function testEventSourceNormalization(id: string, payload: IncomingEventPayload): Promise<NormalizedEvent> {
  return request<NormalizedEvent>(`/api/event-sources/${id}/test-normalization`, {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify(payload)
  });
}

export function listEventSourceEvents(id: string): Promise<EventRecord[]> {
  return request<EventRecord[]>(`/api/event-sources/${id}/events`);
}

export function getEventSourceDevelopmentStatus(id: string): Promise<DevelopmentStatus> {
  return request<DevelopmentStatus>(`/api/event-sources/${id}/development-status`);
}

export function pullDevelopmentEventSource(id: string, force = false): Promise<EventSourceDefinition> {
  return request<EventSourceDefinition>(`/api/event-sources/${id}/development-pull?force=${force}`, {
    method: "POST"
  });
}

export function listEventTriggers(): Promise<EventTrigger[]> {
  return request<EventTrigger[]>("/api/event-triggers");
}

export function getEventTrigger(id: string): Promise<EventTrigger> {
  return request<EventTrigger>(`/api/event-triggers/${id}`);
}

export function createEventTrigger(payload: Omit<EventTrigger, "id"> | Partial<EventTrigger>): Promise<EventTrigger> {
  return request<EventTrigger>("/api/event-triggers", {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify(payload)
  });
}

export function updateEventTrigger(id: string, payload: Omit<EventTrigger, "id"> | Partial<EventTrigger>): Promise<EventTrigger> {
  return request<EventTrigger>(`/api/event-triggers/${id}`, {
    method: "PUT",
    headers: JSON_HEADERS,
    body: JSON.stringify(payload)
  });
}

export function deleteEventTrigger(id: string): Promise<void> {
  return request<void>(`/api/event-triggers/${id}`, {
    method: "DELETE"
  });
}

export function enableEventTrigger(id: string): Promise<EventTrigger> {
  return request<EventTrigger>(`/api/event-triggers/${id}/enable`, {
    method: "POST"
  });
}

export function disableEventTrigger(id: string): Promise<EventTrigger> {
  return request<EventTrigger>(`/api/event-triggers/${id}/disable`, {
    method: "POST"
  });
}

export function testEventTrigger(id: string, payload: EventTriggerTestRequest): Promise<EventTriggerTestResult> {
  return request<EventTriggerTestResult>(`/api/event-triggers/${id}/test`, {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify(payload)
  });
}

export function listEventTriggerDispatches(id: string): Promise<EventDispatchRecord[]> {
  return request<EventDispatchRecord[]>(`/api/event-triggers/${id}/dispatches`);
}

export function listEventRecords(sourceId?: string): Promise<EventRecord[]> {
  const params = new URLSearchParams();
  if (sourceId) {
    params.set("sourceId", sourceId);
  }
  return request<EventRecord[]>(params.size > 0 ? `/api/event-records?${params.toString()}` : "/api/event-records");
}

export function getEventRecord(id: string): Promise<EventRecord> {
  return request<EventRecord>(`/api/event-records/${id}`);
}

export function listEventRecordDispatches(id: string): Promise<EventDispatchRecord[]> {
  return request<EventDispatchRecord[]>(`/api/event-records/${id}/dispatches`);
}

export function testProcessor(payload: ProcessorTestRequest): Promise<ProcessorTestResult> {
  return request<ProcessorTestResult>("/api/processors/test", {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify(payload)
  });
}
