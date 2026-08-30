import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { createActionDockMcpServer } from "./adapter";
import type { ActionDockMcpOptions } from "./types";

/**
 * Starts an ActionDock MCP server over STDIO transport.
 */
export async function startMcpStdio(
  options: ActionDockMcpOptions = {}
): Promise<void> {
  serveStdio(() => createActionDockMcpServer(options), {
    onerror: (err) => {
      process.stderr.write(`[MCP Error] ${err?.message || String(err)}\n`);
    },
  });
}
