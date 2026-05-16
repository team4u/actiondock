import http from "node:http";
import https from "node:https";
import fs from "node:fs";
import path from "node:path";
import { URL } from "node:url";

import { ActionDockCliError, isRecord } from "./error.js";
import type {
  ApiEnvelope,
  AccessTokenView,
  ConfigValueDetailView,
  ConfigValueRequest,
  ConfigValueView,
  ExecutionPresetUpsertRequest,
  ExecutionPresetView,
  WebhookDefinition,
  ExecutionResponse,
  PluginConfigView,
  PluginDownload,
  PluginInvokeRequest,
  PluginInvokeResponse,
  PluginReferenceView,
  PluginSummaryView,
  PluginView,
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
  PublishedScriptRevision,
  ScriptScheduleUpsertRequest,
  ScriptScheduleView,
  ScriptDefinition,
  SharedStateCompareAndSetRequest,
  SharedStateCompareAndSetResult,
  SharedStateDetail,
  SharedStateSummary,
  SharedStateRequest,
  UpstreamStatus,
  WebhookInvokeResult,
  WebhookRequest
} from "./types.js";

export interface ClientOptions {
  serverUrl: string;
  token?: string;
}

export interface ExecuteOptions {
  scriptId: string;
  input: Record<string, unknown>;
  mode: "SYNC" | "ASYNC";
  responseView: "RESULT" | "DEBUG";
}

interface RequestOptions {
  method?: string;
  headers?: HeadersInit;
  body?: Buffer | string;
}

interface BinaryResponse {
  body: Buffer;
  headers: http.IncomingHttpHeaders;
}

function normalizeScriptDefinition(script: ScriptDefinition): ScriptDefinition {
  const published = script.published ?? null;
  const publishedFlag = Boolean(script.publication?.published ?? published);
  const dirty = Boolean(script.publication?.dirty);
  return {
    ...script,
    published,
    publication: {
      published: publishedFlag,
      dirty,
      publishedVersion: script.publication?.publishedVersion ?? published?.version,
      publishedAt: script.publication?.publishedAt ?? published?.publishedAt
    }
  };
}

function normalizePublishedRevision(scriptId: string, revision: PublishedScriptRevision): ScriptDefinition {
  return normalizeScriptDefinition({
    id: revision.scriptId || scriptId,
    name: revision.name,
    type: revision.type,
    packaging: revision.packaging,
    source: revision.source,
    pythonRequirements: revision.pythonRequirements,
    inputSchema: revision.inputSchema,
    outputSchema: revision.outputSchema,
    version: revision.version,
    owner: revision.owner,
    description: revision.description,
    tags: revision.tags,
    published: revision,
    publication: {
      published: true,
      dirty: false,
      publishedVersion: revision.version,
      publishedAt: revision.publishedAt
    }
  });
}

export class ActionDockClient {
  constructor(private readonly options: ClientOptions) {}

  async listScripts(): Promise<ScriptDefinition[]> {
    return this.requestJson<ScriptDefinition[]>("/api/scripts").then((items) => items.map(normalizeScriptDefinition));
  }

  async getScript(scriptId: string, draft: boolean): Promise<ScriptDefinition> {
    if (draft) {
      return this.requestJson<ScriptDefinition>(`/api/scripts/${scriptId}`).then(normalizeScriptDefinition);
    }
    return this.requestJson<PublishedScriptRevision>(`/api/scripts/${scriptId}/published`)
      .then((revision) => normalizePublishedRevision(scriptId, revision));
  }

  async createScript(definition: ScriptDefinition): Promise<ScriptDefinition> {
    return this.requestJson<ScriptDefinition>("/api/scripts", {
      method: "POST",
      body: JSON.stringify(definition)
    }).then(normalizeScriptDefinition);
  }

  async deleteScript(scriptId: string): Promise<void> {
    await this.requestJson<null>(`/api/scripts/${scriptId}`, {
      method: "DELETE"
    });
  }

  async forkScript(sourceScriptId: string, payload: { id: string; name: string }): Promise<ScriptDefinition> {
    return this.requestJson<ScriptDefinition>(`/api/scripts/${sourceScriptId}/fork`, {
      method: "POST",
      body: JSON.stringify(payload)
    }).then(normalizeScriptDefinition);
  }

  async patchScript(scriptId: string, patch: Record<string, unknown>): Promise<ScriptDefinition> {
    return this.requestJson<ScriptDefinition>(`/api/scripts/${scriptId}`, {
      method: "PATCH",
      body: JSON.stringify(patch)
    }).then(normalizeScriptDefinition);
  }

  async validateScript(scriptId: string): Promise<void> {
    await this.requestJson<null>(`/api/scripts/${scriptId}/validate`, {
      method: "POST"
    });
  }

  async publishScript(scriptId: string): Promise<ScriptDefinition> {
    return this.requestJson<ScriptDefinition>(`/api/scripts/${scriptId}/publish`, {
      method: "POST"
    }).then(normalizeScriptDefinition);
  }

  async discardDraft(scriptId: string): Promise<ScriptDefinition> {
    return this.requestJson<ScriptDefinition>(`/api/scripts/${scriptId}/discard-draft`, {
      method: "POST"
    }).then(normalizeScriptDefinition);
  }

  async getScriptUpstreamStatus(scriptId: string): Promise<UpstreamStatus | null> {
    return this.requestJson<UpstreamStatus | null>(`/api/scripts/${scriptId}/upstream`);
  }

  async pullUpstreamScript(scriptId: string, force = false): Promise<ScriptDefinition> {
    return this.requestJson<ScriptDefinition>(`/api/scripts/${scriptId}/upstream/pull?force=${force}`, {
      method: "POST"
    }).then(normalizeScriptDefinition);
  }

  async executeScript(options: ExecuteOptions, draft: boolean): Promise<ExecutionResponse> {
    return this.requestJson<ExecutionResponse>(`/api/scripts/${options.scriptId}/execute`, {
      method: "POST",
      body: JSON.stringify({
        input: options.input,
        draft,
        mode: options.mode,
        responseView: options.responseView
      })
    });
  }

  async getExecution(executionId: string): Promise<ExecutionResponse> {
    return this.requestJson<ExecutionResponse>(`/api/executions/${executionId}`);
  }

  async listExecutions(params: { scriptId?: string; scheduleId?: string }): Promise<ExecutionResponse[]> {
    const search = new URLSearchParams();
    if (params.scriptId) {
      search.set("scriptId", params.scriptId);
    }
    if (params.scheduleId) {
      search.set("scheduleId", params.scheduleId);
    }
    return this.requestJson<ExecutionResponse[]>(`/api/executions?${search.toString()}`);
  }

  async deleteExecution(executionId: string): Promise<void> {
    await this.requestJson<null>(`/api/executions/${executionId}`, {
      method: "DELETE"
    });
  }

  async clearExecutions(scriptId?: string): Promise<void> {
    const suffix = scriptId ? `?${new URLSearchParams({ scriptId }).toString()}` : "";
    await this.requestJson<null>(`/api/executions${suffix}`, {
      method: "DELETE"
    });
  }

  async listSchedules(scriptId?: string): Promise<ScriptScheduleView[]> {
    if (scriptId) {
      return this.requestJson<ScriptScheduleView[]>(`/api/scripts/${scriptId}/schedules`);
    }
    return this.requestJson<ScriptScheduleView[]>("/api/schedules");
  }

  async getSchedule(scheduleId: string): Promise<ScriptScheduleView> {
    return this.requestJson<ScriptScheduleView>(`/api/schedules/${scheduleId}`);
  }

  async createSchedule(payload: ScriptScheduleUpsertRequest): Promise<ScriptScheduleView> {
    return this.requestJson<ScriptScheduleView>("/api/schedules", {
      method: "POST",
      body: JSON.stringify(payload)
    });
  }

  async updateSchedule(scheduleId: string, payload: ScriptScheduleUpsertRequest): Promise<ScriptScheduleView> {
    return this.requestJson<ScriptScheduleView>(`/api/schedules/${scheduleId}`, {
      method: "PUT",
      body: JSON.stringify(payload)
    });
  }

  async enableSchedule(scheduleId: string): Promise<ScriptScheduleView> {
    return this.requestJson<ScriptScheduleView>(`/api/schedules/${scheduleId}/enable`, {
      method: "POST"
    });
  }

  async disableSchedule(scheduleId: string): Promise<ScriptScheduleView> {
    return this.requestJson<ScriptScheduleView>(`/api/schedules/${scheduleId}/disable`, {
      method: "POST"
    });
  }

  async deleteSchedule(scheduleId: string): Promise<void> {
    await this.requestJson<null>(`/api/schedules/${scheduleId}`, {
      method: "DELETE"
    });
  }

  async listExecutionPresets(scriptId: string): Promise<ExecutionPresetView[]> {
    return this.requestJson<ExecutionPresetView[]>(`/api/scripts/${scriptId}/presets`);
  }

  async createExecutionPreset(scriptId: string, payload: ExecutionPresetUpsertRequest): Promise<ExecutionPresetView> {
    return this.requestJson<ExecutionPresetView>(`/api/scripts/${scriptId}/presets`, {
      method: "POST",
      body: JSON.stringify(payload)
    });
  }

  async updateExecutionPreset(scriptId: string, presetId: string, payload: ExecutionPresetUpsertRequest): Promise<ExecutionPresetView> {
    return this.requestJson<ExecutionPresetView>(`/api/scripts/${scriptId}/presets/${presetId}`, {
      method: "PUT",
      body: JSON.stringify(payload)
    });
  }

  async deleteExecutionPreset(scriptId: string, presetId: string): Promise<void> {
    await this.requestJson<null>(`/api/scripts/${scriptId}/presets/${presetId}`, {
      method: "DELETE"
    });
  }

  async listWebhooks(): Promise<WebhookDefinition[]> {
    return this.requestJson<WebhookDefinition[]>("/api/webhooks");
  }

  async getWebhookUpstreamStatus(webhookId: string): Promise<UpstreamStatus | null> {
    return this.requestJson<UpstreamStatus | null>(`/api/webhooks/${webhookId}/upstream`);
  }

  async pullUpstreamWebhook(webhookId: string, force = false): Promise<WebhookDefinition> {
    return this.requestJson<WebhookDefinition>(`/api/webhooks/${webhookId}/upstream/pull?force=${force}`, {
      method: "POST"
    });
  }

  async getWebhook(webhookId: string): Promise<WebhookDefinition> {
    return this.requestJson<WebhookDefinition>(`/api/webhooks/${webhookId}`);
  }

  async createWebhook(definition: WebhookDefinition): Promise<WebhookDefinition> {
    return this.requestJson<WebhookDefinition>("/api/webhooks", {
      method: "POST",
      body: JSON.stringify(definition)
    });
  }

  async updateWebhook(webhookId: string, definition: WebhookDefinition): Promise<WebhookDefinition> {
    return this.requestJson<WebhookDefinition>(`/api/webhooks/${webhookId}`, {
      method: "PUT",
      body: JSON.stringify(definition)
    });
  }

  async enableWebhook(webhookId: string): Promise<WebhookDefinition> {
    return this.requestJson<WebhookDefinition>(`/api/webhooks/${webhookId}/enable`, {
      method: "POST"
    });
  }

  async disableWebhook(webhookId: string): Promise<WebhookDefinition> {
    return this.requestJson<WebhookDefinition>(`/api/webhooks/${webhookId}/disable`, {
      method: "POST"
    });
  }

  async deleteWebhook(webhookId: string): Promise<void> {
    await this.requestJson<null>(`/api/webhooks/${webhookId}`, {
      method: "DELETE"
    });
  }

  async invokeWebhook(webhookId: string, payload: WebhookRequest): Promise<WebhookInvokeResult> {
    return this.requestWebhook(`/api/webhooks/${webhookId}`, {
      method: "POST",
      body: JSON.stringify(payload)
    });
  }

  async listPlugins(): Promise<PluginSummaryView[]> {
    return this.requestJson<PluginSummaryView[]>("/api/plugins");
  }

  async listRepositories(purpose?: string): Promise<RepositoryDefinition[]> {
    const suffix = purpose ? `?${new URLSearchParams({ purpose }).toString()}` : "";
    return this.requestJson<RepositoryDefinition[]>(`/api/repositories${suffix}`);
  }

  async createRepository(payload: RepositoryDefinition): Promise<RepositoryDefinition> {
    return this.requestJson<RepositoryDefinition>("/api/repositories", {
      method: "POST",
      body: JSON.stringify(payload)
    });
  }

  async updateRepository(repositoryId: string, payload: RepositoryDefinition): Promise<RepositoryDefinition> {
    return this.requestJson<RepositoryDefinition>(`/api/repositories/${repositoryId}`, {
      method: "PUT",
      body: JSON.stringify(payload)
    });
  }

  async deleteRepository(repositoryId: string): Promise<void> {
    await this.requestJson<null>(`/api/repositories/${repositoryId}`, {
      method: "DELETE"
    });
  }

  async syncRepository(repositoryId: string): Promise<RepositoryDefinition> {
    return this.requestJson<RepositoryDefinition>(`/api/repositories/${repositoryId}/sync`, {
      method: "POST"
    });
  }

  async resolveProjectRepository(repositoryId: string): Promise<ProjectRepositoryResolution> {
    return this.requestJson<ProjectRepositoryResolution>(`/api/repositories/resolve?${new URLSearchParams({ repositoryId }).toString()}`);
  }

  async listRepositoryScripts(repositoryId?: string): Promise<RepositoryScriptDescriptor[]> {
    if (repositoryId) {
      return this.requestJson<RepositoryScriptDescriptor[]>(`/api/repositories/${repositoryId}/scripts`);
    }
    return this.requestJson<RepositoryScriptDescriptor[]>("/api/repositories/scripts");
  }

  async getRepositoryScript(repositoryId: string, scriptId: string): Promise<RepositoryScriptDetail> {
    return this.requestJson<RepositoryScriptDetail>(`/api/repositories/${repositoryId}/scripts/${scriptId}`);
  }

  async installRepositoryTool(
    repositoryId: string,
    scriptId: string,
    payload: RepositoryInstallRequest
  ): Promise<RepositoryLocalAsset> {
    return this.requestJson<RepositoryLocalAsset>(`/api/repositories/${repositoryId}/scripts/${scriptId}/local-assets`, {
      method: "POST",
      body: JSON.stringify({ mode: "LOCKED", ...payload })
    });
  }

  async updateRepositoryTool(
    repositoryId: string,
    scriptId: string,
    payload: RepositoryInstallRequest
  ): Promise<RepositoryLocalAsset> {
    return this.requestJson<RepositoryLocalAsset>(`/api/repositories/${repositoryId}/scripts/${scriptId}/local-assets/update`, {
      method: "POST",
      body: JSON.stringify(payload)
    });
  }

  async createRepositoryToolWorkingCopy(repositoryId: string, scriptId: string, localAssetId?: string): Promise<RepositoryLocalAsset> {
    return this.requestJson<RepositoryLocalAsset>(`/api/repositories/${repositoryId}/scripts/${scriptId}/local-assets`, {
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

  async uninstallRepositoryTool(scriptId: string): Promise<void> {
    await this.requestJson<null>(`/api/installed-scripts/${scriptId}`, {
      method: "DELETE"
    });
  }

  async listRepositoryWebhooks(): Promise<RepositoryWebhookDescriptor[]> {
    return this.requestJson<RepositoryWebhookDescriptor[]>("/api/repositories/webhooks");
  }

  async listRepositoryWebhooksByRepository(repositoryId: string): Promise<RepositoryWebhookDescriptor[]> {
    return this.requestJson<RepositoryWebhookDescriptor[]>(`/api/repositories/${repositoryId}/webhooks`);
  }

  async getRepositoryWebhook(repositoryId: string, webhookId: string): Promise<RepositoryWebhookDetail> {
    return this.requestJson<RepositoryWebhookDetail>(`/api/repositories/${repositoryId}/webhooks/${webhookId}`);
  }

  async installRepositoryWebhook(
    repositoryId: string,
    webhookId: string,
    payload: RepositoryInstallRequest
  ): Promise<RepositoryLocalAsset> {
    return this.requestJson<ResourceLifecycleOperationView<RepositoryLocalAsset>>("/api/resource-lifecycle/operations", {
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

  async updateRepositoryWebhook(
    repositoryId: string,
    webhookId: string,
    payload: RepositoryInstallRequest
  ): Promise<RepositoryLocalAsset> {
    return this.requestJson<ResourceLifecycleOperationView<RepositoryLocalAsset>>("/api/resource-lifecycle/operations", {
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

  async createRepositoryWebhookWorkingCopy(
    repositoryId: string,
    webhookId: string,
    localAssetId?: string
  ): Promise<RepositoryLocalAsset> {
    return this.requestJson<ResourceLifecycleOperationView<RepositoryLocalAsset>>("/api/resource-lifecycle/operations", {
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

  async publishRepositoryWebhook(
    repositoryId: string,
    payload: RepositoryWebhookPublishRequest
  ): Promise<RepositoryWebhookDescriptor> {
    return this.requestJson<ResourceLifecycleOperationView<RepositoryWebhookDescriptor>>("/api/resource-lifecycle/operations", {
      method: "POST",
      body: JSON.stringify({
        resourceType: "REPOSITORY_WEBHOOK",
        operation: "publish",
        repositoryId,
        payload
      })
    }).then((operation) => operation.result);
  }

  async getPlugin(pluginId: string): Promise<PluginView> {
    return this.requestJson<PluginView>(`/api/plugins/${pluginId}`);
  }

  async listPluginReferences(): Promise<PluginReferenceView[]> {
    return this.requestJson<PluginReferenceView[]>("/api/plugins/references");
  }

  async getPluginConfig(pluginId: string): Promise<PluginConfigView> {
    return this.requestJson<PluginConfigView>(`/api/plugins/${pluginId}/config`);
  }

  async savePluginConfig(pluginId: string, config: Record<string, unknown>): Promise<PluginConfigView> {
    return this.requestJson<PluginConfigView>(`/api/plugins/${pluginId}/config`, {
      method: "PUT",
      body: JSON.stringify({ config })
    });
  }

  async invokePlugin(
    pluginId: string,
    action: string,
    payload: PluginInvokeRequest
  ): Promise<PluginInvokeResponse> {
    return this.requestJson<PluginInvokeResponse>(`/api/plugins/${pluginId}/actions/${action}/invoke`, {
      method: "POST",
      body: JSON.stringify(payload)
    });
  }

  async installPlugin(jarPath: string): Promise<PluginView> {
    return this.uploadPluginJar("/api/plugins/install", jarPath);
  }

  async upgradePlugin(pluginId: string, jarPath: string): Promise<PluginView> {
    return this.uploadPluginJar(`/api/plugins/${pluginId}/upgrade`, jarPath);
  }

  async startPlugin(pluginId: string): Promise<PluginView> {
    return this.requestJson<PluginView>(`/api/plugins/${pluginId}/start`, {
      method: "POST"
    });
  }

  async stopPlugin(pluginId: string): Promise<PluginView> {
    return this.requestJson<PluginView>(`/api/plugins/${pluginId}/stop`, {
      method: "POST"
    });
  }

  async uninstallPlugin(pluginId: string, force = false): Promise<void> {
    await this.requestJson<null>(`/api/plugins/${pluginId}?${new URLSearchParams({ force: String(force) }).toString()}`, {
      method: "DELETE"
    });
  }

  async downloadPlugin(pluginId: string): Promise<PluginDownload> {
    const response = await this.requestBinary(`/api/plugins/${pluginId}/download`);
    return {
      filename: parseContentDispositionFilename(response.headers["content-disposition"]) ?? `${pluginId}.jar`,
      content: response.body
    };
  }

  async listConfigValues(): Promise<ConfigValueView[]> {
    return this.requestJson<ConfigValueView[]>("/api/config-values");
  }

  async getConfigValue(key: string): Promise<ConfigValueDetailView> {
    return this.requestJson<ConfigValueDetailView>(`/api/config-values/${encodeURIComponent(key)}`);
  }

  async createConfigValue(payload: ConfigValueRequest): Promise<ConfigValueView> {
    return this.requestJson<ConfigValueView>("/api/config-values", {
      method: "POST",
      body: JSON.stringify(payload)
    });
  }

  async updateConfigValue(key: string, payload: ConfigValueRequest): Promise<ConfigValueView> {
    return this.requestJson<ConfigValueView>(`/api/config-values/${encodeURIComponent(key)}`, {
      method: "PUT",
      body: JSON.stringify(payload)
    });
  }

  async copyConfigValueLocalOverride(key: string): Promise<ConfigValueDetailView> {
    return this.requestJson<ConfigValueDetailView>(`/api/config-values/${encodeURIComponent(key)}/copy-local-override`, {
      method: "POST"
    });
  }

  async restoreConfigValueRepositoryDefault(key: string): Promise<ConfigValueDetailView> {
    return this.requestJson<ConfigValueDetailView>(`/api/config-values/${encodeURIComponent(key)}/restore-repository-default`, {
      method: "POST"
    });
  }

  async deleteConfigValue(key: string): Promise<void> {
    await this.requestJson<null>(`/api/config-values/${encodeURIComponent(key)}`, {
      method: "DELETE"
    });
  }

  async listAccessTokens(): Promise<AccessTokenView[]> {
    return this.requestJson<AccessTokenView[]>("/api/access-tokens");
  }

  async createAccessToken(name?: string): Promise<AccessTokenView> {
    return this.requestJson<AccessTokenView>("/api/access-tokens", {
      method: "POST",
      body: JSON.stringify({ name })
    });
  }

  async renameAccessToken(tokenId: string, name?: string): Promise<AccessTokenView> {
    return this.requestJson<AccessTokenView>(`/api/access-tokens/${tokenId}`, {
      method: "PUT",
      body: JSON.stringify({ name })
    });
  }

  async enableAccessToken(tokenId: string): Promise<AccessTokenView> {
    return this.requestJson<AccessTokenView>(`/api/access-tokens/${tokenId}/enable`, {
      method: "POST"
    });
  }

  async disableAccessToken(tokenId: string): Promise<AccessTokenView> {
    return this.requestJson<AccessTokenView>(`/api/access-tokens/${tokenId}/disable`, {
      method: "POST"
    });
  }

  async deleteAccessToken(tokenId: string): Promise<void> {
    await this.requestJson<null>(`/api/access-tokens/${tokenId}`, {
      method: "DELETE"
    });
  }

  async putSharedState(payload: SharedStateRequest): Promise<SharedStateDetail> {
    return this.requestJson<SharedStateDetail>("/api/shared-state", {
      method: "PUT",
      body: JSON.stringify(payload)
    });
  }

  async listSharedStateNamespaces(): Promise<string[]> {
    return this.requestJson<string[]>("/api/shared-state/namespaces");
  }

  async listSharedState(namespace: string): Promise<SharedStateSummary[]> {
    return this.requestJson<SharedStateSummary[]>(`/api/shared-state?${new URLSearchParams({ namespace }).toString()}`);
  }

  async getSharedState(namespace: string, key: string): Promise<SharedStateDetail> {
    return this.requestJson<SharedStateDetail>(
      `/api/shared-state/detail?${new URLSearchParams({ namespace, key }).toString()}`
    );
  }

  async compareAndSetSharedState(
    payload: SharedStateCompareAndSetRequest
  ): Promise<SharedStateCompareAndSetResult> {
    return this.requestJson<SharedStateCompareAndSetResult>("/api/shared-state/cas", {
      method: "POST",
      body: JSON.stringify(payload)
    });
  }

  async deleteSharedState(namespace: string, key: string): Promise<void> {
    await this.requestJson<null>(`/api/shared-state?${new URLSearchParams({ namespace, key }).toString()}`, {
      method: "DELETE"
    });
  }

  async purgeExpiredSharedState(namespace?: string): Promise<number> {
    const suffix = namespace ? `?${new URLSearchParams({ namespace }).toString()}` : "";
    return this.requestJson<number>(`/api/shared-state/purge-expired${suffix}`, {
      method: "POST"
    });
  }

  async listRepositoryKnowledge(repositoryId?: string): Promise<RepositoryKnowledgeDescriptor[]> {
    const path = repositoryId
      ? `/api/repositories/${repositoryId}/knowledge`
      : "/api/repositories/knowledge";
    return this.requestJson<RepositoryKnowledgeDescriptor[]>(path);
  }

  async getRepositoryKnowledge(repositoryId: string, knowledgeId: string): Promise<RepositoryKnowledgeDetail> {
    return this.requestJson<RepositoryKnowledgeDetail>(`/api/repositories/${repositoryId}/knowledge/${knowledgeId}`);
  }

  async installRepositoryKnowledge(repositoryId: string, knowledgeId: string): Promise<RepositoryKnowledgeDescriptor> {
    return this.requestJson<RepositoryKnowledgeDescriptor>(`/api/repositories/${repositoryId}/knowledge/${knowledgeId}/install`, {
      method: "POST"
    });
  }

  async uninstallRepositoryKnowledge(repositoryId: string, knowledgeId: string): Promise<void> {
    await this.requestJson<null>(`/api/repositories/${repositoryId}/knowledge/${knowledgeId}`, {
      method: "DELETE"
    });
  }

  private async requestJson<T>(pathname: string, init?: RequestOptions): Promise<T> {
    const url = new URL(`${this.options.serverUrl}${pathname}`);
    const method = init?.method ?? "GET";
    const headers = this.buildHeaders(init?.headers, init?.body);
    const body = init?.body;
    const transport = url.protocol === "https:" ? https : http;
    const payload = await new Promise<{ statusCode: number; bodyText: string }>((resolve, reject) => {
      const request = transport.request(url, {
        method,
        headers,
      }, (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk) => {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        });
        response.on("end", () => {
          resolve({
            statusCode: response.statusCode ?? 500,
            bodyText: Buffer.concat(chunks).toString("utf8")
          });
        });
      });

      request.on("error", (error) => {
        reject(error);
      });
      if (body) {
        request.write(body);
      }
      request.end();
    }).catch((error: unknown) => {
      const detail = error instanceof Error ? error.message : String(error);
      throw new ActionDockCliError(`请求 ActionDock 服务失败: ${detail}`, 4);
    });

    const parsed = parseMaybeJson(payload.bodyText);

    if (payload.statusCode < 200 || payload.statusCode >= 300) {
      const message = isRecord(parsed) && typeof parsed.msg === "string"
        ? parsed.msg
        : `请求失败: HTTP ${payload.statusCode}`;
      const exitCode = payload.statusCode === 401 || payload.statusCode === 403 ? 3 : 5;
      throw new ActionDockCliError(message, exitCode, parsed ?? payload.bodyText);
    }

    if (!isRecord(parsed) || typeof parsed.status !== "number" || !("data" in parsed)) {
      throw new ActionDockCliError(`服务端响应格式非法: ${pathname}`, 5, parsed ?? payload.bodyText);
    }

    return (parsed as unknown as ApiEnvelope<T>).data;
  }

  private async requestBinary(pathname: string, init?: RequestOptions): Promise<BinaryResponse> {
    const url = new URL(`${this.options.serverUrl}${pathname}`);
    const method = init?.method ?? "GET";
    const headers = this.buildHeaders(init?.headers, init?.body);
    const body = init?.body;
    const transport = url.protocol === "https:" ? https : http;
    const payload = await new Promise<{ statusCode: number; body: Buffer; headers: http.IncomingHttpHeaders }>((resolve, reject) => {
      const request = transport.request(url, { method, headers }, (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk) => {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        });
        response.on("end", () => {
          resolve({
            statusCode: response.statusCode ?? 500,
            body: Buffer.concat(chunks),
            headers: response.headers
          });
        });
      });
      request.on("error", (error) => {
        reject(error);
      });
      if (body) {
        request.write(body);
      }
      request.end();
    }).catch((error: unknown) => {
      const detail = error instanceof Error ? error.message : String(error);
      throw new ActionDockCliError(`请求 ActionDock 服务失败: ${detail}`, 4);
    });

    if (payload.statusCode < 200 || payload.statusCode >= 300) {
      const text = payload.body.toString("utf8");
      const parsed = parseMaybeJson(text);
      const message = isRecord(parsed) && typeof parsed.msg === "string"
        ? parsed.msg
        : `请求失败: HTTP ${payload.statusCode}`;
      const exitCode = payload.statusCode === 401 || payload.statusCode === 403 ? 3 : 5;
      throw new ActionDockCliError(message, exitCode, parsed ?? text);
    }

    return {
      body: payload.body,
      headers: payload.headers
    };
  }

  private async requestWebhook(pathname: string, init?: RequestOptions): Promise<WebhookInvokeResult> {
    const url = new URL(`${this.options.serverUrl}${pathname}`);
    const method = init?.method ?? "GET";
    const headers = this.buildHeaders(init?.headers, init?.body);
    const body = init?.body;
    const transport = url.protocol === "https:" ? https : http;
    const payload = await new Promise<{ statusCode: number; bodyText: string; headers: http.IncomingHttpHeaders }>((resolve, reject) => {
      const request = transport.request(url, { method, headers }, (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk) => {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        });
        response.on("end", () => {
          resolve({
            statusCode: response.statusCode ?? 500,
            bodyText: Buffer.concat(chunks).toString("utf8"),
            headers: response.headers
          });
        });
      });
      request.on("error", (error) => reject(error));
      if (body) {
        request.write(body);
      }
      request.end();
    }).catch((error: unknown) => {
      const detail = error instanceof Error ? error.message : String(error);
      throw new ActionDockCliError(`请求 ActionDock 服务失败: ${detail}`, 4);
    });

    const parsedBody = parseMaybeJson(payload.bodyText);
    const normalizedHeaders: Record<string, string[]> = {};
    for (const [key, value] of Object.entries(payload.headers)) {
      if (value === undefined) {
        continue;
      }
      normalizedHeaders[key] = Array.isArray(value) ? value.map(String) : [String(value)];
    }

    if (payload.statusCode < 200 || payload.statusCode >= 300) {
      const message = isRecord(parsedBody) && typeof parsedBody.msg === "string"
        ? parsedBody.msg
        : `请求失败: HTTP ${payload.statusCode}`;
      const exitCode = payload.statusCode === 401 || payload.statusCode === 403 ? 3 : 5;
      throw new ActionDockCliError(message, exitCode, parsedBody ?? payload.bodyText);
    }

    return {
      status: payload.statusCode,
      headers: normalizedHeaders,
      body: parsedBody
    };
  }

  private buildHeaders(headers: HeadersInit | undefined, body: Buffer | string | undefined): Record<string, string> {
    const result = new Headers(headers);
    if (!result.has("Accept")) {
      result.set("Accept", "application/json");
    }
    if (body && !result.has("Content-Type")) {
      result.set("Content-Type", "application/json");
    }
    if (this.options.token && !result.has("Authorization")) {
      result.set("Authorization", `Bearer ${this.options.token}`);
    }
    result.set("Connection", "close");
    return Object.fromEntries(result.entries());
  }

  private uploadPluginJar(pathname: string, jarPath: string): Promise<PluginView> {
    const { body, boundary } = buildMultipartFileBody(jarPath);
    return this.requestJson<PluginView>(pathname, {
      method: "POST",
      headers: {
        "Content-Type": `multipart/form-data; boundary=${boundary}`,
        "Content-Length": String(body.byteLength)
      },
      body
    });
  }
}

function parseContentDispositionFilename(header: string | string[] | undefined): string | undefined {
  const value = Array.isArray(header) ? header[0] : header;
  const match = value?.match(/filename="([^"]+)"/i) ?? value?.match(/filename=([^;]+)/i);
  return match?.[1]?.trim();
}

function buildMultipartFileBody(jarPath: string): { body: Buffer; boundary: string } {
  const filename = path.basename(jarPath);
  const fileBytes = fs.readFileSync(jarPath);
  const boundary = `----actiondock-cli-${Date.now().toString(16)}`;
  return {
    boundary,
    body: Buffer.concat([
      Buffer.from(
        `--${boundary}\r\n`
        + `Content-Disposition: form-data; name="file"; filename="${escapeMultipartFilename(filename)}"\r\n`
        + "Content-Type: application/java-archive\r\n\r\n",
        "utf8"
      ),
      fileBytes,
      Buffer.from(`\r\n--${boundary}--\r\n`, "utf8")
    ])
  };
}

function parseMaybeJson(text: string): unknown {
  if (!text.trim()) {
    return null;
  }
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function escapeMultipartFilename(filename: string): string {
  return filename.replace(/["\r\n]/g, "_");
}
