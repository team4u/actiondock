import { z } from "zod";
import { registerActionDockTool } from "../core/register-tool.js";
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
export function registerWebhookTools(server, ctx) {
    registerActionDockTool(server, {
        name: "actiondock_webhook_list",
        description: "List all ActionDock webhooks.",
        risk: "read",
        inputSchema: {},
        policy: ctx.policy,
        client: ctx.client,
        handler: async (_args, client) => client.webhooks.list()
    });
    registerActionDockTool(server, {
        name: "actiondock_webhook_get",
        description: "Get a single ActionDock webhook by id.",
        risk: "read",
        inputSchema: { webhookId: z.string() },
        policy: ctx.policy,
        client: ctx.client,
        handler: async (args, client) => client.webhooks.get(args.webhookId)
    });
    registerActionDockTool(server, {
        name: "actiondock_webhook_invoke",
        description: "Invoke an ActionDock webhook by id with an arbitrary payload, returning the raw HTTP response (status, headers, body).",
        risk: "execute",
        inputSchema: {
            webhookId: z.string(),
            payload: z.record(z.unknown())
        },
        policy: ctx.policy,
        client: ctx.client,
        handler: async (args, client) => client.webhooks.invoke(args.webhookId, (args.payload ?? {}))
    });
}
