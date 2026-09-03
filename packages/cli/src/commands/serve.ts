import { resolve } from "node:path";
import { findProjectRoot, loadProjectConfig, startActionDockServer } from "@actiondock/core";
import { createActionDockMcpServer } from "@actiondock/mcp";
import { createMcpHandler } from "@modelcontextprotocol/server";
import { Command } from "commander";
import { parseByteSize } from "../utils/bytes";

export function registerServeCommand(program: Command): void {
  program
    .command("serve")
    .description("Start the ActionDock lightweight HTTP Runner server for remote execution")
    .option("-p, --port <port>", "Port to listen on (default: 5177)", "5177")
    .option("-H, --host <host>", "Host address to bind to (default: 127.0.0.1)", "127.0.0.1")
    .option("-t, --token <token>", "Authentication token for securing the endpoint (or set ACTIONDOCK_TOKEN)")
    .option("--allow-insecure-no-auth", "Allow non-loopback host binding without authentication token (INSECURE)")
    .option(
      "--cors-origin <origin>",
      "Allowed CORS origin (can be specified multiple times)",
      (val: string, prev: string[] = []) => [...prev, val],
      []
    )
    .option("--max-body <size>", "Maximum allowed JSON request body size (e.g. 1mb, 500kb)", "1mb")
    .option("--expose-debug-info", "Expose project root path in health and info responses")
    .option("--no-mcp", "Disable unified MCP protocol endpoint at /mcp")
    .option("-d, --dir <path>", "Project root directory (default: current working directory)")
    .action(async (options) => {
      const port = parseInt(options.port, 10) || 5177;
      const host = options.host || "127.0.0.1";
      const token = options.token || process.env.ACTIONDOCK_TOKEN;
      const allowInsecureNoAuth = Boolean(options.allowInsecureNoAuth);
      const corsOrigins = options.corsOrigin && options.corsOrigin.length > 0 ? options.corsOrigin : undefined;
      const exposeDebugInfo = Boolean(options.exposeDebugInfo);

      let maxBodyBytes: number | undefined;
      if (options.maxBody) {
        try {
          maxBodyBytes = parseByteSize(options.maxBody);
        } catch (err: any) {
          console.error(`Error: ${err.message}`);
          process.exit(1);
        }
      }

      const projectRoot = options.dir
        ? resolve(options.dir)
        : findProjectRoot(process.cwd());

      let projectName = "Global Registry Mode";
      let packageId = "none";

      if (projectRoot) {
        try {
          const config = loadProjectConfig(projectRoot);
          projectName = `${config.name} (${config.id})`;
          packageId = config.id;
        } catch {
          // fallback
        }
      }

      let mcpHandler: ((req: Request) => Promise<Response | null | undefined>) | undefined;
      const enableMcp = options.mcp !== false;
      if (enableMcp) {
        try {
          const handler = createMcpHandler(
            () => {
              return createActionDockMcpServer({
                projectRoot: projectRoot || undefined,
              });
            },
            {
              onerror: (err) => {
                process.stderr.write(`[MCP HTTP Error] ${err?.message || String(err)}\n`);
              },
            }
          );
          mcpHandler = async (req: Request) => {
            return handler.fetch(req);
          };
        } catch {
          // 忽略 MCP 初始化异常
        }
      }

      try {
        const server = startActionDockServer({
          port,
          host,
          token,
          allowInsecureNoAuth,
          corsOrigins,
          maxBodyBytes,
          exposeDebugInfo,
          enableMcp,
          mcpHandler,
          projectRoot: projectRoot || undefined,
        });

        console.log(`\n======================================================`);
        console.log(`  ActionDock 2.0 HTTP Runner Server`);
        console.log(`======================================================`);
        console.log(`  * Listening on:    http://${host}:${server.port}`);
        console.log(`  * Project:         ${projectName}`);
        if (projectRoot && exposeDebugInfo) {
          console.log(`  * Root Path:       ${projectRoot}`);
        }
        console.log(`  * Authentication:  ${token ? "Bearer Token / Query Token Enabled" : "Disabled (Public/Local)"}`);
        console.log(`  * CORS Origins:    ${corsOrigins ? corsOrigins.join(", ") : "Disabled (Default)"}`);
        console.log(`  * Max Body Size:   ${options.maxBody || "1mb"}`);
        console.log(`  * Health Endpoint: http://${host === "0.0.0.0" ? "127.0.0.1" : host}:${server.port}/api/v1/health`);
        if (enableMcp) {
          console.log(`  * MCP Endpoint:    http://${host === "0.0.0.0" ? "127.0.0.1" : host}:${server.port}/mcp`);
        }
        console.log(`======================================================\n`);
        console.log(`Server is ready to accept remote 'ad run' requests.`);
        console.log(`Press Ctrl+C to terminate.\n`);

        // Keep process running
        process.on("SIGINT", () => {
          console.log("\nStopping ActionDock server...");
          server.stop();
          process.exit(0);
        });
        process.on("SIGTERM", () => {
          server.stop();
          process.exit(0);
        });
      } catch (err: any) {
        console.error(`Failed to start ActionDock server: ${err.message}`);
        process.exit(1);
      }
    });
}
