import type {
  UpstreamStatus,
  WebhookDefinition,
  WebhookInvokeResult,
  WebhookRequest,
} from "../types.js";
import type { HttpTransport } from "./http-transport.js";
import { querySuffix } from "./query-suffix.js";

export class WebhookApi {
  private readonly transport: HttpTransport;

  constructor(transport: HttpTransport) {
    this.transport = transport;
  }

  async list(intent?: string): Promise<WebhookDefinition[]> {
    const suffix = querySuffix({ intent });
    return this.transport.requestJson<WebhookDefinition[]>(`/api/webhooks${suffix}`);
  }

  async getUpstreamStatus(webhookId: string): Promise<UpstreamStatus | null> {
    return this.transport.requestJson<UpstreamStatus | null>(`/api/webhooks/${webhookId}/upstream`);
  }

  async pullUpstream(webhookId: string, force = false): Promise<WebhookDefinition> {
    return this.transport.requestJson<WebhookDefinition>(`/api/webhooks/${webhookId}/upstream/pull?force=${force}`, {
      method: "POST"
    });
  }

  async get(webhookId: string): Promise<WebhookDefinition> {
    return this.transport.requestJson<WebhookDefinition>(`/api/webhooks/${webhookId}`);
  }

  async create(definition: WebhookDefinition): Promise<WebhookDefinition> {
    return this.transport.requestJson<WebhookDefinition>("/api/webhooks", {
      method: "POST",
      body: JSON.stringify(definition)
    });
  }

  async update(webhookId: string, definition: WebhookDefinition): Promise<WebhookDefinition> {
    return this.transport.requestJson<WebhookDefinition>(`/api/webhooks/${webhookId}`, {
      method: "PUT",
      body: JSON.stringify(definition)
    });
  }

  async enable(webhookId: string): Promise<WebhookDefinition> {
    return this.transport.requestJson<WebhookDefinition>(`/api/webhooks/${webhookId}/enable`, {
      method: "POST"
    });
  }

  async disable(webhookId: string): Promise<WebhookDefinition> {
    return this.transport.requestJson<WebhookDefinition>(`/api/webhooks/${webhookId}/disable`, {
      method: "POST"
    });
  }

  async delete(webhookId: string): Promise<void> {
    await this.transport.requestJson<null>(`/api/webhooks/${webhookId}`, {
      method: "DELETE"
    });
  }

  async invoke(webhookId: string, payload: WebhookRequest): Promise<WebhookInvokeResult> {
    return this.transport.requestFullResponse(`/api/webhooks/${webhookId}`, {
      method: "POST",
      body: JSON.stringify(payload)
    });
  }
}
