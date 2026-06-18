import { registerActionDockTool } from "../core/register-tool.js";
/**
 * Register the {@code actiondock_health} (risk: {@code read}) MCP tool.
 *
 * <p>Calls {@link HealthApi.health} and returns the resulting {@link HealthView}.
 * Input schema is an empty Zod raw shape ({@code {}}): the tool takes no
 * parameters. Registration is delegated to {@link registerActionDockTool} so
 * redaction, truncation, and error wrapping are applied uniformly.
 */
export function registerHealthTools(server, ctx) {
    registerActionDockTool(server, {
        name: "actiondock_health",
        description: "Check ActionDock server health (status, server URL, raw details).",
        risk: "read",
        inputSchema: {},
        policy: ctx.policy,
        client: ctx.client,
        handler: async (_args, client) => client.health.health()
    });
}
