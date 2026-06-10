import { querySuffix } from "./query-suffix.js";
export class WebhookApi {
    transport;
    constructor(transport) {
        this.transport = transport;
    }
    async list(intent) {
        const suffix = querySuffix({ intent });
        return this.transport.requestJson(`/api/webhooks${suffix}`);
    }
    async getUpstreamStatus(webhookId) {
        return this.transport.requestJson(`/api/webhooks/${webhookId}/upstream`);
    }
    async pullUpstream(webhookId, force = false) {
        return this.transport.requestJson(`/api/webhooks/${webhookId}/upstream/pull?force=${force}`, {
            method: "POST"
        });
    }
    async get(webhookId) {
        return this.transport.requestJson(`/api/webhooks/${webhookId}`);
    }
    async create(definition) {
        return this.transport.requestJson("/api/webhooks", {
            method: "POST",
            body: JSON.stringify(definition)
        });
    }
    async update(webhookId, definition) {
        return this.transport.requestJson(`/api/webhooks/${webhookId}`, {
            method: "PUT",
            body: JSON.stringify(definition)
        });
    }
    async enable(webhookId) {
        return this.transport.requestJson(`/api/webhooks/${webhookId}/enable`, {
            method: "POST"
        });
    }
    async disable(webhookId) {
        return this.transport.requestJson(`/api/webhooks/${webhookId}/disable`, {
            method: "POST"
        });
    }
    async delete(webhookId) {
        await this.transport.requestJson(`/api/webhooks/${webhookId}`, {
            method: "DELETE"
        });
    }
    async invoke(webhookId, payload) {
        return this.transport.requestFullResponse(`/api/webhooks/${webhookId}`, {
            method: "POST",
            body: JSON.stringify(payload)
        });
    }
}
