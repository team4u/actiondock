import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  createActionDock,
  createNodePlatform,
  findProjectRoot,
  loadProjectConfig,
  startActionDockServer,
} from "@actiondock/core";
import {
  formatHostForUrl,
  type ServerTlsOptions,
} from "@actiondock/core/server";
import { Command } from "commander";
import { ArgumentError, ExecutionError } from "../errors";
import { writeStderr, writeStdout } from "../renderer";
import type { CliContext } from "../types";
import { ensureSelfSignedCertificate, getEffectiveOptions, parseByteSize } from "../utils";

/**
 * 注册 serve HTTP 服务启动命令。
 * 
 * @param program Commander 实例
 * @param context 命令行上下文
 */
export function registerServeCommand(program: Command, context?: CliContext): void {
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
    .option("--allow-query-token", "Allow passing authentication token via URL query parameter (?token=xxx)")
    .option("--management", "Enable config and state management API endpoints (disabled by default for security)")
    .option("--https", "Enable native HTTPS transport (auto-generates self-signed certificate if none provided)")
    .option("--tls-cert <path>", "Path to TLS certificate file (or set ACTIONDOCK_TLS_CERT)")
    .option("--tls-key <path>", "Path to TLS private key file (or set ACTIONDOCK_TLS_KEY)")
    .option("--tls-ca <path>", "Path to TLS CA certificate file (or set ACTIONDOCK_TLS_CA)")
    .option("--tls-passphrase <passphrase>", "Passphrase for TLS private key (or set ACTIONDOCK_TLS_PASSPHRASE)")
    .option("-d, --dir <path>", "Project root directory (default: current working directory)")
    .option("--data-dir <path>", "Custom database storage directory")
    .action(async (rawOptions: any, cmd: any) => {
      const options = getEffectiveOptions(rawOptions, cmd);
      const parsedPort = parseInt(options.port, 10);
      const port = Number.isNaN(parsedPort) ? 5177 : parsedPort;
      const host = options.host || "127.0.0.1";
      const token = options.token || (typeof process !== "undefined" ? process.env?.ACTIONDOCK_TOKEN : undefined);
      const allowInsecureNoAuth = Boolean(options.allowInsecureNoAuth);
      const allowQueryToken = Boolean(options.allowQueryToken);
      const enableManagement = Boolean(options.management);
      const corsOrigins = options.corsOrigin && options.corsOrigin.length > 0 ? options.corsOrigin : undefined;
      const exposeDebugInfo = Boolean(options.exposeDebugInfo);

      const httpsEnabled = Boolean(
        options.https ||
        options.tlsCert ||
        options.tlsKey ||
        process.env?.ACTIONDOCK_HTTPS === "true" ||
        process.env?.ACTIONDOCK_HTTPS === "1" ||
        process.env?.ACTIONDOCK_TLS_CERT ||
        process.env?.ACTIONDOCK_TLS_KEY
      );

      let tls: ServerTlsOptions | undefined;
      if (httpsEnabled) {
        const certPath = options.tlsCert || (typeof process !== "undefined" ? process.env?.ACTIONDOCK_TLS_CERT : undefined);
        const keyPath = options.tlsKey || (typeof process !== "undefined" ? process.env?.ACTIONDOCK_TLS_KEY : undefined);
        const caPath = options.tlsCa || (typeof process !== "undefined" ? process.env?.ACTIONDOCK_TLS_CA : undefined);
        const passphrase = options.tlsPassphrase || (typeof process !== "undefined" ? process.env?.ACTIONDOCK_TLS_PASSPHRASE : undefined);

        if (certPath && keyPath) {
          try {
            tls = {
              certPath: resolve(certPath),
              keyPath: resolve(keyPath),
              ca: caPath ? readFileSync(resolve(caPath), "utf-8") : undefined,
              passphrase,
            };
          } catch (err: any) {
            throw new ArgumentError(`Failed to read TLS certificate/key files: ${err.message}`);
          }
        } else if (certPath || keyPath) {
          throw new ArgumentError("Both --tls-cert and --tls-key must be provided together");
        } else {
          const selfSigned = await ensureSelfSignedCertificate({ host });
          tls = {
            cert: selfSigned.cert,
            key: selfSigned.key,
            certPath: selfSigned.certPath,
            keyPath: selfSigned.keyPath,
          };
        }
      }

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
      if (projectRoot) {
        try {
          const config = loadProjectConfig(projectRoot);
          projectName = `${config.name} (${config.id})`;
        } catch {
          // 降级处理
        }
      }

      const platform = createNodePlatform({
        customHome: context?.customHome,
        dataDir: options.dataDir || context?.dataDir,
        rootDir: projectRoot || undefined,
      });

      const service = await createActionDock({
        type: "local",
        projectRoot: projectRoot || undefined,
        customHome: context?.customHome,
        dataDir: options.dataDir || context?.dataDir,
        platform,
        scanLinkedPackages: !projectRoot,
      });

      let mcpHandler: ((req: Request) => Promise<Response | null | undefined>) | undefined;
      const enableMcp = options.mcp !== false;
      if (enableMcp) {
        // MCP 处理器创建失败时直接终止启动，避免横幅宣称不存在的端点
        try {
          const [{ createActionDockMcpServer }, { createMcpHandler }] = await Promise.all([
            import("@actiondock/mcp"),
            import("@modelcontextprotocol/server"),
          ]);
          const handler = createMcpHandler(
            () => {
              return createActionDockMcpServer({
                service,
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
        } catch (err: any) {
          await service.close().catch(() => {});
          throw new ExecutionError(
            `Failed to initialize MCP endpoint: ${err?.message || String(err)}`,
            err
          );
        }
      }

      try {
        const server = await startActionDockServer({
          port,
          host,
          token,
          allowInsecureNoAuth,
          allowQueryToken,
          corsOrigins,
          maxBodyBytes,
          exposeDebugInfo,
          enableMcp,
          enableManagement,
          mcpHandler,
          tls,
          projectRoot: projectRoot || undefined,
          service,
        });

        const displayHost = formatHostForUrl(host);
        const actualEndpointHost = formatHostForUrl(host === "0.0.0.0" ? "127.0.0.1" : host);
        const scheme = tls ? "https" : "http";

        writeStdout(`\n======================================================`, context);
        writeStdout(`  ActionDock 2.0 HTTP Runner Server`, context);
        writeStdout(`======================================================`, context);
        writeStdout(`  * Listening on:    ${scheme}://${displayHost}:${server.port}`, context);
        writeStdout(`  * Project:         ${projectName}`, context);
        if (projectRoot && exposeDebugInfo) {
          writeStdout(`  * Root Path:       ${projectRoot}`, context);
        }
        if (tls) {
          const tlsDesc = tls.certPath ? `Enabled (${tls.certPath})` : "Enabled (Self-Signed)";
          writeStdout(`  * TLS / HTTPS:     ${tlsDesc}`, context);
        }
        const authDesc = token
          ? (allowQueryToken ? "Bearer Token / Query Token Enabled" : "Bearer Token Enabled (Query Token Disabled)")
          : "Disabled (Public/Local)";
        writeStdout(`  * Authentication:  ${authDesc}`, context);
        writeStdout(`  * Management APIs: ${enableManagement ? "Enabled" : "Disabled (Default)"}`, context);
        writeStdout(`  * CORS Origins:    ${corsOrigins ? corsOrigins.join(", ") : "Disabled (Default)"}`, context);
        writeStdout(`  * Max Body Size:   ${options.maxBody || "1mb"}`, context);
        writeStdout(
          `  * Health Endpoint: ${scheme}://${actualEndpointHost}:${server.port}/api/v2/health`,
          context
        );
        if (enableMcp) {
          writeStdout(
            `  * MCP Endpoint:    ${scheme}://${actualEndpointHost}:${server.port}/mcp`,
            context
          );
        }
        writeStdout(`======================================================\n`, context);
        writeStdout(`Server is ready to accept remote requests.`, context);
        writeStdout(`Press Ctrl+C to terminate.\n`, context);

        const stopSignalHandler = () => {
          writeStdout("\nStopping ActionDock server...", context);
          Promise.resolve(server.stop())
            .catch((err: unknown) => {
              // 停止失败必须可见：写入 stderr 一行并标记失败退出码
              writeStderr(
                `[ERROR] Failed to stop ActionDock server gracefully: ${err instanceof Error ? err.message : String(err)}`,
                context
              );
              process.exitCode = 1;
            })
            .finally(() => {
              process.exit(typeof process.exitCode === "number" ? process.exitCode : 0);
            });
        };

        process.once("SIGINT", stopSignalHandler);
        process.once("SIGTERM", stopSignalHandler);
      } catch (err: any) {
        await service.close().catch(() => {});
        throw new ExecutionError(`Failed to start ActionDock server: ${err.message}`, err);
      }
    });
}
