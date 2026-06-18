import * as z from "zod";
import { registerActionDockTool } from "../core/register-tool.js";
/**
 * Register the ActionDock playbook MCP tools (read-only) on {@code server}.
 *
 * <p>Exposes two tools:
 * <ul>
 *   <li>{@code actiondock_playbook_list} — list playbooks, optionally filtered by
 *       repository / tag / enabled / managed.</li>
 *   <li>{@code actiondock_playbook_get} — fetch a single playbook by id.</li>
 * </ul>
 *
 * <p>Both are classified as {@code read}, so they are always registered
 * regardless of policy. Outbound request params have {@code undefined} keys
 * stripped so no spurious query-string entries are sent.
 */
export function registerPlaybookTools(server, ctx) {
    registerActionDockTool(server, {
        name: "actiondock_playbook_list",
        description: "List ActionDock playbooks. Optionally filter by repository id, tag, enabled flag, or managed flag.",
        risk: "read",
        policy: ctx.policy,
        client: ctx.client,
        inputSchema: {
            repositoryId: z.string().optional(),
            tag: z.string().optional(),
            enabled: z.boolean().optional(),
            managed: z.boolean().optional()
        },
        handler: async (args) => {
            return ctx.client.playbooks.list({
                repositoryId: args.repositoryId,
                tag: args.tag,
                enabled: args.enabled,
                managed: args.managed
            });
        }
    });
    registerActionDockTool(server, {
        name: "actiondock_playbook_get",
        description: "Fetch a single ActionDock playbook by its id.",
        risk: "read",
        policy: ctx.policy,
        client: ctx.client,
        inputSchema: {
            playbookId: z.string()
        },
        handler: async (args) => {
            return ctx.client.playbooks.get(args.playbookId);
        }
    });
}
