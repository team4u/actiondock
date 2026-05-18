import { JSON_HEADERS, request, requestBlob } from "../../shared/api/httpClient";
import type {
  PluginConfigView,
  PluginInvokeRequest,
  PluginInvokeResponse,
  PluginReferenceView,
  PluginSummaryView,
  PluginView
} from "../../shared/types";

export function listPlugins(): Promise<PluginSummaryView[]> {
  return request<PluginSummaryView[]>("/api/plugins");
}

export function listPluginReferences(): Promise<PluginReferenceView[]> {
  return request<PluginReferenceView[]>("/api/plugins/references");
}

export function getPlugin(pluginId: string): Promise<PluginView> {
  return request<PluginView>(`/api/plugins/${pluginId}`);
}

export async function installPlugin(file: File): Promise<PluginView> {
  const formData = new FormData();
  formData.append("file", file);
  return request<PluginView>("/api/plugins/install", {
    method: "POST",
    body: formData
  });
}

export async function upgradePlugin(pluginId: string, file: File): Promise<PluginView> {
  const formData = new FormData();
  formData.append("file", file);
  return request<PluginView>(`/api/plugins/${pluginId}/upgrade`, {
    method: "POST",
    body: formData
  });
}

export function startPlugin(pluginId: string): Promise<PluginView> {
  return request<PluginView>(`/api/plugins/${pluginId}/start`, {
    method: "POST"
  });
}

export function stopPlugin(pluginId: string): Promise<PluginView> {
  return request<PluginView>(`/api/plugins/${pluginId}/stop`, {
    method: "POST"
  });
}

export function uninstallPlugin(pluginId: string, force = false): Promise<void> {
  return request<void>(`/api/plugins/${pluginId}${force ? "?force=true" : ""}`, {
    method: "DELETE"
  });
}

export function downloadPluginJar(pluginId: string): Promise<Blob> {
  return requestBlob(`/api/plugins/${encodeURIComponent(pluginId)}/download`);
}

export function getPluginConfig(pluginId: string): Promise<PluginConfigView> {
  return request<PluginConfigView>(`/api/plugins/${pluginId}/config`);
}

export function updatePluginConfig(pluginId: string, config: Record<string, unknown>): Promise<PluginConfigView> {
  return request<PluginConfigView>(`/api/plugins/${pluginId}/config`, {
    method: "PUT",
    headers: JSON_HEADERS,
    body: JSON.stringify({ config })
  });
}

export function invokePluginAction(
  pluginId: string,
  action: string,
  payload: PluginInvokeRequest
): Promise<PluginInvokeResponse> {
  return request<PluginInvokeResponse>(`/api/plugins/${pluginId}/actions/${action}/invoke`, {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify(payload)
  });
}
