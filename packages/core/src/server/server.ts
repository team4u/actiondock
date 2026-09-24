import { resolve } from "node:path";
import { NodeHttpServer } from "./http-server";
import { createActionDock } from "../service/factory";
import { NOT_FOUND, UNAUTHORIZED } from "../errors";
import { ensureDependencyClosure } from "../project/closure";
import { findProjectRoot } from "../project/loader";
import { listLinkedPackages, resolvePackageRoot } from "../registry/registry";
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
import { isLoopbackHost, resolveCorsHeaders, verifyBearerToken } from "./security";
import { createMcpEndpointHandler } from "./mcp-endpoint";
import type { ActionDockServerInstance, CoreHttpServerInstance, ServerOptions, ServerTlsOptions } from "./types";

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
 * 启动 ActionDock 原生轻量级 HTTP 服务端。
 * 面向 ActionDockService 服务端口，负责中间件流转、认证拦截与路由分发。
 */
export async function startActionDockServer(
  options: ServerOptions = {}
): Promise<ActionDockServerInstance> {
  const hostString = options.hostname ?? options.host ?? "127.0.0.1";

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

  // 若未传 service，服务端统一通过 createActionDock() 实例化，不再接受或处理外部传入的 Host 实体
  if (!serviceInstance) {
    const scanLinkedPackages = options.scanLinkedPackages ?? !projectRoot;
    serviceInstance = await createActionDock({
      projectRoot: projectRoot || undefined,
      customHome,
      platform: options.platform,
      dataDir: options.dataDir,
      inMemory: options.inMemory,
      scanLinkedPackages,
      enableManagement: options.enableManagement,
    });
  }

  if (!serviceInstance) {
    throw new Error("Failed to initialize ActionDockService for server");
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

  // MCP 统一网关端点处理器：鉴权、请求体限流与委托序列收敛为共享单一事实源
  const mcpEndpointHandler = options.mcpHandler
    ? createMcpEndpointHandler(options.mcpHandler, {
        token,
        allowQueryToken: options.allowQueryToken,
        corsOrigins: options.corsOrigins,
        maxBodyBytes: options.maxBodyBytes,
      })
    : undefined;

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
      options,
    };

    // 1. 健康检查路由（内部处理独立鉴权逻辑）
    const healthResponse = await handleHealthRoute(ctx);
    if (healthResponse) {
      return healthResponse;
    }

    // 2. MCP 统一网关端点（委托共享端点处理器）
    if (
      options.enableMcp !== false &&
      mcpEndpointHandler &&
      (pathname === "/mcp" || pathname.startsWith("/mcp/"))
    ) {
      const mcpRes = await mcpEndpointHandler(req);
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

    // 4. 业务领域路由分发（完全委托 Service）
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
    service: serviceInstance,
    get url() {
      return `${protocol}://${formatHostForUrl(actualHost)}:${this.port}`;
    },
    ready: Promise.resolve(),
    stop: async (stopOptions?: { graceMs?: number }) => {
      await server.stop(true);
      if (serviceInstance) {
        try {
          await serviceInstance.close(stopOptions);
        } catch (err) {
          // 服务关闭失败不阻断停机流程，但保留可观测诊断
          console.warn(
            `[ActionDockServer] Service close failed during stop: ${err instanceof Error ? err.message : String(err)}`
          );
        }
      }
    },
  };

  return instance;
}
