import { resolve } from "node:path";
import { findProjectRoot, loadProjectConfig, startActionDockServer } from "@actiondock/core";
import { createActionDockMcpServer } from "@actiondock/mcp";
import { createMcpHandler } from "@modelcontextprotocol/server";
import { Command } from "commander";
import { ArgumentError, ExecutionError } from "../errors";
import { writeStderr, writeStdout } from "../renderer";
import type { RuntimeCliContext } from "../types";
import { getEffectiveOptions, parseByteSize } from "../utils";

/**
 * 注册 serve HTTP 服务启动命令。
 * 
 * @param program Commander 实例
 * @param context 运行时上下文
 */
export function registerServeCommand(program: Command, context?: RuntimeCliContext): void {
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
    .action(async (rawOptions: any, cmd: any) => {
      const options = getEffectiveOptions(rawOptions, cmd);
      const port = parseInt(options.port, 10) || 5177;
      const host = options.host || "127.0.0.1";
      const token = options.token || (typeof process !== "undefined" ? process.env?.ACTIONDOCK_TOKEN : undefined);
      const allowInsecureNoAuth = Boolean(options.allowInsecureNoAuth);
      const corsOrigins = options.corsOrigin && options.corsOrigin.length > 0 ? options.corsOrigin : undefined;
      const exposeDebugInfo = Boolean(options.exposeDebugInfo);

      let maxBodyBytes: number | undefined;
      if (options.maxBody) {
        try {
          maxBodyBytes = parseByteSize(options.maxBody);
        } catch (err: any) {
          throw new ArgumentError(`Invalid max-body format: ${err.message}`);
        }
      }

      const projectRoot = options.dir
        ? resolve(options.dir)
        : findProjectRoot(process.cwd());

      let projectName = "Global Registry Mode";

      if (context?.standalone) {
        projectName = `${context.standalone.packageId} (Standalone)`;
      } else if (projectRoot) {
        try {
          const config = loadProjectConfig(projectRoot);
          projectName = `${config.name} (${config.id})`;
        } catch {
          // 降级处理
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
                writeStderr(`[MCP HTTP Error] ${err?.message || String(err)}`, context);
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

        writeStdout(`\n======================================================`, context);
        writeStdout(`  ActionDock 2.0 HTTP Runner Server`, context);
        writeStdout(`======================================================`, context);
        writeStdout(`  * Listening on:    http://${host}:${server.port}`, context);
        writeStdout(`  * Project:         ${projectName}`, context);
        if (projectRoot && exposeDebugInfo) {
          writeStdout(`  * Root Path:       ${projectRoot}`, context);
        }
        writeStdout(
          `  * Authentication:  ${token ? "Bearer Token / Query Token Enabled" : "Disabled (Public/Local)"}`,
          context
        );
        writeStdout(`  * CORS Origins:    ${corsOrigins ? corsOrigins.join(", ") : "Disabled (Default)"}`, context);
        writeStdout(`  * Max Body Size:   ${options.maxBody || "1mb"}`, context);
        writeStdout(
          `  * Health Endpoint: http://${host === "0.0.0.0" ? "127.0.0.1" : host}:${server.port}/api/v1/health`,
          context
        );
        if (enableMcp) {
          writeStdout(
            `  * MCP Endpoint:    http://${host === "0.0.0.0" ? "127.0.0.1" : host}:${server.port}/mcp`,
            context
          );
        }
        writeStdout(`======================================================\n`, context);
        writeStdout(`Server is ready to accept remote requests.`, context);
        writeStdout(`Press Ctrl+C to terminate.\n`, context);

        const stopSignalHandler = () => {
          writeStdout("\nStopping ActionDock server...", context);
          server.stop();
        };

        process.once("SIGINT", stopSignalHandler);
        process.once("SIGTERM", stopSignalHandler);
      } catch (err: any) {
        throw new ExecutionError(`Failed to start ActionDock server: ${err.message}`, err);
      }
    });
}
