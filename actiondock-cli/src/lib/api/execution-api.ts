import { HttpTransport } from "./http-transport.js";
import type { ExecutionResponse } from "../types.js";

export class ExecutionApi {
  constructor(private readonly transport: HttpTransport) {}

  async get(executionId: string): Promise<ExecutionResponse> {
    return this.transport.requestJson<ExecutionResponse>(`/api/executions/${executionId}`);
  }

  async list(params: { scriptId?: string; scheduleId?: string }): Promise<ExecutionResponse[]> {
    const search = new URLSearchParams();
    if (params.scriptId) {
      search.set("scriptId", params.scriptId);
    }
    if (params.scheduleId) {
      search.set("scheduleId", params.scheduleId);
    }
    return this.transport.requestJson<ExecutionResponse[]>(`/api/executions?${search.toString()}`);
  }

  async delete(executionId: string): Promise<void> {
    await this.transport.requestJson<null>(`/api/executions/${executionId}`, {
      method: "DELETE"
    });
  }

  async clear(scriptId?: string): Promise<void> {
    const suffix = scriptId ? `?${new URLSearchParams({ scriptId }).toString()}` : "";
    await this.transport.requestJson<null>(`/api/executions${suffix}`, {
      method: "DELETE"
    });
  }
}
