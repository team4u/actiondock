import { JSON_HEADERS, request } from "../../shared/api/httpClient";
import type {
  AiAgentProfile,
  AiAgentRunRecord,
  AiAgentRunRequest,
  AiAgentRunResult,
  AiAgentRunSnapshot,
  AiAgentRunSubmission,
  AiChatRequest,
  AiChatResponse,
  AiModelProfile,
  AiTool,
  AiToolExecutionResult,
  AiToolset
} from "../../shared/types";

export function listAiModels(): Promise<AiModelProfile[]> {
  return request<AiModelProfile[]>("/api/ai/models");
}

export function getAiModel(id: string): Promise<AiModelProfile> {
  return request<AiModelProfile>(`/api/ai/models/${encodeURIComponent(id)}`);
}

export function saveAiModel(profile: AiModelProfile): Promise<AiModelProfile> {
  const path = profile.id ? `/api/ai/models/${encodeURIComponent(profile.id)}` : "/api/ai/models";
  return request<AiModelProfile>(path, {
    method: profile.id ? "PUT" : "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify(profile)
  });
}

export function createAiModel(profile: AiModelProfile): Promise<AiModelProfile> {
  return request<AiModelProfile>("/api/ai/models", {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify(profile)
  });
}

export function updateAiModel(id: string, profile: AiModelProfile): Promise<AiModelProfile> {
  return request<AiModelProfile>(`/api/ai/models/${encodeURIComponent(id)}`, {
    method: "PUT",
    headers: JSON_HEADERS,
    body: JSON.stringify(profile)
  });
}

export function deleteAiModel(id: string): Promise<void> {
  return request<void>(`/api/ai/models/${encodeURIComponent(id)}`, {
    method: "DELETE"
  });
}

export function testAiModel(id: string, payload: AiChatRequest): Promise<AiChatResponse> {
  return request<AiChatResponse>(`/api/ai/models/${encodeURIComponent(id)}/test`, {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify(payload)
  });
}

export function listAiAgents(): Promise<AiAgentProfile[]> {
  return request<AiAgentProfile[]>("/api/ai/agents");
}

export function getAiAgent(id: string): Promise<AiAgentProfile> {
  return request<AiAgentProfile>(`/api/ai/agents/${encodeURIComponent(id)}`);
}

export function saveAiAgent(profile: AiAgentProfile): Promise<AiAgentProfile> {
  const path = profile.id ? `/api/ai/agents/${encodeURIComponent(profile.id)}` : "/api/ai/agents";
  return request<AiAgentProfile>(path, {
    method: profile.id ? "PUT" : "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify(profile)
  });
}

export function createAiAgent(profile: AiAgentProfile): Promise<AiAgentProfile> {
  return request<AiAgentProfile>("/api/ai/agents", {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify(profile)
  });
}

export function updateAiAgent(id: string, profile: AiAgentProfile): Promise<AiAgentProfile> {
  return request<AiAgentProfile>(`/api/ai/agents/${encodeURIComponent(id)}`, {
    method: "PUT",
    headers: JSON_HEADERS,
    body: JSON.stringify(profile)
  });
}

export function deleteAiAgent(id: string): Promise<void> {
  return request<void>(`/api/ai/agents/${encodeURIComponent(id)}`, {
    method: "DELETE"
  });
}

export function testAiAgent(id: string, payload: AiAgentRunRequest): Promise<AiAgentRunResult> {
  return request<AiAgentRunResult>(`/api/ai/agents/${encodeURIComponent(id)}/test`, {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify(payload)
  });
}

export function startAiAgentRun(payload: AiAgentRunRequest): Promise<AiAgentRunSubmission> {
  return request<AiAgentRunSubmission>("/api/ai/agents/runs", {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify(payload)
  });
}

export function listAiToolsets(): Promise<AiToolset[]> {
  return request<AiToolset[]>("/api/ai/toolsets");
}

export function getAiToolset(id: string): Promise<AiToolset> {
  return request<AiToolset>(`/api/ai/toolsets/${encodeURIComponent(id)}`);
}

export function createAiToolset(toolset: AiToolset): Promise<AiToolset> {
  return request<AiToolset>("/api/ai/toolsets", {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify(toolset)
  });
}

export function updateAiToolset(id: string, toolset: AiToolset): Promise<AiToolset> {
  return request<AiToolset>(`/api/ai/toolsets/${encodeURIComponent(id)}`, {
    method: "PUT",
    headers: JSON_HEADERS,
    body: JSON.stringify(toolset)
  });
}

export function deleteAiToolset(id: string): Promise<void> {
  return request<void>(`/api/ai/toolsets/${encodeURIComponent(id)}`, {
    method: "DELETE"
  });
}

export function listAiTools(): Promise<AiTool[]> {
  return request<AiTool[]>("/api/ai/tools");
}

export function testAiTool(name: string, input: Record<string, unknown>): Promise<AiToolExecutionResult> {
  return request<AiToolExecutionResult>(`/api/ai/tools/${encodeURIComponent(name)}/test`, {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify(input)
  });
}

export function listAiRuns(): Promise<AiAgentRunRecord[]> {
  return request<AiAgentRunRecord[]>("/api/ai/agents/runs");
}

export function getAiRun(id: string): Promise<AiAgentRunSnapshot> {
  return request<AiAgentRunSnapshot>(`/api/ai/agents/runs/${encodeURIComponent(id)}`);
}

export function resumeAiRun(id: string, payload: Record<string, unknown> = {}): Promise<AiAgentRunResult> {
  return request<AiAgentRunResult>(`/api/ai/agents/runs/${encodeURIComponent(id)}/resume`, {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ payload })
  });
}

export function cancelAiRun(id: string): Promise<void> {
  return request<void>(`/api/ai/agents/runs/${encodeURIComponent(id)}/cancel`, {
    method: "POST"
  });
}

export function deleteAiRun(id: string): Promise<void> {
  return request<void>(`/api/ai/agents/runs/${encodeURIComponent(id)}`, {
    method: "DELETE"
  });
}
