import { querySuffix } from "./query-suffix.js";
export class RepositoryApi {
    transport;
    constructor(transport) {
        this.transport = transport;
    }
    // ─── Repository CRUD ────────────────────────────────────
    async list(purpose, intent) {
        const suffix = querySuffix({ purpose, intent });
        return this.transport.requestJson(`/api/repositories${suffix}`);
    }
    async create(payload) {
        return this.transport.requestJson("/api/repositories", {
            method: "POST",
            body: JSON.stringify(payload)
        });
    }
    async update(repositoryId, payload) {
        return this.transport.requestJson(`/api/repositories/${repositoryId}`, {
            method: "PUT",
            body: JSON.stringify(payload)
        });
    }
    async delete(repositoryId) {
        await this.transport.requestJson(`/api/repositories/${repositoryId}`, {
            method: "DELETE"
        });
    }
    async sync(repositoryId) {
        return this.transport.requestJson(`/api/repositories/${repositoryId}/sync`, {
            method: "POST"
        });
    }
    async resolveProject(repositoryId) {
        return this.transport.requestJson(`/api/repositories/resolve?${new URLSearchParams({ repositoryId }).toString()}`);
    }
    // ─── Repository Scripts ─────────────────────────────────
    async listScripts(repositoryId, intent) {
        const suffix = querySuffix({ intent });
        if (repositoryId) {
            return this.transport.requestJson(`/api/repositories/${repositoryId}/scripts${suffix}`);
        }
        return this.transport.requestJson(`/api/repositories/scripts${suffix}`);
    }
    async getScript(repositoryId, scriptId) {
        return this.transport.requestJson(`/api/repositories/${repositoryId}/scripts/${scriptId}`);
    }
    async installTool(repositoryId, scriptId, payload) {
        return this.transport.requestJson(`/api/repositories/${repositoryId}/scripts/${scriptId}/local-assets`, {
            method: "POST",
            body: JSON.stringify({ mode: "LOCKED", ...payload })
        });
    }
    async updateTool(repositoryId, scriptId, payload) {
        return this.transport.requestJson(`/api/repositories/${repositoryId}/scripts/${scriptId}/local-assets/update`, {
            method: "POST",
            body: JSON.stringify(payload)
        });
    }
    async createWorkingCopy(repositoryId, scriptId, localAssetId) {
        return this.transport.requestJson(`/api/repositories/${repositoryId}/scripts/${scriptId}/local-assets`, {
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
    async uninstallTool(scriptId) {
        await this.transport.requestJson(`/api/installed-scripts/${scriptId}`, {
            method: "DELETE"
        });
    }
    // ─── Repository Webhooks ────────────────────────────────
    async listWebhooks(intent) {
        const suffix = querySuffix({ intent });
        return this.transport.requestJson(`/api/repositories/webhooks${suffix}`);
    }
    async listWebhooksByRepository(repositoryId, intent) {
        const suffix = querySuffix({ intent });
        return this.transport.requestJson(`/api/repositories/${repositoryId}/webhooks${suffix}`);
    }
    async getWebhook(repositoryId, webhookId) {
        return this.transport.requestJson(`/api/repositories/${repositoryId}/webhooks/${webhookId}`);
    }
    async installWebhook(repositoryId, webhookId, payload) {
        return this.transport.requestJson("/api/resource-lifecycle/operations", {
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
    async updateWebhook(repositoryId, webhookId, payload) {
        return this.transport.requestJson("/api/resource-lifecycle/operations", {
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
    async createWebhookWorkingCopy(repositoryId, webhookId, localAssetId) {
        return this.transport.requestJson("/api/resource-lifecycle/operations", {
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
    async publishWebhook(repositoryId, payload) {
        return this.transport.requestJson("/api/resource-lifecycle/operations", {
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
    async listKnowledge(repositoryId, intent) {
        const suffix = querySuffix({ intent });
        const path = repositoryId
            ? `/api/repositories/${repositoryId}/knowledge`
            : "/api/repositories/knowledge";
        return this.transport.requestJson(`${path}${suffix}`);
    }
    async getKnowledge(repositoryId, knowledgeId) {
        return this.transport.requestJson(`/api/repositories/${repositoryId}/knowledge/${knowledgeId}`);
    }
    async installKnowledge(repositoryId, knowledgeId) {
        return this.transport.requestJson(`/api/repositories/${repositoryId}/knowledge/${knowledgeId}/install`, {
            method: "POST"
        });
    }
    async uninstallKnowledge(repositoryId, knowledgeId) {
        await this.transport.requestJson(`/api/repositories/${repositoryId}/knowledge/${knowledgeId}`, {
            method: "DELETE"
        });
    }
}
