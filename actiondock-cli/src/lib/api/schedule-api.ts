import { HttpTransport } from "./http-transport.js";
import { querySuffix } from "./query-suffix.js";
import type { ScriptScheduleUpsertRequest, ScriptScheduleView } from "../types.js";

export class ScheduleApi {
  constructor(private readonly transport: HttpTransport) {}

  async list(scriptId?: string, intent?: string): Promise<ScriptScheduleView[]> {
    const suffix = querySuffix({ intent });
    if (scriptId) {
      return this.transport.requestJson<ScriptScheduleView[]>(`/api/scripts/${scriptId}/schedules${suffix}`);
    }
    return this.transport.requestJson<ScriptScheduleView[]>(`/api/schedules${suffix}`);
  }

  async get(scheduleId: string): Promise<ScriptScheduleView> {
    return this.transport.requestJson<ScriptScheduleView>(`/api/schedules/${scheduleId}`);
  }

  async create(payload: ScriptScheduleUpsertRequest): Promise<ScriptScheduleView> {
    return this.transport.requestJson<ScriptScheduleView>("/api/schedules", {
      method: "POST",
      body: JSON.stringify(payload)
    });
  }

  async update(scheduleId: string, payload: ScriptScheduleUpsertRequest): Promise<ScriptScheduleView> {
    return this.transport.requestJson<ScriptScheduleView>(`/api/schedules/${scheduleId}`, {
      method: "PUT",
      body: JSON.stringify(payload)
    });
  }

  async enable(scheduleId: string): Promise<ScriptScheduleView> {
    return this.transport.requestJson<ScriptScheduleView>(`/api/schedules/${scheduleId}/enable`, {
      method: "POST"
    });
  }

  async disable(scheduleId: string): Promise<ScriptScheduleView> {
    return this.transport.requestJson<ScriptScheduleView>(`/api/schedules/${scheduleId}/disable`, {
      method: "POST"
    });
  }

  async delete(scheduleId: string): Promise<void> {
    await this.transport.requestJson<null>(`/api/schedules/${scheduleId}`, {
      method: "DELETE"
    });
  }
}
