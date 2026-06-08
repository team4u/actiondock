import type {
  PluginConfigView,
  PluginDownload,
  PluginInvokeRequest,
  PluginInvokeResponse,
  PluginReferenceView,
  PluginSummaryView,
  PluginView,
} from "../types.js";
import { HttpTransport, parseContentDispositionFilename } from "./http-transport.js";
import { querySuffix } from "./query-suffix.js";

export class PluginApi {
  private readonly transport: HttpTransport;

  constructor(transport: HttpTransport) {
    this.transport = transport;
  }

  async list(intent?: string): Promise<PluginSummaryView[]> {
    const suffix = querySuffix({ intent });
    return this.transport.requestJson<PluginSummaryView[]>(`/api/plugins${suffix}`);
  }

  async get(pluginId: string): Promise<PluginView> {
    return this.transport.requestJson<PluginView>(`/api/plugins/${pluginId}`);
  }

  async listReferences(): Promise<PluginReferenceView[]> {
    return this.transport.requestJson<PluginReferenceView[]>("/api/plugins/references");
  }

  async getConfig(pluginId: string): Promise<PluginConfigView> {
    return this.transport.requestJson<PluginConfigView>(`/api/plugins/${pluginId}/config`);
  }

  async listConfigs(pluginId: string): Promise<PluginConfigView[]> {
    return this.transport.requestJson<PluginConfigView[]>(`/api/plugins/${pluginId}/configs`);
  }

  async getNamedConfig(pluginId: string, configName: string): Promise<PluginConfigView> {
    return this.transport.requestJson<PluginConfigView>(`/api/plugins/${pluginId}/configs/${encodeURIComponent(configName)}`);
  }

  async saveConfig(pluginId: string, config: Record<string, unknown>, configName?: string): Promise<PluginConfigView> {
    const pathname = configName
      ? `/api/plugins/${pluginId}/configs/${encodeURIComponent(configName)}`
      : `/api/plugins/${pluginId}/config`;
    return this.transport.requestJson<PluginConfigView>(pathname, {
      method: "PUT",
      body: JSON.stringify({ config })
    });
  }

  async deleteConfig(pluginId: string, configName: string): Promise<void> {
    await this.transport.requestJson<null>(`/api/plugins/${pluginId}/configs/${encodeURIComponent(configName)}`, {
      method: "DELETE"
    });
  }

  async invoke(
    pluginId: string,
    action: string,
    payload: PluginInvokeRequest
  ): Promise<PluginInvokeResponse> {
    return this.transport.requestJson<PluginInvokeResponse>(`/api/plugins/${pluginId}/actions/${action}/invoke`, {
      method: "POST",
      body: JSON.stringify(payload)
    });
  }

  async install(jarPath: string): Promise<PluginView> {
    return this.transport.uploadFile("/api/plugins/install", jarPath);
  }

  async upgrade(pluginId: string, jarPath: string): Promise<PluginView> {
    return this.transport.uploadFile(`/api/plugins/${pluginId}/upgrade`, jarPath);
  }

  async start(pluginId: string): Promise<PluginView> {
    return this.transport.requestJson<PluginView>(`/api/plugins/${pluginId}/start`, {
      method: "POST"
    });
  }

  async stop(pluginId: string): Promise<PluginView> {
    return this.transport.requestJson<PluginView>(`/api/plugins/${pluginId}/stop`, {
      method: "POST"
    });
  }

  async uninstall(pluginId: string, force = false): Promise<void> {
    await this.transport.requestJson<null>(`/api/plugins/${pluginId}?${new URLSearchParams({ force: String(force) }).toString()}`, {
      method: "DELETE"
    });
  }

  async download(pluginId: string): Promise<PluginDownload> {
    const response = await this.transport.requestBinary(`/api/plugins/${pluginId}/download`);
    return {
      filename: parseContentDispositionFilename(response.headers["content-disposition"]) ?? `${pluginId}.jar`,
      content: response.body
    };
  }
}
