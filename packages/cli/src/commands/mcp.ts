import { resolve } from "node:path";
import { findProjectRoot, loadProjectConfig } from "@actiondock/core";
import { startMcpHttpServer, startMcpStdio } from "@actiondock/mcp";
import { Command } from "commander";
import { parseByteSize } from "../utils/bytes";
import { parseDuration } from "../utils/duration";

function parseListOption(val: string, prev: string[] = []): string[] {
  const parts = val.split(",").map((s) => s.trim()).filter(Boolean);
  return [...prev, ...parts];
}

export function registerMcpCommands(program: Command): void {
  const mcpCommand = program
    .command("mcp")
    .description("Model Context Protocol (MCP) server for ActionDock Actions (STDIO default)")
    .option(
      "-d, --dir <path>",
      "Project root directory or directories (can be specified multiple times or comma-separated)",
      parseListOption,
      []
    )
    .option(
      "--package <package-id>",
      "Specific linked package ID(s) to serve (can be specified multiple times or comma-separated)",
      parseListOption,
      []
    )
    .option("--all", "Serve all linked packages from global registry")
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

      const projectRoots =
        options.dir && options.dir.length > 0
          ? options.dir.map((d: string) => resolve(d))
          : undefined;
      const packageIds =
        options.package && options.package.length > 0 ? options.package : undefined;
      const all = Boolean(options.all);

      try {
        await startMcpStdio({
          projectRoots,
          packageIds,
          all,
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
    .option(
      "-d, --dir <path>",
      "Project root directory or directories (can be specified multiple times or comma-separated)",
      parseListOption,
      []
    )
    .option(
      "--package <package-id>",
      "Specific linked package ID(s) to serve (can be specified multiple times or comma-separated)",
      parseListOption,
      []
    )
    .option("--all", "Serve all linked packages from global registry")
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

      const projectRoots =
        options.dir && options.dir.length > 0
          ? options.dir.map((d: string) => resolve(d))
          : undefined;
      const packageIds =
        options.package && options.package.length > 0 ? options.package : undefined;
      const all = Boolean(options.all);

      let targetDescription = "ActionDock MCP Server";
      if (all) {
        targetDescription = "All Linked Packages (Global Registry Mode)";
      } else if (packageIds && packageIds.length > 1) {
        targetDescription = `Packages: ${packageIds.join(", ")}`;
      } else if (projectRoots && projectRoots.length > 1) {
        targetDescription = `Directories: ${projectRoots.join(", ")}`;
      } else if (projectRoots && projectRoots.length === 1) {
        try {
          const config = loadProjectConfig(projectRoots[0]);
          targetDescription = `${config.name} (${config.id})`;
        } catch {
          targetDescription = projectRoots[0];
        }
      } else if (packageIds && packageIds.length === 1) {
        targetDescription = `Package: ${packageIds[0]}`;
      } else {
        const currentRoot = findProjectRoot(process.cwd());
        if (currentRoot) {
          try {
            const config = loadProjectConfig(currentRoot);
            targetDescription = `${config.name} (${config.id})`;
          } catch {
            targetDescription = currentRoot;
          }
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
          projectRoots,
          packageIds,
          all,
          timeoutMs,
        });

        console.log(`\n======================================================`);
        console.log(`  ActionDock 2.0 MCP HTTP Server`);
        console.log(`======================================================`);
        console.log(`  * Listening on:    http://${host}:${server.port}`);
        console.log(`  * MCP Endpoint:    http://${host === "0.0.0.0" ? "127.0.0.1" : host}:${server.port}/mcp`);
        console.log(`  * Target:          ${targetDescription}`);
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
