import { createServer as createNodeHttpServer, type IncomingMessage, type ServerResponse } from "node:http";
import { resolve } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { ensureDependencyClosure } from "../project/closure";
import { findProjectRoot } from "../project/loader";
import { listLinkedPackages, resolvePackageRoot } from "../registry/registry";
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
import { ServerRuntimeRegistry } from "./runtime-registry";
import { isLoopbackHost, resolveCorsHeaders, verifyBearerToken } from "./security";
import type { ActionDockServerInstance, CoreHttpServerFactory, CoreHttpServerInstance, ServerOptions } from "./types";

let customHttpServerFactory: CoreHttpServerFactory | undefined;

/**
 * 注册自定义 HTTP 服务端工厂（用于 Node.js / Bun 运行时环境适配）。
 */
export function setHttpServerFactory(factory: CoreHttpServerFactory): void {
  customHttpServerFactory = factory;
}

/**
 * 根据当前运行时环境启动标准 Web Request/Response 兼容的 HTTP 服务。
 */
export async function launchHttpServer(
  port: number,
  host: string,
  fetchHandler: (req: Request) => Promise<Response>
): Promise<CoreHttpServerInstance> {
  if (customHttpServerFactory) {
    const srv = await customHttpServerFactory({ port, host, fetch: fetchHandler });
    if (srv.ready) {
      await srv.ready;
    }
    return srv;
  }

  // 若处于原生 Bun 运行时
  if (typeof (globalThis as any).Bun !== "undefined" && typeof (globalThis as any).Bun.serve === "function") {
    const bunServer = (globalThis as any).Bun.serve({
      port,
      hostname: host,
      fetch: fetchHandler,
    });
    return {
      port: bunServer.port,
      ready: Promise.resolve(),
      stop: async (closeActive?: boolean) => {
        bunServer.stop(closeActive);
      },
    };
  }

  // Node.js 原生 node:http 兜底实现
  const srv = createNodeHttpServer(async (req: IncomingMessage, res: ServerResponse) => {
    try {
      const protocol = (req.socket as any)?.encrypted ? "https" : "http";
      const hostHeader = req.headers.host || "127.0.0.1";
      const url = new URL(req.url || "/", `${protocol}://${hostHeader}`).href;

      const headers = new Headers();
      for (const [k, v] of Object.entries(req.headers)) {
        if (v === undefined) continue;
        if (Array.isArray(v)) {
          for (const item of v) headers.append(k, item);
        } else {
          headers.set(k, v);
        }
      }

      const method = (req.method || "GET").toUpperCase();
      const hasBody = method !== "GET" && method !== "HEAD";
      const init: RequestInit = { method, headers };
      if (hasBody) {
        (init as any).body = Readable.toWeb(req);
        (init as any).duplex = "half";
      }

      const webReq = new Request(url, init);
      const webRes = await fetchHandler(webReq);

      res.statusCode = webRes.status;
      if (webRes.statusText) res.statusMessage = webRes.statusText;
      webRes.headers.forEach((v, k) => res.setHeader(k, v));

      if (!webRes.body) {
        res.end();
        return;
      }
      await pipeline(Readable.fromWeb(webRes.body as any), res);
    } catch (err: any) {
      if (!res.headersSent) {
        res.statusCode = 500;
        res.end(JSON.stringify({ error: err?.message || String(err) }));
      } else {
        res.destroy(err);
      }
    }
  });

  const instance: CoreHttpServerInstance = {
    port,
    stop: async () => {
      await new Promise<void>((resolve) => {
        srv.close(() => resolve());
        (srv as any).closeAllConnections?.();
      });
    },
  };

  await new Promise<void>((resolve, reject) => {
    srv.once("error", (err) => {
      reject(err);
    });
    srv.listen(port, host, () => {
      const addr = srv.address();
      if (typeof addr === "object" && addr) {
        instance.port = addr.port;
      }
      resolve();
    });
  });

  instance.ready = Promise.resolve();
  return instance;
}

/**
 * 启动 ActionDock 2.0 原生轻量级 HTTP 服务装配中枢。
 * 
 * 仅负责中间件流转、认证拦截、路由分发与服务生命周期管理。
 */
export async function startActionDockServer(
  options: ServerOptions = {}
): Promise<ActionDockServerInstance> {
  const port = options.port ?? 5177;
  const host = options.host ?? "127.0.0.1";
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

  const runtimeRegistry = new ServerRuntimeRegistry(customHome);

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

  const server = await launchHttpServer(port, host, async (req) => {
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
      runtimeRegistry,
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
      if (!verifyBearerToken(req, token)) {
        return jsonResponse(
          {
            ok: false,
            error: {
              code: "UNAUTHORIZED",
              message: "Invalid or missing Bearer token",
            },
          },
          401,
          corsHeaders
        );
      }
      const mcpRes = await options.mcpHandler(req);
      if (mcpRes) return mcpRes;
    }

    // 3. 全局 API 认证鉴权拦截
    if (!verifyBearerToken(req, token)) {
      return jsonResponse(
        {
          ok: false,
          error: {
            code: "UNAUTHORIZED",
            message: "Invalid or missing Bearer token",
          },
        },
        401,
        corsHeaders
      );
    }

    // 4. 业务领域路由分发
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
          code: "NOT_FOUND",
          message: `Route not found: ${req.method} ${pathname}`,
        },
      },
      404,
      corsHeaders
    );
  });

  const actualHost = host === "0.0.0.0" ? "127.0.0.1" : host;

  const instance: ActionDockServerInstance = {
    get port() {
      return server.port ?? port;
    },
    set port(val: number) {
      server.port = val;
    },
    host,
    get url() {
      return `http://${actualHost}:${this.port}`;
    },
    runtimeRegistry,
    ready: Promise.resolve(),
    stop: async (stopOptions?: { graceMs?: number }) => {
      await runtimeRegistry.close(stopOptions);
      await server.stop(true);
    },
  };

  return instance;
}
