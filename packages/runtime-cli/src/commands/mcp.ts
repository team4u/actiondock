import { resolve } from "node:path";
import { findProjectRoot, loadProjectConfig, parseDuration } from "@actiondock/core";
import { startMcpHttpServer, startMcpStdio } from "@actiondock/mcp";
import { Command } from "commander";
import { ArgumentError, ExecutionError } from "../errors";
import { writeStderr, writeStdout } from "../renderer";
import type { RuntimeCliContext } from "../types";
import { getEffectiveOptions, parseByteSize, parseListOption } from "../utils";

/**
 * 注册 mcp 命令（STDIO 与 HTTP 传输服务模式）。
 * 
 * @param program Commander 实例
 * @param context 运行时上下文
 */
export function registerMcpCommands(program: Command, context?: RuntimeCliContext): void {
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
    .action(async (rawOptions: any, cmd: any) => {
      const options = getEffectiveOptions(rawOptions, cmd);
      let timeoutMs: number | undefined;
      if (options.timeout) {
        try {
          timeoutMs = parseDuration(options.timeout);
        } catch (err: any) {
          throw new ArgumentError(`Invalid timeout format: ${err.message}`);
        }
      }

      let projectRoots =
        options.dir && options.dir.length > 0
          ? options.dir.map((d: string) => resolve(d))
          : undefined;

      let packageIds =
        options.package && options.package.length > 0 ? options.package : undefined;

      if (context?.standalone) {
        packageIds = [context.standalone.packageId];
      }

      const all = Boolean(options.all);

      try {
        await startMcpStdio({
          projectRoots,
          packageIds,
          all,
          timeoutMs,
        });
      } catch (err: any) {
        throw new ExecutionError(`Failed to start MCP STDIO server: ${err.message}`, err);
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
    .action(async (rawOptions: any, cmd: any) => {
      const options = getEffectiveOptions(rawOptions, cmd);
      const port = parseInt(options.port, 10) || 5178;
      const host = options.host || "127.0.0.1";
      const token =
        options.token ||
        (options.tokenEnv && typeof process !== "undefined" ? process.env?.[options.tokenEnv] : undefined) ||
        (typeof process !== "undefined" ? process.env?.ACTIONDOCK_TOKEN : undefined);

      const allowInsecureNoAuth = Boolean(options.allowInsecureNoAuth);
      const corsOrigins =
        options.corsOrigin && options.corsOrigin.length > 0 ? options.corsOrigin : undefined;

      let maxBodyBytes: number | undefined;
      if (options.maxBody) {
        try {
          maxBodyBytes = parseByteSize(options.maxBody);
        } catch (err: any) {
          throw new ArgumentError(`Invalid max-body format: ${err.message}`);
        }
      }

      let timeoutMs: number | undefined;
      if (options.timeout) {
        try {
          timeoutMs = parseDuration(options.timeout);
        } catch (err: any) {
          throw new ArgumentError(`Invalid timeout format: ${err.message}`);
        }
      }

      let projectRoots =
        options.dir && options.dir.length > 0
          ? options.dir.map((d: string) => resolve(d))
          : undefined;

      let packageIds =
        options.package && options.package.length > 0 ? options.package : undefined;

      if (context?.standalone) {
        packageIds = [context.standalone.packageId];
      }

      const all = Boolean(options.all);

      let targetDescription = "ActionDock MCP Server";
      if (context?.standalone) {
        targetDescription = `Package: ${context.standalone.packageId} (Standalone)`;
      } else if (all) {
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

        writeStdout(`\n======================================================`, context);
        writeStdout(`  ActionDock 2.0 MCP HTTP Server`, context);
        writeStdout(`======================================================`, context);
        writeStdout(`  * Listening on:    http://${host}:${server.port}`, context);
        writeStdout(`  * MCP Endpoint:    http://${host === "0.0.0.0" ? "127.0.0.1" : host}:${server.port}/mcp`, context);
        writeStdout(`  * Target:          ${targetDescription}`, context);
        writeStdout(`  * Authentication:  ${token ? "Bearer Token Enabled" : "Disabled (Local)"}`, context);
        writeStdout(`  * CORS Origins:    ${corsOrigins ? corsOrigins.join(", ") : "Disabled (Default)"}`, context);
        writeStdout(`======================================================\n`, context);
        writeStdout(`Press Ctrl+C to terminate.\n`, context);

        const stopSignalHandler = () => {
          writeStdout("\nStopping MCP HTTP server...", context);
          server.stop();
        };

        process.once("SIGINT", stopSignalHandler);
        process.once("SIGTERM", stopSignalHandler);
      } catch (err: any) {
        throw new ExecutionError(`Failed to start ActionDock MCP HTTP server: ${err.message}`, err);
      }
    });
}
