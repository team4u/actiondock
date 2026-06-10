import type {
  RepositoryDefinition,
  ProjectRepositoryResolution,
  RepositoryWebhookDescriptor,
  RepositoryWebhookDetail,
  RepositoryWebhookPublishRequest,
  RepositoryLocalAsset,
  RepositoryInstallRequest,
  RepositoryKnowledgeDescriptor,
  RepositoryKnowledgeDetail,
  ResourceLifecycleOperationView,
  RepositoryScriptDescriptor,
  RepositoryScriptDetail,
} from "../types.js";
import type { HttpTransport } from "./http-transport.js";
import { querySuffix } from "./query-suffix.js";

export class RepositoryApi {
  private readonly transport: HttpTransport;

  constructor(transport: HttpTransport) {
    this.transport = transport;
  }

  // ─── Repository CRUD ────────────────────────────────────

  async list(purpose?: string, intent?: string): Promise<RepositoryDefinition[]> {
    const suffix = querySuffix({ purpose, intent });
    return this.transport.requestJson<RepositoryDefinition[]>(`/api/repositories${suffix}`);
  }

  async create(payload: RepositoryDefinition): Promise<RepositoryDefinition> {
    return this.transport.requestJson<RepositoryDefinition>("/api/repositories", {
      method: "POST",
      body: JSON.stringify(payload)
    });
  }

  async update(repositoryId: string, payload: RepositoryDefinition): Promise<RepositoryDefinition> {
    return this.transport.requestJson<RepositoryDefinition>(`/api/repositories/${repositoryId}`, {
      method: "PUT",
      body: JSON.stringify(payload)
    });
  }

  async delete(repositoryId: string): Promise<void> {
    await this.transport.requestJson<null>(`/api/repositories/${repositoryId}`, {
      method: "DELETE"
    });
  }

  async sync(repositoryId: string): Promise<RepositoryDefinition> {
    return this.transport.requestJson<RepositoryDefinition>(`/api/repositories/${repositoryId}/sync`, {
      method: "POST"
    });
  }

  async resolveProject(repositoryId: string): Promise<ProjectRepositoryResolution> {
    return this.transport.requestJson<ProjectRepositoryResolution>(`/api/repositories/resolve?${new URLSearchParams({ repositoryId }).toString()}`);
  }

  // ─── Repository Scripts ─────────────────────────────────

  async listScripts(repositoryId?: string, intent?: string): Promise<RepositoryScriptDescriptor[]> {
    const suffix = querySuffix({ intent });
    if (repositoryId) {
      return this.transport.requestJson<RepositoryScriptDescriptor[]>(`/api/repositories/${repositoryId}/scripts${suffix}`);
    }
    return this.transport.requestJson<RepositoryScriptDescriptor[]>(`/api/repositories/scripts${suffix}`);
  }

  async getScript(repositoryId: string, scriptId: string): Promise<RepositoryScriptDetail> {
    return this.transport.requestJson<RepositoryScriptDetail>(`/api/repositories/${repositoryId}/scripts/${scriptId}`);
  }

  async installTool(
    repositoryId: string,
    scriptId: string,
    payload: RepositoryInstallRequest
  ): Promise<RepositoryLocalAsset> {
    return this.transport.requestJson<RepositoryLocalAsset>(`/api/repositories/${repositoryId}/scripts/${scriptId}/local-assets`, {
      method: "POST",
      body: JSON.stringify({ mode: "LOCKED", ...payload })
    });
  }

  async updateTool(
    repositoryId: string,
    scriptId: string,
    payload: RepositoryInstallRequest
  ): Promise<RepositoryLocalAsset> {
    return this.transport.requestJson<RepositoryLocalAsset>(`/api/repositories/${repositoryId}/scripts/${scriptId}/local-assets/update`, {
      method: "POST",
      body: JSON.stringify(payload)
    });
  }

  async createWorkingCopy(repositoryId: string, scriptId: string, localAssetId?: string): Promise<RepositoryLocalAsset> {
    return this.transport.requestJson<RepositoryLocalAsset>(`/api/repositories/${repositoryId}/scripts/${scriptId}/local-assets`, {
      method: "POST",
      body: JSON.stringify({
        mode: "TRACKED",
        installSchedules: false,
        installScriptDependencies: false,
        installPluginDependencies: false,
        forcePluginUpgrade: false,
        ...(localAssetId ? { localAssetId } : {})
      })
    });
  }

  async uninstallTool(scriptId: string): Promise<void> {
    await this.transport.requestJson<null>(`/api/installed-scripts/${scriptId}`, {
      method: "DELETE"
    });
  }

  // ─── Repository Webhooks ────────────────────────────────

  async listWebhooks(intent?: string): Promise<RepositoryWebhookDescriptor[]> {
    const suffix = querySuffix({ intent });
    return this.transport.requestJson<RepositoryWebhookDescriptor[]>(`/api/repositories/webhooks${suffix}`);
  }

  async listWebhooksByRepository(repositoryId: string, intent?: string): Promise<RepositoryWebhookDescriptor[]> {
    const suffix = querySuffix({ intent });
    return this.transport.requestJson<RepositoryWebhookDescriptor[]>(`/api/repositories/${repositoryId}/webhooks${suffix}`);
  }

  async getWebhook(repositoryId: string, webhookId: string): Promise<RepositoryWebhookDetail> {
    return this.transport.requestJson<RepositoryWebhookDetail>(`/api/repositories/${repositoryId}/webhooks/${webhookId}`);
  }

  async installWebhook(
    repositoryId: string,
    webhookId: string,
    payload: RepositoryInstallRequest
  ): Promise<RepositoryLocalAsset> {
    return this.transport.requestJson<ResourceLifecycleOperationView<RepositoryLocalAsset>>("/api/resource-lifecycle/operations", {
      method: "POST",
      body: JSON.stringify({
        resourceType: "REPOSITORY_WEBHOOK",
        operation: "add-local",
        repositoryId,
        resourceId: webhookId,
        payload: { mode: "LOCKED", ...payload }
      })
    }).then((operation) => operation.result);
  }

  async updateWebhook(
    repositoryId: string,
    webhookId: string,
    payload: RepositoryInstallRequest
  ): Promise<RepositoryLocalAsset> {
    return this.transport.requestJson<ResourceLifecycleOperationView<RepositoryLocalAsset>>("/api/resource-lifecycle/operations", {
      method: "POST",
      body: JSON.stringify({
        resourceType: "REPOSITORY_WEBHOOK",
        operation: "update-local",
        repositoryId,
        resourceId: webhookId,
        payload
      })
    }).then((operation) => operation.result);
  }

  async createWebhookWorkingCopy(
    repositoryId: string,
    webhookId: string,
    localAssetId?: string
  ): Promise<RepositoryLocalAsset> {
    return this.transport.requestJson<ResourceLifecycleOperationView<RepositoryLocalAsset>>("/api/resource-lifecycle/operations", {
      method: "POST",
      body: JSON.stringify({
        resourceType: "REPOSITORY_WEBHOOK",
        operation: "add-local",
        repositoryId,
        resourceId: webhookId,
        payload: {
          mode: "TRACKED",
          installSchedules: false,
          installScriptDependencies: false,
          installPluginDependencies: false,
          forcePluginUpgrade: false,
          ...(localAssetId ? { localAssetId } : {})
        }
      })
    }).then((operation) => operation.result);
  }

  async publishWebhook(
    repositoryId: string,
    payload: RepositoryWebhookPublishRequest
  ): Promise<RepositoryWebhookDescriptor> {
    return this.transport.requestJson<ResourceLifecycleOperationView<RepositoryWebhookDescriptor>>("/api/resource-lifecycle/operations", {
      method: "POST",
      body: JSON.stringify({
        resourceType: "REPOSITORY_WEBHOOK",
        operation: "publish",
        repositoryId,
        payload
      })
    }).then((operation) => operation.result);
  }

  // ─── Repository Knowledge ───────────────────────────────

  async listKnowledge(repositoryId?: string, intent?: string): Promise<RepositoryKnowledgeDescriptor[]> {
    const suffix = querySuffix({ intent });
    const path = repositoryId
      ? `/api/repositories/${repositoryId}/knowledge`
      : "/api/repositories/knowledge";
    return this.transport.requestJson<RepositoryKnowledgeDescriptor[]>(`${path}${suffix}`);
  }

  async getKnowledge(repositoryId: string, knowledgeId: string): Promise<RepositoryKnowledgeDetail> {
    return this.transport.requestJson<RepositoryKnowledgeDetail>(`/api/repositories/${repositoryId}/knowledge/${knowledgeId}`);
  }

  async installKnowledge(repositoryId: string, knowledgeId: string): Promise<RepositoryKnowledgeDescriptor> {
    return this.transport.requestJson<RepositoryKnowledgeDescriptor>(`/api/repositories/${repositoryId}/knowledge/${knowledgeId}/install`, {
      method: "POST"
    });
  }

  async uninstallKnowledge(repositoryId: string, knowledgeId: string): Promise<void> {
    await this.transport.requestJson<null>(`/api/repositories/${repositoryId}/knowledge/${knowledgeId}`, {
      method: "DELETE"
    });
  }
}
