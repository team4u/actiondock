import { HttpTransport } from "./http-transport.js";
import { querySuffix } from "./query-suffix.js";
import type { ExecutionPresetUpsertRequest, ExecutionPresetView } from "../types.js";

export class PresetApi {
  constructor(private readonly transport: HttpTransport) {}

  async list(scriptId: string, intent?: string): Promise<ExecutionPresetView[]> {
    const suffix = querySuffix({ intent });
    return this.transport.requestJson<ExecutionPresetView[]>(`/api/scripts/${scriptId}/presets${suffix}`);
  }

  async create(scriptId: string, payload: ExecutionPresetUpsertRequest): Promise<ExecutionPresetView> {
    return this.transport.requestJson<ExecutionPresetView>(`/api/scripts/${scriptId}/presets`, {
      method: "POST",
      body: JSON.stringify(payload)
    });
  }

  async update(scriptId: string, presetId: string, payload: ExecutionPresetUpsertRequest): Promise<ExecutionPresetView> {
    return this.transport.requestJson<ExecutionPresetView>(`/api/scripts/${scriptId}/presets/${presetId}`, {
      method: "PUT",
      body: JSON.stringify(payload)
    });
  }

  async delete(scriptId: string, presetId: string): Promise<void> {
    await this.transport.requestJson<null>(`/api/scripts/${scriptId}/presets/${presetId}`, {
      method: "DELETE"
    });
  }
}
