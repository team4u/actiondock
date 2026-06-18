import { isRiskEnabled } from "./policy.js";
import { toMcpError, toMcpJson } from "./result.js";
/**
 * Register an ActionDock-backed tool on {@code server} unless its risk level is
 * disabled by {@code policy}. When registered, the handler output is routed
 * through {@link toMcpJson} (redaction + truncation) and any thrown error is
 * converted into an MCP error result via {@link toMcpError}.
 */
export function registerActionDockTool(server, options) {
    if (!isRiskEnabled(options.risk, options.policy)) {
        return;
    }
    const handler = async (args) => {
        try {
            const data = await options.handler(args, options.client);
            return toMcpJson(data, options.policy);
        }
        catch (error) {
            return toMcpError(error);
        }
    };
    // The objects returned by toMcpJson/toMcpError are structurally valid
    // CallToolResult values, but the SDK's ToolCallback expects a looser type with
    // an index signature; asserting here keeps our helper return types precise.
    server.registerTool(options.name, {
        description: options.description,
        inputSchema: options.inputSchema
    }, handler);
}
