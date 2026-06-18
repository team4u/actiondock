import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerDynamicScriptTools } from "./tools/dynamic-scripts.js";
import { registerExecutionTools } from "./tools/executions.js";
import { registerHealthTools } from "./tools/health.js";
import { registerPlaybookTools } from "./tools/playbooks.js";
import { registerPluginTools } from "./tools/plugins.js";
import { registerRepositoryTools } from "./tools/repositories.js";
import { registerScriptTools } from "./tools/scripts.js";
import { registerWebhookTools } from "./tools/webhooks.js";
/**
 * Server identity reported to the MCP client. The version mirrors the CLI
 * package version conceptually, but is kept as a literal here so server
 * creation never depends on reading files at runtime.
 */
const SERVER_INFO = {
    name: "actiondock",
    version: "0.0.0"
};
/**
 * Build and fully wire an ActionDock {@link McpServer}: all static tools plus
 * one dynamic tool per published (and policy-allowed) script are registered
 * before the server is returned. The caller is responsible for connecting it
 * to a transport.
 *
 * <p>Each {@code register*Tools} helper is best-effort: a failure to register
 * a single tool is logged and does not abort the others, so a usable server
 * is always returned.
 *
 * @param ctx  shared context carrying the ActionDock client and active policy
 * @returns a wired {@link McpServer} ready to be connected to a transport
 */
export async function createActionDockMcpServer(ctx) {
    const server = new McpServer(SERVER_INFO);
    registerHealthTools(server, ctx);
    registerScriptTools(server, ctx);
    registerPluginTools(server, ctx);
    registerRepositoryTools(server, ctx);
    registerWebhookTools(server, ctx);
    registerExecutionTools(server, ctx);
    registerPlaybookTools(server, ctx);
    await registerDynamicScriptTools(server, ctx);
    return server;
}
/**
 * Convenience constructor accepting the client and policy directly. Equivalent
 * to {@link createActionDockMcpServer} wrapped in a tiny object literal.
 */
export async function createServer(client, policy) {
    return createActionDockMcpServer({ client, policy });
}
