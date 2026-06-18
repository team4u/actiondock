import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { createActionDockMcpServer } from "../server.js";
import type { ToolContext } from "../types.js";

/**
 * Start the ActionDock MCP server on the stdio transport and block until the
 * transport closes (i.e. until the parent process closes stdin/stdout).
 *
 * <p>After {@link McpServer.connect} resolves, the {@link StdioServerTransport}
 * keeps the Node event loop alive on its own, so this function simply returns
 * and lets the process run. All diagnostic logging goes to stderr; stdout is
 * reserved for the JSON-RPC traffic owned by the transport.
 *
 * @param ctx  shared context carrying the ActionDock client and active policy
 */
export async function startStdio(ctx: ToolContext): Promise<void> {
  const server = await createActionDockMcpServer(ctx);
  const transport = new StdioServerTransport();

  console.error("[actiondock-mcp] stdio transport ready");

  await server.connect(transport);
}
