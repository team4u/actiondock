import { JSON_HEADERS, request } from "../../shared/api/httpClient";
import type { ExecuteRequest, ExecutionRecord, ExecutionResponse } from "../../shared/types";

export function executeScript(payload: ExecuteRequest): Promise<ExecutionResponse> {
  return request<ExecutionResponse>(`/api/scripts/${encodeURIComponent(payload.scriptId)}/execute`, {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({
      input: payload.input,
      mode: payload.mode,
      responseView: payload.responseView,
      draft: payload.draft
    })
  });
}

export function executePublishedScript(
  id: string,
  payload: Omit<ExecuteRequest, "scriptId">
): Promise<ExecutionResponse> {
  return request<ExecutionResponse>(`/api/scripts/${id}/execute`, {
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

export function listExecutionsByScheduleId(scheduleId: string): Promise<ExecutionRecord[]> {
  const params = new URLSearchParams({ scheduleId });
  return request<ExecutionRecord[]>(`/api/executions?${params.toString()}`);
}

export function deleteExecution(id: string): Promise<void> {
  return request<void>(`/api/executions/${id}`, {
    method: "DELETE"
  });
}

export function cancelExecution(id: string): Promise<ExecutionRecord> {
  return request<ExecutionRecord>(`/api/executions/${id}/cancel`, {
    method: "POST"
  });
}

export function clearExecutions(scriptId: string): Promise<void> {
  const params = new URLSearchParams({ scriptId });
  return request<void>(`/api/executions?${params.toString()}`, {
    method: "DELETE"
  });
}
