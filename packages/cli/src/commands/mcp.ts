import { resolve } from "node:path";
import { findProjectRoot, loadProjectConfig } from "@actiondock/core";
import { startMcpHttpServer, startMcpStdio } from "@actiondock/mcp";
import { Command } from "commander";
import { parseByteSize } from "../utils/bytes";
import { parseDuration } from "../utils/duration";

export function registerMcpCommands(program: Command): void {
  const mcpCommand = program
    .command("mcp")
    .description("Model Context Protocol (MCP) server for ActionDock Actions (STDIO default)")
    .option("-d, --dir <path>", "Project root directory (default: current working directory)")
    .option("--package <package-id>", "Specific linked package ID to serve")
    .option("--timeout <duration>", "Execution timeout (e.g. 30s, 5m, 500ms)")
    .action(async (options) => {
      // Default: stdio mode
      let timeoutMs: number | undefined;
      if (options.timeout) {
        try {
          timeoutMs = parseDuration(options.timeout);
        } catch (err: any) {
          process.stderr.write(`Error: ${err.message}\n`);
          process.exit(1);
        }
      }

      try {
        await startMcpStdio({
          projectRoot: options.dir ? resolve(options.dir) : undefined,
          packageId: options.package,
          timeoutMs,
        });
      } catch (err: any) {
        process.stderr.write(`Failed to start MCP STDIO server: ${err.message}\n`);
        process.exit(1);
      }
    });

  mcpCommand
    .command("serve")
    .description("Start the ActionDock MCP server over HTTP transport")
    .option("-p, --port <port>", "Port to listen on (default: 5178)", "5178")
    .option("-H, --host <host>", "Host address to bind to (default: 127.0.0.1)", "127.0.0.1")
    .option("-t, --token <token>", "Authentication token for securing the endpoint (or set ACTIONDOCK_TOKEN)")
    .option("--token-env <env>", "Environment variable name containing the authentication token")
    .option("--allow-insecure-no-auth", "Allow non-loopback host binding without authentication token (INSECURE)")
    .option(
      "--cors-origin <origin>",
      "Allowed CORS origin (can be specified multiple times)",
      (val: string, prev: string[] = []) => [...prev, val],
      []
    )
    .option("--max-body <size>", "Maximum allowed JSON request body size (e.g. 1mb, 500kb)", "1mb")
    .option("-d, --dir <path>", "Project root directory (default: current working directory)")
    .option("--package <package-id>", "Specific linked package ID to serve")
    .option("--timeout <duration>", "Execution timeout (e.g. 30s, 5m, 500ms)")
    .action(async (options) => {
      const port = parseInt(options.port, 10) || 5178;
      const host = options.host || "127.0.0.1";
      const token =
        options.token ||
        (options.tokenEnv ? process.env[options.tokenEnv] : undefined) ||
        process.env.ACTIONDOCK_TOKEN;
      const allowInsecureNoAuth = Boolean(options.allowInsecureNoAuth);
      const corsOrigins =
        options.corsOrigin && options.corsOrigin.length > 0 ? options.corsOrigin : undefined;

      let maxBodyBytes: number | undefined;
      if (options.maxBody) {
        try {
          maxBodyBytes = parseByteSize(options.maxBody);
        } catch (err: any) {
          console.error(`Error: ${err.message}`);
          process.exit(1);
        }
      }

      let timeoutMs: number | undefined;
      if (options.timeout) {
        try {
          timeoutMs = parseDuration(options.timeout);
        } catch (err: any) {
          console.error(`Error: ${err.message}`);
          process.exit(1);
        }
      }

      const projectRoot = options.dir
        ? resolve(options.dir)
        : findProjectRoot(process.cwd());

      let packageName = options.package || "ActionDock MCP Server";
      if (projectRoot) {
        try {
          const config = loadProjectConfig(projectRoot);
          packageName = `${config.name} (${config.id})`;
        } catch {
          // ignore
        }
      }

      try {
        const server = startMcpHttpServer({
          port,
          host,
          token,
          allowInsecureNoAuth,
          corsOrigins,
          maxBodyBytes,
          projectRoot: projectRoot || undefined,
          packageId: options.package,
          timeoutMs,
        });

        console.log(`\n======================================================`);
        console.log(`  ActionDock 2.0 MCP HTTP Server`);
        console.log(`======================================================`);
        console.log(`  * Listening on:    http://${host}:${server.port}`);
        console.log(`  * MCP Endpoint:    http://${host === "0.0.0.0" ? "127.0.0.1" : host}:${server.port}/mcp`);
        console.log(`  * Target:          ${packageName}`);
        console.log(`  * Authentication:  ${token ? "Bearer Token Enabled" : "Disabled (Local)"}`);
        console.log(`  * CORS Origins:    ${corsOrigins ? corsOrigins.join(", ") : "Disabled (Default)"}`);
        console.log(`======================================================\n`);
        console.log(`Press Ctrl+C to terminate.\n`);

        process.on("SIGINT", () => {
          console.log("\nStopping MCP HTTP server...");
          server.stop();
          process.exit(0);
        });
        process.on("SIGTERM", () => {
          server.stop();
          process.exit(0);
        });
      } catch (err: any) {
        console.error(`Failed to start ActionDock MCP HTTP server: ${err.message}`);
        process.exit(1);
      }
    });
}
