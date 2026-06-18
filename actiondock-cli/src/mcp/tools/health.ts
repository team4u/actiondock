import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import type { ActionDockClient } from "../../lib/client.js";
import type { HealthView } from "../../lib/types.js";
import { registerActionDockTool } from "../core/register-tool.js";
import type { McpPolicy } from "../types.js";

/**
 * Context handed to each tool-registration entry point.
 */
export interface HealthToolContext {
  /** ActionDock client used by tool handlers to talk to the backend. */
  client: ActionDockClient;
  /** Active policy gating tool registration and result shaping. */
  policy: McpPolicy;
}

/**
 * Register the {@code actiondock_health} (risk: {@code read}) MCP tool.
 *
 * <p>Calls {@link HealthApi.health} and returns the resulting {@link HealthView}.
 * Input schema is an empty Zod raw shape ({@code {}}): the tool takes no
 * parameters. Registration is delegated to {@link registerActionDockTool} so
 * redaction, truncation, and error wrapping are applied uniformly.
 */
export function registerHealthTools(server: McpServer, ctx: HealthToolContext): void {
  registerActionDockTool(server, {
    name: "actiondock_health",
    description: "Check ActionDock server health (status, server URL, raw details).",
    risk: "read",
    inputSchema: {},
    policy: ctx.policy,
    client: ctx.client,
    handler: async (_args, client): Promise<HealthView> => client.health.health()
  });
}
