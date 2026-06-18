import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type { ActionDockClient } from "../../lib/client.js";
import { registerActionDockTool } from "../core/register-tool.js";
import type { McpServerOptions } from "../types.js";

/**
 * Shared context handed to every {@code register*Tools} helper: the backend
 * client plus the active policy used for risk gating and result shaping.
 */
export type ToolContext = McpServerOptions;

/**
 * Register the execution-inspection MCP tools on {@code server}.
 *
 * <p>Both tools are classified as {@code read} and therefore always registered
 * (read tools are not gated by the policy). They expose the ActionDock
 * execution history as read-only MCP tools:
 *
 * <ul>
 *   <li>{@code actiondock_execution_list} -- list execution records, optionally
 *       filtered by {@code scriptId} or {@code scheduleId}.</li>
 *   <li>{@code actiondock_execution_get} -- fetch a single execution record by
 *       its id.</li>
 * </ul>
 */
export function registerExecutionTools(server: McpServer, ctx: ToolContext): void {
  const { client, policy } = ctx;

  registerActionDockTool(server, {
    name: "actiondock_execution_list",
    description:
      "List ActionDock execution records. Optionally filter by scriptId or scheduleId.",
    risk: "read",
    policy,
    client,
    inputSchema: {
      scriptId: z.string().optional(),
      scheduleId: z.string().optional()
    },
    handler: async (args) =>
      client.executions.list({
        scriptId: args.scriptId as string | undefined,
        scheduleId: args.scheduleId as string | undefined
      })
  });

  registerActionDockTool(server, {
    name: "actiondock_execution_get",
    description: "Get a single ActionDock execution record by its id.",
    risk: "read",
    policy,
    client,
    inputSchema: {
      executionId: z.string()
    },
    handler: async (args) =>
      client.executions.get(args.executionId as string)
  });
}
