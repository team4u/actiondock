import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { createActionDockMcpServer, type ActionDockMcpServer } from "./adapter";
import type { ActionDockMcpOptions } from "./types";

/**
 * Starts an ActionDock MCP server over STDIO transport.
 */
export async function startMcpStdio(
  options: ActionDockMcpOptions = {}
): Promise<void> {
  let activeServer: ActionDockMcpServer | undefined;

  const stdioHandler = serveStdio(
    async () => {
      const server = await createActionDockMcpServer(options);
      activeServer = server;
      return server;
    },
    {
      onerror: (err) => {
        process.stderr.write(`[MCP Error] ${err?.message || String(err)}\n`);
      },
    }
  );

  const cleanup = async () => {
    if (activeServer) {
      try {
        await activeServer.close();
      } catch {
        // ignore
      }
    }
  };

  process.once("SIGINT", async () => {
    await cleanup();
    try {
      await stdioHandler.close();
    } catch {}
    process.exit(0);
  });

  process.once("SIGTERM", async () => {
    await cleanup();
    try {
      await stdioHandler.close();
    } catch {}
    process.exit(0);
  });
}
