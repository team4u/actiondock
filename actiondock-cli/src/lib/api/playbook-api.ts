import type {
  Playbook,
  PlaybookPhase,
  PlaybookSession,
  PlaybookSessionDetail,
  PlaybookSessionStatus,
  PlaybookTraceEventAppendResponse,
  PlaybookTraceEventType,
} from "../types.js";
import type { HttpTransport } from "./http-transport.js";

export class PlaybookApi {
  private readonly transport: HttpTransport;

  constructor(transport: HttpTransport) {
    this.transport = transport;
  }

  async list(params: {
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
    return this.transport.requestJson<Playbook[]>(`/api/playbooks${suffix}`);
  }

  async get(playbookId: string): Promise<Playbook> {
    return this.transport.requestJson<Playbook>(`/api/playbooks/${playbookId}`);
  }

  async create(payload: Playbook): Promise<Playbook> {
    return this.transport.requestJson<Playbook>("/api/playbooks", {
      method: "POST",
      body: JSON.stringify(payload)
    });
  }

  async update(playbookId: string, payload: Playbook): Promise<Playbook> {
    return this.transport.requestJson<Playbook>(`/api/playbooks/${playbookId}`, {
      method: "PUT",
      body: JSON.stringify(payload)
    });
  }

  async delete(playbookId: string): Promise<void> {
    await this.transport.requestJson<null>(`/api/playbooks/${playbookId}`, {
      method: "DELETE"
    });
  }

  async startSession(playbookId: string, payload: {
    userPrompt?: string;
    intent?: string;
    agentName?: string;
    agentRunId?: string;
    parentSessionId?: string;
    handoffFromSessionId?: string;
    handoffRelation?: string;
    selectedFrom?: Record<string, unknown>;
    candidatePlaybookIds?: string[];
  }): Promise<PlaybookSession> {
    return this.transport.requestJson<PlaybookSession>(`/api/playbooks/${playbookId}/sessions`, {
      method: "POST",
      body: JSON.stringify(payload)
    });
  }

  async appendSessionEvent(sessionId: string, payload: {
    externalEventId?: string;
    phase: PlaybookPhase;
    type: PlaybookTraceEventType;
    actor?: string;
    message?: string;
    refType?: string;
    refId?: string;
    decision?: string;
    reason?: string;
    observedRisk?: string;
    stopConditionHit?: boolean;
    stopCondition?: string;
    payload?: Record<string, unknown>;
  }): Promise<PlaybookTraceEventAppendResponse> {
    return this.transport.requestJson<PlaybookTraceEventAppendResponse>(`/api/playbook-sessions/${sessionId}/events`, {
      method: "POST",
      body: JSON.stringify(payload)
    });
  }

  async getSession(sessionId: string): Promise<PlaybookSessionDetail> {
    return this.transport.requestJson<PlaybookSessionDetail>(`/api/playbook-sessions/${sessionId}`);
  }

  async completeSession(sessionId: string, payload: {
    status?: PlaybookSessionStatus;
    finalSummary?: string;
    failureReason?: string;
  }): Promise<PlaybookSession> {
    return this.transport.requestJson<PlaybookSession>(`/api/playbook-sessions/${sessionId}/complete`, {
      method: "POST",
      body: JSON.stringify(payload)
    });
  }
}
