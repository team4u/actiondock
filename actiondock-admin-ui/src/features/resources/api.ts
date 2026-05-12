import { JSON_HEADERS, request, requestBlob } from "../../shared/api/httpClient";
import type {
  CapabilityPackageDescriptor,
  CapabilityPackageDetail,
  CapabilityPackageInstallResult,
  CapabilityPackagePublishPreview,
  CapabilityPackagePublishPreviewRequest,
  CapabilityPackagePublishRequest,
  UpstreamStatus,
  RepositoryDefinition,
  RepositoryEventSourceDescriptor,
  RepositoryEventSourceDetail,
  RepositoryEventSourcePublishPreview,
  RepositoryEventSourcePublishPreviewRequest,
  RepositoryEventSourcePublishRequest,
  RepositoryInstallRequest,
  RepositoryLocalAsset,
  RepositoryLocalAssetRequest,
  RepositoryPluginDescriptor,
  RepositoryPluginInstallRequest,
  RepositoryPluginInstallResult,
  RepositoryPluginPublishRequest,
  RepositoryPublishConfigPreview,
  RepositoryPublishConfigPreviewRequest,
  RepositoryPublishRequest,
  RepositorySkillDescriptor,
  RepositorySkillDetail,
  RepositoryToolDescriptor,
  RepositoryToolDetail,
  ResourceLifecycleOperationView,
  ResourceLifecycleRequest,
  ScriptDefinition
} from "../../shared/types";
import { normalizeScriptDefinition } from "../../services/scriptPublication";

export function listRepositories(): Promise<RepositoryDefinition[]> {
  return request<RepositoryDefinition[]>("/api/repositories");
}

export function createRepository(payload: RepositoryDefinition): Promise<RepositoryDefinition> {
  return request<RepositoryDefinition>("/api/repositories", {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify(payload)
  });
}

export function updateRepository(id: string, payload: RepositoryDefinition): Promise<RepositoryDefinition> {
  return request<RepositoryDefinition>(`/api/repositories/${encodeURIComponent(id)}`, {
    method: "PUT",
    headers: JSON_HEADERS,
    body: JSON.stringify(payload)
  });
}

export function deleteRepository(id: string): Promise<void> {
  return request<void>(`/api/repositories/${encodeURIComponent(id)}`, {
    method: "DELETE"
  });
}

export function syncRepository(id: string): Promise<RepositoryDefinition> {
  return request<RepositoryDefinition>(`/api/repositories/${encodeURIComponent(id)}/sync`, {
    method: "POST"
  });
}

export function listRepositoryTools(): Promise<RepositoryToolDescriptor[]> {
  return request<RepositoryToolDescriptor[]>("/api/repositories/tools");
}

export function listRepositoryEventSources(): Promise<RepositoryEventSourceDescriptor[]> {
  return request<RepositoryEventSourceDescriptor[]>("/api/repositories/event-sources");
}

export function listCapabilityPackages(): Promise<CapabilityPackageDescriptor[]> {
  return request<CapabilityPackageDescriptor[]>("/api/repositories/packages");
}

export function listRepositoryPlugins(): Promise<RepositoryPluginDescriptor[]> {
  return request<RepositoryPluginDescriptor[]>("/api/repositories/plugins");
}

export function listRepositorySkills(): Promise<RepositorySkillDescriptor[]> {
  return request<RepositorySkillDescriptor[]>("/api/repositories/skills");
}

export function listToolsByRepository(id: string): Promise<RepositoryToolDescriptor[]> {
  return request<RepositoryToolDescriptor[]>(`/api/repositories/${encodeURIComponent(id)}/tools`);
}

export function listEventSourcesByRepository(id: string): Promise<RepositoryEventSourceDescriptor[]> {
  return request<RepositoryEventSourceDescriptor[]>(`/api/repositories/${encodeURIComponent(id)}/event-sources`);
}

export function listPluginsByRepository(id: string): Promise<RepositoryPluginDescriptor[]> {
  return request<RepositoryPluginDescriptor[]>(`/api/repositories/${encodeURIComponent(id)}/plugins`);
}

export function listSkillsByRepository(id: string): Promise<RepositorySkillDescriptor[]> {
  return request<RepositorySkillDescriptor[]>(`/api/repositories/${encodeURIComponent(id)}/skills`);
}

export function listCapabilityPackagesByRepository(id: string): Promise<CapabilityPackageDescriptor[]> {
  return request<CapabilityPackageDescriptor[]>(`/api/repositories/${encodeURIComponent(id)}/packages`);
}

export function getRepositoryTool(repositoryId: string, toolId: string): Promise<RepositoryToolDetail> {
  return request<RepositoryToolDetail>(`/api/repositories/${encodeURIComponent(repositoryId)}/tools/${encodeURIComponent(toolId)}`);
}

export function getRepositoryEventSource(repositoryId: string, eventSourceId: string): Promise<RepositoryEventSourceDetail> {
  return request<RepositoryEventSourceDetail>(`/api/repositories/${encodeURIComponent(repositoryId)}/event-sources/${encodeURIComponent(eventSourceId)}`);
}

export function getCapabilityPackage(repositoryId: string, packageId: string): Promise<CapabilityPackageDetail> {
  return request<CapabilityPackageDetail>(`/api/repositories/${encodeURIComponent(repositoryId)}/packages/${encodeURIComponent(packageId)}`);
}

export function getRepositorySkill(repositoryId: string, skillId: string): Promise<RepositorySkillDetail> {
  return request<RepositorySkillDetail>(`/api/repositories/${encodeURIComponent(repositoryId)}/skills/${encodeURIComponent(skillId)}`);
}

export function downloadRepositorySkillArchive(repositoryId: string, skillId: string): Promise<Blob> {
  return requestBlob(`/api/repositories/${encodeURIComponent(repositoryId)}/skills/${encodeURIComponent(skillId)}/archive`);
}

export function runResourceLifecycleOperation<TResult = unknown, TPayload = Record<string, unknown>>(
  payload: ResourceLifecycleRequest<TPayload>
): Promise<ResourceLifecycleOperationView<TResult>> {
  return request<ResourceLifecycleOperationView<TResult>>("/api/resource-lifecycle/operations", {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify(payload)
  });
}

export function addRepositoryToolLocalAsset(repositoryId: string, toolId: string, payload: RepositoryLocalAssetRequest): Promise<RepositoryLocalAsset> {
  return runResourceLifecycleOperation({
    resourceType: "REPOSITORY_TOOL",
    operation: "add-local",
    repositoryId,
    resourceId: toolId,
    payload
  }).then((operation) => operation.result as RepositoryLocalAsset);
}

export function updateRepositoryToolLocalAsset(repositoryId: string, toolId: string, payload: RepositoryInstallRequest): Promise<RepositoryLocalAsset> {
  return runResourceLifecycleOperation({
    resourceType: "REPOSITORY_TOOL",
    operation: "update-local",
    repositoryId,
    resourceId: toolId,
    payload
  }).then((operation) => operation.result as RepositoryLocalAsset);
}

export function addRepositoryEventSourceLocalAsset(
  repositoryId: string,
  eventSourceId: string,
  payload: RepositoryLocalAssetRequest
): Promise<RepositoryLocalAsset> {
  return runResourceLifecycleOperation<RepositoryLocalAsset, RepositoryLocalAssetRequest>({
    resourceType: "REPOSITORY_EVENT_SOURCE",
    operation: "add-local",
    repositoryId,
    resourceId: eventSourceId,
    payload
  }).then((operation) => operation.result);
}

export function updateRepositoryEventSourceLocalAsset(
  repositoryId: string,
  eventSourceId: string,
  payload: RepositoryInstallRequest
): Promise<RepositoryLocalAsset> {
  return runResourceLifecycleOperation<RepositoryLocalAsset, RepositoryInstallRequest>({
    resourceType: "REPOSITORY_EVENT_SOURCE",
    operation: "update-local",
    repositoryId,
    resourceId: eventSourceId,
    payload
  }).then((operation) => operation.result);
}

export function getUpstreamStatus(scriptId: string): Promise<UpstreamStatus> {
  return request<UpstreamStatus>(`/api/scripts/${encodeURIComponent(scriptId)}/upstream`);
}

export function pullUpstreamScript(scriptId: string, force = false): Promise<ScriptDefinition> {
  return request<ScriptDefinition>(`/api/scripts/${encodeURIComponent(scriptId)}/upstream/pull?includeUiSchema=true&force=${force}`, {
    method: "POST"
  }).then(normalizeScriptDefinition);
}

export function installRepositoryPlugin(
  repositoryId: string,
  pluginId: string,
  payload: RepositoryPluginInstallRequest
): Promise<RepositoryPluginInstallResult> {
  return runResourceLifecycleOperation<RepositoryPluginInstallResult, RepositoryPluginInstallRequest>({
    resourceType: "REPOSITORY_PLUGIN",
    operation: "install",
    repositoryId,
    resourceId: pluginId,
    payload
  }).then((operation) => operation.result);
}

export function updateRepositoryPlugin(
  repositoryId: string,
  pluginId: string,
  payload: RepositoryPluginInstallRequest
): Promise<RepositoryPluginInstallResult> {
  return runResourceLifecycleOperation<RepositoryPluginInstallResult, RepositoryPluginInstallRequest>({
    resourceType: "REPOSITORY_PLUGIN",
    operation: "update",
    repositoryId,
    resourceId: pluginId,
    payload
  }).then((operation) => operation.result);
}

export function uninstallInstalledTool(scriptId: string): Promise<void> {
  return request<void>(`/api/installed-tools/${encodeURIComponent(scriptId)}`, {
    method: "DELETE"
  });
}

export function forkRepositoryTool(scriptId: string, payload: { id: string; name: string }): Promise<ScriptDefinition> {
  return request<ScriptDefinition>(`/api/scripts/${encodeURIComponent(scriptId)}/fork?includeUiSchema=true`, {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify(payload)
  }).then(normalizeScriptDefinition);
}

export function publishRepositoryTool(repositoryId: string, payload: RepositoryPublishRequest): Promise<RepositoryToolDescriptor> {
  return runResourceLifecycleOperation<RepositoryToolDescriptor, RepositoryPublishRequest>({
    resourceType: "REPOSITORY_TOOL",
    operation: "publish",
    repositoryId,
    payload
  }).then((operation) => operation.result);
}

export function previewRepositoryEventSourcePublish(
  payload: RepositoryEventSourcePublishPreviewRequest
): Promise<RepositoryEventSourcePublishPreview> {
  return runResourceLifecycleOperation<RepositoryEventSourcePublishPreview, RepositoryEventSourcePublishPreviewRequest>({
    resourceType: "REPOSITORY_EVENT_SOURCE",
    operation: "preview",
    payload
  }).then((operation) => operation.result);
}

export function publishRepositoryEventSource(
  repositoryId: string,
  payload: RepositoryEventSourcePublishRequest
): Promise<RepositoryEventSourceDescriptor> {
  return runResourceLifecycleOperation<RepositoryEventSourceDescriptor, RepositoryEventSourcePublishRequest>({
    resourceType: "REPOSITORY_EVENT_SOURCE",
    operation: "publish",
    repositoryId,
    payload
  }).then((operation) => operation.result);
}

export function previewCapabilityPackagePublish(
  repositoryId: string,
  payload: CapabilityPackagePublishPreviewRequest
): Promise<CapabilityPackagePublishPreview> {
  return runResourceLifecycleOperation<CapabilityPackagePublishPreview, CapabilityPackagePublishPreviewRequest>({
    resourceType: "CAPABILITY_PACKAGE",
    operation: "preview",
    repositoryId,
    payload
  }).then((operation) => operation.result);
}

export function publishCapabilityPackage(
  repositoryId: string,
  payload: CapabilityPackagePublishRequest
): Promise<CapabilityPackageDescriptor> {
  return runResourceLifecycleOperation<CapabilityPackageDescriptor, CapabilityPackagePublishRequest>({
    resourceType: "CAPABILITY_PACKAGE",
    operation: "publish",
    repositoryId,
    payload
  }).then((operation) => operation.result);
}

export function previewRepositoryPublishConfig(
  payload: RepositoryPublishConfigPreviewRequest
): Promise<RepositoryPublishConfigPreview> {
  return runResourceLifecycleOperation<RepositoryPublishConfigPreview, RepositoryPublishConfigPreviewRequest>({
    resourceType: "REPOSITORY_TOOL",
    operation: "preview",
    payload
  }).then((operation) => operation.result);
}

export function publishRepositoryPlugin(repositoryId: string, payload: RepositoryPluginPublishRequest): Promise<RepositoryPluginDescriptor> {
  return runResourceLifecycleOperation<RepositoryPluginDescriptor, RepositoryPluginPublishRequest>({
    resourceType: "REPOSITORY_PLUGIN",
    operation: "publish",
    repositoryId,
    payload
  }).then((operation) => operation.result);
}

export function publishRepositorySkillArchive(
  repositoryId: string,
  payload: { releaseNotes?: string; archive: File | Blob }
): Promise<RepositorySkillDescriptor> {
  const formData = new FormData();
  if (payload.releaseNotes?.trim()) {
    formData.append("releaseNotes", payload.releaseNotes.trim());
  }
  formData.append("archive", payload.archive);
  return request<RepositorySkillDescriptor>(`/api/repositories/${encodeURIComponent(repositoryId)}/publish-skill-archive`, {
    method: "POST",
    body: formData
  });
}

export function installCapabilityPackage(repositoryId: string, packageId: string): Promise<CapabilityPackageInstallResult> {
  return runResourceLifecycleOperation<CapabilityPackageInstallResult>({
    resourceType: "CAPABILITY_PACKAGE",
    operation: "install",
    repositoryId,
    resourceId: packageId
  }).then((operation) => operation.result);
}

export function updateCapabilityPackage(repositoryId: string, packageId: string): Promise<CapabilityPackageInstallResult> {
  return runResourceLifecycleOperation<CapabilityPackageInstallResult>({
    resourceType: "CAPABILITY_PACKAGE",
    operation: "update",
    repositoryId,
    resourceId: packageId
  }).then((operation) => operation.result);
}

export function uninstallCapabilityPackage(repositoryId: string, packageId: string): Promise<void> {
  return runResourceLifecycleOperation<void>({
    resourceType: "CAPABILITY_PACKAGE",
    operation: "uninstall",
    repositoryId,
    resourceId: packageId
  }).then(() => undefined);
}
