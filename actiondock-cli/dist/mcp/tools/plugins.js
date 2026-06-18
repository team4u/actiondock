import { z } from "zod";
import { registerActionDockTool } from "../core/register-tool.js";
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
export function registerPluginTools(server, ctx) {
    const { client, policy } = ctx;
    registerActionDockTool(server, {
        name: "actiondock_plugin_list",
        description: "List all ActionDock plugins.",
        risk: "read",
        inputSchema: {},
        policy,
        client,
        handler: async () => client.plugins.list()
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
        handler: async (args) => client.plugins.get(args.pluginId)
    });
    registerActionDockTool(server, {
        name: "actiondock_plugin_invoke",
        description: "Invoke an ActionDock plugin action by plugin id and action name, returning the invocation result.",
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
        handler: async (args) => client.plugins.invoke(args.pluginId, args.action, {
            args: args.args ?? {},
            scriptInput: args.scriptInput ?? {},
            responseView: args.responseView,
            configName: args.configName
        })
    });
}
