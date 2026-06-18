import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type { ActionDockClient } from "../../lib/client.js";
import type {
  PluginInvokeResponse,
  PluginSummaryView,
  PluginView
} from "../../lib/types.js";
import { registerActionDockTool } from "../core/register-tool.js";
import type { McpPolicy } from "../types.js";

/**
 * Context handed to the plugin tool-registration entry point.
 */
export interface PluginToolContext {
  /** ActionDock client used by tool handlers to talk to the backend. */
  client: ActionDockClient;
  /** Active policy gating tool registration and result shaping. */
  policy: McpPolicy;
}

/**
 * Register the ActionDock plugin MCP tools:
 *
 * <ul>
 *   <li>{@code actiondock_plugin_list} (risk: {@code read}) — lists all plugins.</li>
 *   <li>{@code actiondock_plugin_get} (risk: {@code read}) — fetches a single plugin by id.</li>
 *   <li>{@code actiondock_plugin_invoke} (risk: {@code execute}) — invokes a plugin
 *       action with optional args / scriptInput, returning the invocation result.</li>
 * </ul>
 *
 * <p>Each tool delegates to {@link registerActionDockTool} so redaction, truncation,
 * and error wrapping are applied uniformly.
 */
export function registerPluginTools(server: McpServer, ctx: PluginToolContext): void {
  const { client, policy } = ctx;

  registerActionDockTool(server, {
    name: "actiondock_plugin_list",
    description: "List all ActionDock plugins.",
    risk: "read",
    inputSchema: {},
    policy,
    client,
    handler: async (): Promise<PluginSummaryView[]> => client.plugins.list()
  });

  registerActionDockTool(server, {
    name: "actiondock_plugin_get",
    description: "Get a single ActionDock plugin by id.",
    risk: "read",
    inputSchema: {
      pluginId: z.string()
    },
    policy,
    client,
    handler: async (args): Promise<PluginView> =>
      client.plugins.get(args.pluginId as string)
  });

  registerActionDockTool(server, {
    name: "actiondock_plugin_invoke",
    description:
      "Invoke an ActionDock plugin action by plugin id and action name, returning the invocation result.",
    risk: "execute",
    inputSchema: {
      pluginId: z.string(),
      action: z.string(),
      args: z.record(z.unknown()).optional(),
      scriptInput: z.record(z.unknown()).optional(),
      responseView: z.enum(["RESULT", "DEBUG"]).optional(),
      configName: z.string().optional()
    },
    policy,
    client,
    handler: async (args): Promise<PluginInvokeResponse> =>
      client.plugins.invoke(
        args.pluginId as string,
        args.action as string,
        {
          args: (args.args as Record<string, unknown>) ?? {},
          scriptInput: (args.scriptInput as Record<string, unknown>) ?? {},
          responseView: args.responseView as "RESULT" | "DEBUG" | undefined,
          configName: args.configName as string | undefined
        }
      )
  });
}
