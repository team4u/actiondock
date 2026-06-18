import type { ZodRawShape } from "zod";

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import type { ActionDockClient } from "../../lib/client.js";
import type { McpPolicy, ToolRisk } from "../types.js";
import { isRiskEnabled } from "./policy.js";
import { toMcpError, toMcpJson } from "./result.js";
import type { McpErrorResult, McpTextResult } from "./result.js";

/**
 * Raw Zod shape accepted as a tool {@code inputSchema} by {@link McpServer}.
 */
export type ToolInputSchema = ZodRawShape;

/**
 * Options for registering an ActionDock-backed MCP tool.
 */
export interface RegisterActionDockToolOptions {
  /** MCP tool name (already normalized, e.g. {@code actiondock_health}). */
  name: string;
  /** Human-readable description shown to MCP clients. */
  description: string;
  /** Risk classification gating whether the tool is registered at all. */
  risk: ToolRisk;
  /** Zod raw shape describing the tool input parameters. */
  inputSchema: ToolInputSchema;
  /** Active policy used for risk gating and result shaping. */
  policy: McpPolicy;
  /** ActionDock client forwarded to the handler. */
  client: ActionDockClient;
  /** Business handler returning raw data; redaction/truncation is applied later. */
  handler: (args: Record<string, unknown>, client: ActionDockClient) => Promise<unknown>;
}

/**
 * Register an ActionDock-backed tool on {@code server} unless its risk level is
 * disabled by {@code policy}. When registered, the handler output is routed
 * through {@link toMcpJson} (redaction + truncation) and any thrown error is
 * converted into an MCP error result via {@link toMcpError}.
 */
export function registerActionDockTool(server: McpServer, options: RegisterActionDockToolOptions): void {
  if (!isRiskEnabled(options.risk, options.policy)) {
    return;
  }

  const handler = async (args: Record<string, unknown>): Promise<McpTextResult | McpErrorResult> => {
    try {
      const data = await options.handler(args, options.client);
      return toMcpJson(data, options.policy);
    } catch (error) {
      return toMcpError(error);
    }
  };

  // The objects returned by toMcpJson/toMcpError are structurally valid
  // CallToolResult values, but the SDK's ToolCallback expects a looser type with
  // an index signature; asserting here keeps our helper return types precise.
  server.registerTool(
    options.name,
    {
      description: options.description,
      inputSchema: options.inputSchema
    },
    handler as never
  );
}
