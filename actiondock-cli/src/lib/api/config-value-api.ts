import { HttpTransport } from "./http-transport.js";
import { querySuffix } from "./query-suffix.js";
import type { ConfigValueDetailView, ConfigValueRequest, ConfigValueView } from "../types.js";

export class ConfigValueApi {
  constructor(private readonly transport: HttpTransport) {}

  async list(intent?: string): Promise<ConfigValueView[]> {
    const suffix = querySuffix({ intent });
    return this.transport.requestJson<ConfigValueView[]>(`/api/config-values${suffix}`);
  }

  async get(key: string): Promise<ConfigValueDetailView> {
    return this.transport.requestJson<ConfigValueDetailView>(`/api/config-values/${encodeURIComponent(key)}`);
  }

  async create(payload: ConfigValueRequest): Promise<ConfigValueView> {
    return this.transport.requestJson<ConfigValueView>("/api/config-values", {
      method: "POST",
      body: JSON.stringify(payload)
    });
  }

  async update(key: string, payload: ConfigValueRequest): Promise<ConfigValueView> {
    return this.transport.requestJson<ConfigValueView>(`/api/config-values/${encodeURIComponent(key)}`, {
      method: "PUT",
      body: JSON.stringify(payload)
    });
  }

  async copyLocalOverride(key: string): Promise<ConfigValueDetailView> {
    return this.transport.requestJson<ConfigValueDetailView>(`/api/config-values/${encodeURIComponent(key)}/copy-local-override`, {
      method: "POST"
    });
  }

  async restoreRepositoryDefault(key: string): Promise<ConfigValueDetailView> {
    return this.transport.requestJson<ConfigValueDetailView>(`/api/config-values/${encodeURIComponent(key)}/restore-repository-default`, {
      method: "POST"
    });
  }

  async delete(key: string): Promise<void> {
    await this.transport.requestJson<null>(`/api/config-values/${encodeURIComponent(key)}`, {
      method: "DELETE"
    });
  }
}
