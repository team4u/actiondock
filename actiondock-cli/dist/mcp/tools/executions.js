import { z } from "zod";
import { registerActionDockTool } from "../core/register-tool.js";
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
export function registerExecutionTools(server, ctx) {
    const { client, policy } = ctx;
    registerActionDockTool(server, {
        name: "actiondock_execution_list",
        description: "List ActionDock execution records. Optionally filter by scriptId or scheduleId.",
        risk: "read",
        policy,
        client,
        inputSchema: {
            scriptId: z.string().optional(),
            scheduleId: z.string().optional()
        },
        handler: async (args) => client.executions.list({
            scriptId: args.scriptId,
            scheduleId: args.scheduleId
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
        handler: async (args) => client.executions.get(args.executionId)
    });
}
