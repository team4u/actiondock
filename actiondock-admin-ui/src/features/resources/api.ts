import { JSON_HEADERS, request, requestBlob } from "../../shared/api/httpClient";
import type {
  CapabilityPackageDescriptor,
  CapabilityPackageDetail,
  CapabilityPackageInstallResult,
  CapabilityPackagePublishPreview,
  CapabilityPackagePublishPreviewRequest,
  CapabilityPackagePublishRequest,
  KnowledgeFile,
  ProjectRepositoryResolution,
  UpstreamStatus,
  RepositoryDefinition,
  RepositoryKnowledgeDescriptor,
  RepositoryKnowledgeDetail,
  RepositoryWebhookDescriptor,
  RepositoryWebhookDetail,
  RepositoryWebhookPublishPreview,
  RepositoryWebhookPublishPreviewRequest,
  RepositoryWebhookPublishRequest,
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
  RepositoryScriptDescriptor,
  RepositoryScriptDetail,
  ResourceLifecycleOperationView,
  ResourceLifecycleRequest,
  ScriptDefinition
} from "../../shared/types";
import { normalizeScriptDefinition } from "../../services/scriptPublication";

export function listRepositories(purpose?: "CAPABILITY" | "PROJECT"): Promise<RepositoryDefinition[]> {
  const suffix = purpose ? `?purpose=${encodeURIComponent(purpose)}` : "";
  return request<RepositoryDefinition[]>(`/api/repositories${suffix}`);
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

export function resolveProjectRepository(repositoryId: string): Promise<ProjectRepositoryResolution> {
  return request<ProjectRepositoryResolution>(`/api/repositories/resolve?repositoryId=${encodeURIComponent(repositoryId)}`);
}

export function listRepositoryScripts(): Promise<RepositoryScriptDescriptor[]> {
  return request<RepositoryScriptDescriptor[]>("/api/repositories/scripts");
}

export function listRepositoryWebhooks(): Promise<RepositoryWebhookDescriptor[]> {
  return request<RepositoryWebhookDescriptor[]>("/api/repositories/webhooks");
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

export function listRepositoryKnowledge(repositoryId?: string): Promise<RepositoryKnowledgeDescriptor[]> {
  if (repositoryId) {
    return request<RepositoryKnowledgeDescriptor[]>(`/api/repositories/${encodeURIComponent(repositoryId)}/knowledge`);
  }
  return request<RepositoryKnowledgeDescriptor[]>("/api/repositories/knowledge");
}

export function getRepositoryKnowledge(repositoryId: string, knowledgeId: string): Promise<RepositoryKnowledgeDetail> {
  return request<RepositoryKnowledgeDetail>(`/api/repositories/${encodeURIComponent(repositoryId)}/knowledge/${encodeURIComponent(knowledgeId)}`);
}

export function installRepositoryKnowledge(repositoryId: string, knowledgeId: string): Promise<RepositoryKnowledgeDescriptor> {
  return request<RepositoryKnowledgeDescriptor>(`/api/repositories/${encodeURIComponent(repositoryId)}/knowledge/${encodeURIComponent(knowledgeId)}/install`, {
    method: "POST"
  });
}

export function uninstallRepositoryKnowledge(repositoryId: string, knowledgeId: string): Promise<void> {
  return request<void>(`/api/repositories/${encodeURIComponent(repositoryId)}/knowledge/${encodeURIComponent(knowledgeId)}`, {
    method: "DELETE"
  });
}

export function publishRepositoryKnowledge(payload: {
  projectRepositoryId: string;
  targetRepositoryId: string;
  knowledgeId: string;
  displayName: string;
  description?: string;
  tags?: string[];
}): Promise<void> {
  return request<void>("/api/repositories/publish-knowledge", {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify(payload)
  });
}

export function listToolsByRepository(id: string): Promise<RepositoryScriptDescriptor[]> {
  return request<RepositoryScriptDescriptor[]>(`/api/repositories/${encodeURIComponent(id)}/scripts`);
}

export function listWebhooksByRepository(id: string): Promise<RepositoryWebhookDescriptor[]> {
  return request<RepositoryWebhookDescriptor[]>(`/api/repositories/${encodeURIComponent(id)}/webhooks`);
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

export function getRepositoryScript(repositoryId: string, repositoryScriptId: string): Promise<RepositoryScriptDetail> {
  return request<RepositoryScriptDetail>(`/api/repositories/${encodeURIComponent(repositoryId)}/scripts/${encodeURIComponent(repositoryScriptId)}`);
}

export function getRepositoryWebhook(repositoryId: string, webhookId: string): Promise<RepositoryWebhookDetail> {
  return request<RepositoryWebhookDetail>(`/api/repositories/${encodeURIComponent(repositoryId)}/webhooks/${encodeURIComponent(webhookId)}`);
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

export function addRepositoryToolLocalAsset(repositoryId: string, repositoryScriptId: string, payload: RepositoryLocalAssetRequest): Promise<RepositoryLocalAsset> {
  return runResourceLifecycleOperation({
    resourceType: "REPOSITORY_SCRIPT",
    operation: "add-local",
    repositoryId,
    resourceId: repositoryScriptId,
    payload
  }).then((operation) => operation.result as RepositoryLocalAsset);
}

export function updateRepositoryToolLocalAsset(repositoryId: string, repositoryScriptId: string, payload: RepositoryInstallRequest): Promise<RepositoryLocalAsset> {
  return runResourceLifecycleOperation({
    resourceType: "REPOSITORY_SCRIPT",
    operation: "update-local",
    repositoryId,
    resourceId: repositoryScriptId,
    payload
  }).then((operation) => operation.result as RepositoryLocalAsset);
}

export function addRepositoryWebhookLocalAsset(
  repositoryId: string,
  webhookId: string,
  payload: RepositoryLocalAssetRequest
): Promise<RepositoryLocalAsset> {
  return runResourceLifecycleOperation<RepositoryLocalAsset, RepositoryLocalAssetRequest>({
    resourceType: "REPOSITORY_WEBHOOK",
    operation: "add-local",
    repositoryId,
    resourceId: webhookId,
    payload
  }).then((operation) => operation.result);
}

export function updateRepositoryWebhookLocalAsset(
  repositoryId: string,
  webhookId: string,
  payload: RepositoryInstallRequest
): Promise<RepositoryLocalAsset> {
  return runResourceLifecycleOperation<RepositoryLocalAsset, RepositoryInstallRequest>({
    resourceType: "REPOSITORY_WEBHOOK",
    operation: "update-local",
    repositoryId,
    resourceId: webhookId,
    payload
  }).then((operation) => operation.result);
}

export function getUpstreamStatus(scriptId: string): Promise<UpstreamStatus | null> {
  return request<UpstreamStatus | null>(`/api/scripts/${encodeURIComponent(scriptId)}/upstream`);
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
  return request<void>(`/api/installed-scripts/${encodeURIComponent(scriptId)}`, {
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

export function publishRepositoryTool(repositoryId: string, payload: RepositoryPublishRequest): Promise<RepositoryScriptDescriptor> {
  return runResourceLifecycleOperation<RepositoryScriptDescriptor, RepositoryPublishRequest>({
    resourceType: "REPOSITORY_SCRIPT",
    operation: "publish",
    repositoryId,
    payload
  }).then((operation) => operation.result);
}

export function previewRepositoryWebhookPublish(
  payload: RepositoryWebhookPublishPreviewRequest
): Promise<RepositoryWebhookPublishPreview> {
  return runResourceLifecycleOperation<RepositoryWebhookPublishPreview, RepositoryWebhookPublishPreviewRequest>({
    resourceType: "REPOSITORY_WEBHOOK",
    operation: "preview",
    payload
  }).then((operation) => operation.result);
}

export function publishRepositoryWebhook(
  repositoryId: string,
  payload: RepositoryWebhookPublishRequest
): Promise<RepositoryWebhookDescriptor> {
  return runResourceLifecycleOperation<RepositoryWebhookDescriptor, RepositoryWebhookPublishRequest>({
    resourceType: "REPOSITORY_WEBHOOK",
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
    resourceType: "REPOSITORY_SCRIPT",
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
