import { resolve } from "node:path";
import { NodeHttpServer } from "./http-server";
import { createActionDockHost } from "../host/host";
import { NOT_FOUND, UNAUTHORIZED } from "../errors";
import type { ActionDockHost } from "../host/types";
import { ensureDependencyClosure } from "../project/closure";
import { findProjectRoot } from "../project/loader";
import { listLinkedPackages, resolvePackageRoot } from "../registry/registry";
import { ServiceActionDockTarget } from "../target/local";
import type { ActionDockTarget } from "../target/types";
import { LocalActionDockService } from "../service/local";
import type { ActionDockService } from "../service/types";
import {
  handleActionsRoutes,
  handleConfigRoutes,
  handleDoctorRoute,
  handleHealthRoute,
  handleInfoRoute,
  handlePlaybooksRoutes,
  handleRunsRoutes,
  handleStateRoutes,
  jsonResponse,
  type RouteContext,
} from "./routes";
import type { JsonValue } from "@actiondock/sdk";
import { DEFAULT_MAX_BODY_BYTES } from "./body";
import { isLoopbackHost, resolveCorsHeaders, verifyBearerToken } from "./security";
import type { ActionDockServerInstance, CoreHttpServerInstance, ServerOptions, ServerTlsOptions } from "./types";

// ============================================================================
// Service Adapters
// ============================================================================

/**
 * 依据传入的 Target 适配标准 ActionDockService 端口结构。
 */
function createServiceFromTarget(target: ActionDockTarget, enableManagement = true): ActionDockService {
  return {
    info: () => target.listPackages(),
    discovery: {
      listPackages: () => target.listPackages(),
      listActions: (opts) => target.listActions(opts),
      describeAction: (ref) => target.describeAction(ref),
      listPlaybooks: (opts) => target.listPlaybooks(opts),
      describePlaybook: (id) => target.describePlaybook(id),
    },
    execution: {
      run: (ref, input, opts) => target.runAction(ref, (input ?? {}) as JsonValue, opts),
      start: (ref, input, opts) => target.startAction(ref, (input ?? {}) as JsonValue, opts),
    },
    runs: {
      list: (query) => target.listRuns(query),
      get: (runId) => target.getRun(runId),
      cancel: (runId, reason) => target.cancelRun(runId, reason),
      events: (runId, opts) => target.events(runId, opts),
      clear: (opts) => (target.clearRuns ? target.clearRuns(opts) : Promise.resolve(0)),
    },
    management: enableManagement
      ? {
          config: {
            get: (pkg, k) => target.getConfig(pkg, k),
            set: (pkg, k, v) => target.setConfig(pkg, k, v),
            delete: (pkg, k) => target.deleteConfig(pkg, k),
            list: (pkg) => target.listConfig(pkg),
          },
          state: {
            get: (pkg, act, k, opts) => target.getState(pkg, act, k, opts),
            set: (pkg, act, k, v, opts) => target.setState(pkg, act, k, v, opts),
            delete: (pkg, act, k, opts) => target.deleteState(pkg, act, k, opts),
            list: (pkg, act, opts) => target.listStateKeys(pkg, act, opts),
            clear: (pkg, act, opts) => target.clearState(pkg, act, opts),
            listEntries: (pkg, opts) =>
              target.listStateEntries
                ? target.listStateEntries(pkg, opts)
                : Promise.reject(new Error("listStateEntries not supported")),
          },
        }
      : undefined,
    close: (opts) => target.close(opts),
  };
}

/**
 * 规范化主机地址用于拼接 URL。
 * 若 host 包含冒号 : 且不以 [ 开头，则添加中括号包裹（IPv6 标准格式）。
 */
export function formatHostForUrl(host: string): string {
  return host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;
}

/**
 * 根据当前运行时环境启动标准 Web Request/Response 兼容的 HTTP 服务。
 */
export async function launchHttpServer(
  port: number,
  host: string,
  fetchHandler: (req: Request) => Promise<Response>,
  tls?: ServerTlsOptions
): Promise<CoreHttpServerInstance> {
  const server = new NodeHttpServer({
    port,
    host,
    fetch: fetchHandler,
    tls,
  });
  await server.listen(port, host);
  const instance: CoreHttpServerInstance = {
    port: server.port,
    stop: async () => {
      await server.close();
    },
    ready: Promise.resolve(),
  };
  return instance;
}

/**
 * 启动 ActionDock 2.0 原生轻量级 HTTP 服务端。
 * 作为 ActionDockHost 与 ActionDockTarget 的薄适配层，负责中间件流转、认证拦截与路由分发。
 */
export async function startActionDockServer(
  options: ServerOptions = {}
): Promise<ActionDockServerInstance> {
  let hostInstance: ActionDockHost | undefined =
    options.hostInstance ??
    (options.host && typeof options.host === "object" && "listActions" in options.host
      ? options.host
      : undefined);

  let targetInstance: ActionDockTarget | undefined = options.target;

  const hostString =
    typeof options.host === "string"
      ? options.host
      : (options.hostname ?? "127.0.0.1");

  const port = options.port ?? 5177;
  const host = hostString;
  const token = options.token;
  const customHome = options.customHome;
  const projectRoot = options.projectRoot
    ? resolve(options.projectRoot)
    : findProjectRoot(process.cwd());

  // 非回环地址强制要求配置 Token 鉴权（防裸奔）
  if (!isLoopbackHost(host) && !token && !options.allowInsecureNoAuth) {
    throw new Error(
      "Authentication token is required when binding to a non-loopback address. Use --allow-insecure-no-auth to override."
    );
  }

  let serviceInstance: ActionDockService | undefined = options.service;

  // 若调用方未传入 host、target 或 service，通过 projectRoot、customHome、platform 等直接创建宿主
  if (!serviceInstance && !targetInstance && !hostInstance) {
    const scanLinkedPackages = options.scanLinkedPackages ?? !projectRoot;
    hostInstance = await createActionDockHost({
      projectRoot: projectRoot || undefined,
      customHome,
      platform: options.platform,
      dataDir: options.dataDir,
      inMemory: options.inMemory,
      scanLinkedPackages,
      autoLoadCurrentProject: true,
    });
  }

  if (!serviceInstance) {
    if (targetInstance && "service" in targetInstance && (targetInstance as any).service) {
      serviceInstance = (targetInstance as any).service;
    } else if (targetInstance) {
      serviceInstance = createServiceFromTarget(targetInstance, options.enableManagement !== false);
    } else if (hostInstance) {
      serviceInstance = new LocalActionDockService(hostInstance, { enableManagement: options.enableManagement });
    }
  }

  if (!targetInstance && serviceInstance) {
    targetInstance = new ServiceActionDockTarget(serviceInstance);
  }

  const roots: string[] = [];
  if (projectRoot) {
    roots.push(projectRoot);
  }
  if (options.packageAllowlist && options.packageAllowlist.length > 0) {
    for (const pkgId of options.packageAllowlist) {
      const r = resolvePackageRoot(pkgId, projectRoot || undefined, customHome);
      if (r && !roots.includes(r)) {
        roots.push(r);
      }
    }
  } else if (!projectRoot) {
    for (const pkg of listLinkedPackages(customHome)) {
      if (!roots.includes(pkg.path)) {
        roots.push(pkg.path);
      }
    }
  }

  if (roots.length > 0) {
    await ensureDependencyClosure(roots, { customHome });
  }

  const fetchHandler = async (req: Request): Promise<Response> => {
    const origin = req.headers.get("origin");
    const corsHeaders = resolveCorsHeaders(origin, options.corsOrigins);

    if (req.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: corsHeaders,
      });
    }

    const url = new URL(req.url);
    const pathname = url.pathname;

    const ctx: RouteContext = {
      req,
      url,
      pathname,
      corsHeaders,
      projectRoot,
      customHome,
      service: serviceInstance!,
      host: hostInstance,
      target: targetInstance!,
      options,
    };

    // 1. 健康检查路由（内部处理独立鉴权逻辑）
    const healthResponse = await handleHealthRoute(ctx);
    if (healthResponse) {
      return healthResponse;
    }

    // 2. MCP 统一网关端点
    if (
      options.enableMcp !== false &&
      options.mcpHandler &&
      (pathname === "/mcp" || pathname.startsWith("/mcp/"))
    ) {
      if (!verifyBearerToken(req, token, options)) {
        return jsonResponse(
          {
            ok: false,
            error: {
              code: UNAUTHORIZED,
              message: "Invalid or missing Bearer token",
            },
          },
          401,
          corsHeaders
        );
      }

      // 请求体体积限制保护
      const maxBytes = options.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES;
      const contentLengthHeader = req.headers.get("content-length");
      if (contentLengthHeader) {
        const parsedLength = parseInt(contentLengthHeader, 10);
        if (!isNaN(parsedLength) && parsedLength > maxBytes) {
          return jsonResponse(
            {
              ok: false,
              error: {
                code: "REQUEST_TOO_LARGE",
                message: "Request body exceeds maximum allowed size",
              },
            },
            413,
            corsHeaders
          );
        }
      }

      let mcpReq = req;
      if (req.body && req.method !== "GET" && req.method !== "HEAD") {
        const reader = req.body.getReader();
        const chunks: Uint8Array[] = [];
        let totalBytes = 0;
        let tooLarge = false;

        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            if (value) {
              totalBytes += value.byteLength;
              if (totalBytes > maxBytes) {
                tooLarge = true;
                await reader.cancel();
                break;
              }
              chunks.push(value);
            }
          }
        } finally {
          reader.releaseLock();
        }

        if (tooLarge) {
          return jsonResponse(
            {
              ok: false,
              error: {
                code: "REQUEST_TOO_LARGE",
                message: "Request body exceeds maximum allowed size",
              },
            },
            413,
            corsHeaders
          );
        }

        const merged = new Uint8Array(totalBytes);
        let offset = 0;
        for (const chunk of chunks) {
          merged.set(chunk, offset);
          offset += chunk.byteLength;
        }
        mcpReq = new Request(req.url, {
          method: req.method,
          headers: req.headers,
          body: merged,
          signal: req.signal,
        });
      }

      const mcpRes = await options.mcpHandler(mcpReq);
      if (mcpRes) return mcpRes;
    }

    // 3. 全局 API 认证鉴权拦截
    if (!verifyBearerToken(req, token, options)) {
      return jsonResponse(
        {
          ok: false,
          error: {
            code: UNAUTHORIZED,
            message: "Invalid or missing Bearer token",
          },
        },
        401,
        corsHeaders
      );
    }

    // 4. 业务领域路由分发（完全委托 Target / Host）
    const routeResponse =
      (await handleInfoRoute(ctx)) ||
      (await handleDoctorRoute(ctx)) ||
      (await handleActionsRoutes(ctx)) ||
      (await handlePlaybooksRoutes(ctx)) ||
      (await handleRunsRoutes(ctx)) ||
      (await handleStateRoutes(ctx)) ||
      (await handleConfigRoutes(ctx));

    if (routeResponse) {
      return routeResponse;
    }

    // 5. 404 路由兜底
    return jsonResponse(
      {
        ok: false,
        error: {
          code: NOT_FOUND,
          message: `Route not found: ${req.method} ${pathname}`,
        },
      },
      404,
      corsHeaders
    );
  };

  const server: CoreHttpServerInstance = await launchHttpServer(port, host, fetchHandler, options.tls);
  if (server.ready) {
    await server.ready;
  }

  const actualHost = host === "0.0.0.0" ? "127.0.0.1" : host;
  const protocol = options.tls ? "https" : "http";

  const instance: ActionDockServerInstance = {
    get port() {
      return server.port ?? port;
    },
    set port(val: number) {
      server.port = val;
    },
    host: hostInstance,
    target: targetInstance,
    service: serviceInstance!,
    get url() {
      return `${protocol}://${formatHostForUrl(actualHost)}:${this.port}`;
    },
    ready: Promise.resolve(),
    stop: async (stopOptions?: { graceMs?: number }) => {
      await server.stop(true);
      if (options.target) {
        try {
          await options.target.close(
            stopOptions?.graceMs !== undefined ? { timeoutMs: stopOptions.graceMs } : undefined
          );
        } catch {
          // 忽略关闭异常
        }
      }
      if (hostInstance) {
        try {
          await hostInstance.close(stopOptions);
        } catch {
          // 忽略宿主关闭异常
        }
      } else if (!options.target && serviceInstance) {
        try {
          await serviceInstance.close(stopOptions);
        } catch {
          // 忽略服务关闭异常
        }
      }
    },
  };

  return instance;
}
