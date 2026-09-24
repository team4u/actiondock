import { resolve } from "node:path";
import {
  createNodePlatform,
  findProjectRoot,
  loadProjectConfig,
} from "@actiondock/core";
import {
  formatHostForUrl,
} from "@actiondock/core/server";
import { Command } from "commander";
import { ExecutionError } from "../errors";
import { writeStdout } from "../renderer";
import type { CliContext } from "../types";
import {
  getEffectiveOptions,
  normalizeCorsOrigins,
  parseListOption,
  printServerBanner,
  registerStopSignalHandler,
  resolveMaxBodyBytes,
  resolveServerHost,
  resolveServerPort,
  resolveServerToken,
  resolveTimeoutMs,
} from "../utils";

/**
 * mcp 命令双分支（STDIO 与 HTTP serve）共享的目标选项解析视图。
 */
interface McpServeOptions {
  /** 显式指定的工程根目录列表（-d/--dir，已绝对化；缺省 undefined） */
  projectRoots: string[] | undefined;
  /** 显式指定的链接包标识列表（--package；缺省 undefined） */
  packageIds: string[] | undefined;
  /** 是否服务全局注册表中的全部链接包 */
  all: boolean;
  /** 执行超时毫秒数 */
  timeoutMs: number | undefined;
}

/**
 * 解析 mcp 命令双分支共享的目标选项（目录、包、超时）。
 */
function resolveMcpServeOptions(options: any): McpServeOptions {
  return {
    projectRoots:
      options.dir && options.dir.length > 0
        ? options.dir.map((d: string) => resolve(d))
        : undefined,
    packageIds:
      options.package && options.package.length > 0 ? options.package : undefined,
    all: Boolean(options.all),
    timeoutMs: resolveTimeoutMs(options.timeout),
  };
}

/**
 * 注册 mcp 命令（STDIO 与 HTTP 传输服务模式）。
 *
 * @param program Commander 实例
 * @param context 命令行上下文
 */
export function registerMcpCommands(program: Command, context?: CliContext): void {
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
    .option("--data-dir <path>", "Custom database storage directory")
    .action(async (rawOptions: any, cmd: any) => {
      const options = getEffectiveOptions(rawOptions, cmd);
      const { projectRoots, packageIds, all, timeoutMs } = resolveMcpServeOptions(options);

      try {
        const { startMcpStdio } = await import("@actiondock/mcp");
        await startMcpStdio({
          projectRoots,
          packageIds,
          all,
          timeoutMs,
          customHome: context?.customHome,
          dataDir: options.dataDir || context?.dataDir,
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
    .option("--allow-insecure-http", "Allow insecure HTTP connections with auth token (INSECURE)")
    .option("--allow-query-token", "Allow passing authentication token via URL query parameter (INSECURE)")
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
    .option("--data-dir <path>", "Custom database storage directory")
    .action(async (rawOptions: any, cmd: any) => {
      const options = getEffectiveOptions(rawOptions, cmd);
      const port = resolveServerPort(options.port, 5178, true);
      const host = resolveServerHost(options.host);
      const token = resolveServerToken(options.token, options.tokenEnv);

      const allowInsecureNoAuth = Boolean(options.allowInsecureNoAuth);
      const allowInsecureHttp = Boolean(options.allowInsecureHttp);
      const allowQueryToken = Boolean(options.allowQueryToken);
      const corsOrigins = normalizeCorsOrigins(options.corsOrigin);
      const maxBodyBytes = resolveMaxBodyBytes(options.maxBody);

      const { projectRoots, packageIds, all, timeoutMs } = resolveMcpServeOptions(options);

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
        const platform = createNodePlatform({
          customHome: context?.customHome,
          dataDir: options.dataDir || context?.dataDir,
          rootDir: projectRoots?.[0],
        });
        const { startMcpHttpServer } = await import("@actiondock/mcp");
        const server = await startMcpHttpServer({
          port,
          host,
          token,
          allowInsecureNoAuth,
          allowInsecureHttp,
          allowQueryToken,
          corsOrigins,
          maxBodyBytes,
          projectRoots,
          packageIds,
          all,
          timeoutMs,
          customHome: context?.customHome,
          dataDir: options.dataDir || context?.dataDir,
          platform,
        });

        const displayHost = formatHostForUrl(host);
        const actualMcpHost = formatHostForUrl(host === "0.0.0.0" ? "127.0.0.1" : host);

        printServerBanner(`ActionDock 2.0 MCP HTTP Server`, "http", displayHost, server.port, context);
        writeStdout(`  * MCP Endpoint:    http://${actualMcpHost}:${server.port}/mcp`, context);
        writeStdout(`  * Target:          ${targetDescription}`, context);
        writeStdout(`  * Authentication:  ${token ? "Bearer Token Enabled" : "Disabled (Local)"}`, context);
        writeStdout(`  * CORS Origins:    ${corsOrigins ? corsOrigins.join(", ") : "Disabled (Default)"}`, context);
        writeStdout(`======================================================\n`, context);
        writeStdout(`Press Ctrl+C to terminate.\n`, context);

        registerStopSignalHandler(server, `MCP HTTP server`, context);
      } catch (err: any) {
        throw new ExecutionError(`Failed to start ActionDock MCP HTTP server: ${err.message}`, err);
      }
    });
}
