import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type { ActionDockClient } from "../../lib/client.js";
import type { WebhookDefinition, WebhookInvokeResult } from "../../lib/types.js";
import { registerActionDockTool } from "../core/register-tool.js";
import type { McpPolicy } from "../types.js";

/**
 * Context handed to the webhook tool-registration entry point.
 */
export interface WebhookToolContext {
  /** ActionDock client used by tool handlers to talk to the backend. */
  client: ActionDockClient;
  /** Active policy gating tool registration and result shaping. */
  policy: McpPolicy;
}

/**
 * Register the ActionDock webhook MCP tools:
 *
 * <ul>
 *   <li>{@code actiondock_webhook_list} (risk: {@code read}) — lists all webhooks.</li>
 *   <li>{@code actiondock_webhook_get} (risk: {@code read}) — fetches a single webhook.</li>
 *   <li>{@code actiondock_webhook_invoke} (risk: {@code execute}) — invokes a webhook
 *       with an arbitrary payload, returning the raw HTTP response (status, headers, body).</li>
 * </ul>
 *
 * <p>Each tool delegates to {@link registerActionDockTool} so redaction, truncation,
 * and error wrapping are applied uniformly.
 */
export function registerWebhookTools(server: McpServer, ctx: WebhookToolContext): void {
  registerActionDockTool(server, {
    name: "actiondock_webhook_list",
    description: "List all ActionDock webhooks.",
    risk: "read",
    inputSchema: {},
    policy: ctx.policy,
    client: ctx.client,
    handler: async (_args, client): Promise<WebhookDefinition[]> => client.webhooks.list()
  });

  registerActionDockTool(server, {
    name: "actiondock_webhook_get",
    description: "Get a single ActionDock webhook by id.",
    risk: "read",
    inputSchema: { webhookId: z.string() },
    policy: ctx.policy,
    client: ctx.client,
    handler: async (args, client): Promise<WebhookDefinition> =>
      client.webhooks.get(args.webhookId as string)
  });

  registerActionDockTool(server, {
    name: "actiondock_webhook_invoke",
    description:
      "Invoke an ActionDock webhook by id with an arbitrary payload, returning the raw HTTP response (status, headers, body).",
    risk: "execute",
    inputSchema: {
      webhookId: z.string(),
      payload: z.record(z.unknown())
    },
    policy: ctx.policy,
    client: ctx.client,
    handler: async (args, client): Promise<WebhookInvokeResult> =>
      client.webhooks.invoke(args.webhookId as string, (args.payload ?? {}) as never)
  });
}
