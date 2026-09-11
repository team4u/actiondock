import { createServer as createNodeHttpServer, type IncomingMessage, type ServerResponse } from "node:http";
import { resolve } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createActionDockHost } from "../host/host";
import { NOT_FOUND, UNAUTHORIZED } from "../errors";
import type { ActionDockHost } from "../host/types";
import { ensureDependencyClosure } from "../project/closure";
import { findProjectRoot } from "../project/loader";
import { listLinkedPackages, resolvePackageRoot } from "../registry/registry";
import { LocalActionDockTarget } from "../target/local";
import type { ActionDockTarget } from "../target/types";
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
import type { ActionDockServerInstance, CoreHttpServerInstance, ServerOptions } from "./types";

/**
 * 根据当前运行时环境启动标准 Web Request/Response 兼容的 HTTP 服务。
 */
export async function launchHttpServer(
  port: number,
  host: string,
  fetchHandler: (req: Request) => Promise<Response>
): Promise<CoreHttpServerInstance> {
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
 * 启动 ActionDock 2.0 原生轻量级 HTTP 服务端。
 * 作为 ActionDockHost 与 ActionDockTarget 的薄适配层，负责中间件流转、认证拦截与路由分发。
 */
export async function startActionDockServer(
  options: ServerOptions = {}
): Promise<ActionDockServerInstance> {
  let hostInstance: ActionDockHost | undefined =
    options.host && typeof options.host === "object" && "listActions" in options.host
      ? options.host
      : undefined;

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

  // 若调用方未传入 host 或 target，通过 projectRoot、customHome、platform 等直接创建宿主
  if (!targetInstance && !hostInstance) {
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

  if (!targetInstance && hostInstance) {
    targetInstance = new LocalActionDockTarget(hostInstance);
  } else if (targetInstance && !hostInstance) {
    const inner = targetInstance?.unwrap?.();
    if (inner && "listApps" in inner) {
      hostInstance = inner;
    }
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
      if (!verifyBearerToken(req, token)) {
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
      const mcpRes = await options.mcpHandler(req);
      if (mcpRes) return mcpRes;
    }

    // 3. 全局 API 认证鉴权拦截
    if (!verifyBearerToken(req, token)) {
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

  const server: CoreHttpServerInstance = await launchHttpServer(port, host, fetchHandler);
  if (server.ready) {
    await server.ready;
  }

  const actualHost = host === "0.0.0.0" ? "127.0.0.1" : host;

  const instance: ActionDockServerInstance = {
    get port() {
      return server.port ?? port;
    },
    set port(val: number) {
      server.port = val;
    },
    host: hostInstance,
    target: targetInstance,
    get url() {
      return `http://${actualHost}:${this.port}`;
    },
    ready: Promise.resolve(),
    stop: async (stopOptions?: { graceMs?: number }) => {
      if (targetInstance) {
        try {
          await targetInstance.close();
        } catch {
          // 忽略关闭异常
        }
      }
      if (hostInstance && hostInstance !== targetInstance?.unwrap?.()) {
        try {
          await hostInstance.close(stopOptions);
        } catch {
          // 忽略宿主关闭异常
        }
      }
      await server.stop(true);
    },
  };

  return instance;
}
