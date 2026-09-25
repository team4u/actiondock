import { posix, resolve } from "node:path";
import { NodeHttpServer } from "./http-server";
import { createActionDock } from "../service/factory";
import { NOT_FOUND, UNAUTHORIZED } from "../errors";
import { parseActionRef } from "../catalog/resolve-action";
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
import { createMcpEndpointHandler, type McpDelegateHandler } from "./mcp-endpoint";
import {
  extractBearerToken,
  matchViewByToken,
  normalizeServerViews,
  type NormalizedServerView,
} from "./policy";
import type {
  ActionDockServerInstance,
  CoreHttpServerInstance,
  EffectiveServerPolicy,
  ServerOptions,
  ServerTlsOptions,
  ServerViewOptions,
} from "./types";

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

  // 1. 归一化解析视图配置集合（含默认视图与自定义视图）
  const { defaultView, views } = normalizeServerViews(options);

  // 非回环地址强制要求配置 Token 鉴权（防裸奔）
  const hasTokenConfigured = Boolean(
    token ||
    defaultView.policy.token ||
    Array.from(views.values()).some((v) => Boolean(v.policy.token))
  );
  if (!isLoopbackHost(host) && !hasTokenConfigured && !options.allowInsecureNoAuth) {
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

  // 2. 聚合所有 views 声明的依赖包与动作，确保依赖闭包满足
  const roots: string[] = [];
  if (projectRoot) {
    roots.push(projectRoot);
  }

  const aggregatedPackageAllowlist = new Set<string>();
  const aggregatedActionAllowlist = new Set<string>();

  for (const v of views.values()) {
    if (v.policy.packageAllowlist) {
      for (const pkg of v.policy.packageAllowlist) {
        aggregatedPackageAllowlist.add(pkg);
      }
    }
    if (v.policy.actionAllowlist) {
      for (const act of v.policy.actionAllowlist) {
        aggregatedActionAllowlist.add(act);
      }
    }
  }

  if (aggregatedPackageAllowlist.size > 0) {
    for (const pkgId of aggregatedPackageAllowlist) {
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

  if (aggregatedActionAllowlist.size > 0) {
    for (const actRef of aggregatedActionAllowlist) {
      try {
        const parsed = parseActionRef(actRef);
        if (parsed.packageId) {
          const r = resolvePackageRoot(parsed.packageId, projectRoot || undefined, customHome);
          if (r && !roots.includes(r)) {
            roots.push(r);
          }
        }
      } catch {}
    }
  }

  if (roots.length > 0) {
    await ensureDependencyClosure(roots, { customHome });
  }

  // 3. 为每个启用 MCP 的视图独立装配 MCP 处理器
  if (options.enableMcp !== false) {
    for (const v of views.values()) {
      if (v.enableMcp !== false) {
        let delegate: McpDelegateHandler | undefined;
        if (v.rawOptions.mcpHandler) {
          if (v.rawOptions.mcpHandler.length >= 2) {
            delegate = (req: Request) => (v.rawOptions.mcpHandler as (req: Request, view?: EffectiveServerPolicy) => Promise<Response | null | undefined> | Response | null | undefined)(req, v.policy);
          } else {
            let factoryResult: unknown;
            try {
              factoryResult = (v.rawOptions.mcpHandler as (view: EffectiveServerPolicy) => unknown)(v.policy);
            } catch {
              factoryResult = null;
            }
            if (typeof factoryResult === "function") {
              delegate = factoryResult as McpDelegateHandler;
            } else {
              delegate = (req: Request) => (v.rawOptions.mcpHandler as (req: Request, view?: EffectiveServerPolicy) => Promise<Response | null | undefined> | Response | null | undefined)(req, v.policy);
            }
          }
        } else if (options.mcpHandlerFactory) {
          delegate = options.mcpHandlerFactory(v.policy);
        } else if (options.mcpHandler) {
          if (options.mcpHandler.length >= 2) {
            delegate = (req: Request) => (options.mcpHandler as (req: Request, view?: EffectiveServerPolicy) => Promise<Response | null | undefined> | Response | null | undefined)(req, v.policy);
          } else {
            let factoryResult: unknown;
            try {
              factoryResult = (options.mcpHandler as (view: EffectiveServerPolicy) => unknown)(v.policy);
            } catch {
              factoryResult = null;
            }
            if (typeof factoryResult === "function") {
              delegate = factoryResult as McpDelegateHandler;
            } else {
              if (factoryResult && typeof (factoryResult as Promise<unknown>).catch === "function") {
                (factoryResult as Promise<unknown>).catch(() => {});
              }
              delegate = (req: Request) => (options.mcpHandler as (req: Request, view?: EffectiveServerPolicy) => Promise<Response | null | undefined> | Response | null | undefined)(req, v.policy);
            }
          }
        }

        if (delegate) {
          v.mcpEndpointHandler = createMcpEndpointHandler(delegate, {
            token: v.policy.token,
            allowQueryToken: options.allowQueryToken,
            corsOrigins: options.corsOrigins,
            maxBodyBytes: options.maxBodyBytes,
          });
        }
      }
    }
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
    const rawPathname = url.pathname;

    let activeView: NormalizedServerView;
    let effectivePathname: string;
    let effectiveReq: Request = req;

    // 1. 检查是否为 /views/:viewName/... 命名空间路由
    const viewMatch = rawPathname.match(/^\/views\/([^/]+)(\/.*)?$/);
    if (viewMatch) {
      let viewName: string;
      try {
        viewName = decodeURIComponent(viewMatch[1]);
      } catch {
        return jsonResponse(
          {
            ok: false,
            error: {
              code: NOT_FOUND,
              message: `Invalid view name encoding: '${viewMatch[1]}'`,
            },
          },
          400,
          corsHeaders
        );
      }

      const matched = views.get(viewName);
      if (!matched) {
        return jsonResponse(
          {
            ok: false,
            error: {
              code: NOT_FOUND,
              message: `View '${viewName}' not found`,
            },
          },
          404,
          corsHeaders
        );
      }
      activeView = matched;

      // 规范化子路径，防范路径穿透与多斜杠混淆
      let rawEffective = viewMatch[2] || "/";
      if (!rawEffective.startsWith("/")) {
        rawEffective = "/" + rawEffective;
      }
      const normalizedPath = posix.normalize(rawEffective);
      effectivePathname = normalizedPath.startsWith("/") ? normalizedPath : "/" + normalizedPath;

      // 剥离 /views/:viewName 前缀后重构 URL 与 Request
      const rewrittenUrl = new URL(req.url);
      rewrittenUrl.pathname = effectivePathname;
      try {
        const init: RequestInit & { duplex?: "half" } = {
          method: req.method,
          headers: req.headers,
          signal: req.signal,
        };
        if (req.body && req.method !== "GET" && req.method !== "HEAD") {
          init.body = req.body;
          init.duplex = "half";
        }
        effectiveReq = new Request(rewrittenUrl.toString(), init);
      } catch {
        effectiveReq = req;
      }
    } else {
      // 根路径请求：智能根据 Bearer Token 匹配视图或回退默认视图（遍历全量视图以防范时序差异）
      effectivePathname = rawPathname;
      const clientToken = extractBearerToken(req, options.allowQueryToken);
      if (clientToken) {
        const matchedByToken = matchViewByToken(clientToken, views.values());
        activeView = matchedByToken ?? defaultView;
      } else {
        activeView = defaultView;
      }
    }

    const effectivePolicy = activeView.policy;

    const effectiveUrl = new URL(effectiveReq.url);
    effectiveUrl.pathname = effectivePathname;

    const ctx: RouteContext = {
      req: effectiveReq,
      url: effectiveUrl,
      pathname: effectivePathname,
      corsHeaders,
      projectRoot,
      customHome,
      service: serviceInstance!,
      options,
      activePolicy: effectivePolicy,
    };

    // 2. 健康检查路由（内部处理独立鉴权逻辑，使用 activePolicy.token）
    const healthResponse = await handleHealthRoute(ctx);
    if (healthResponse) {
      return healthResponse;
    }

    // 3. MCP 统一网关端点（委托当前视图的端点处理器）
    if (effectivePathname === "/mcp" || effectivePathname.startsWith("/mcp/")) {
      if (activeView.enableMcp === false || options.enableMcp === false) {
        return jsonResponse(
          {
            ok: false,
            error: {
              code: NOT_FOUND,
              message: `MCP endpoint is disabled for view '${activeView.name}'`,
            },
          },
          404,
          corsHeaders
        );
      }
      if (activeView.mcpEndpointHandler) {
        const mcpRes = await activeView.mcpEndpointHandler(effectiveReq);
        if (mcpRes) return mcpRes;
      }
    }

    // 4. API 认证鉴权拦截（基于当前生效策略中的 Token）
    if (!verifyBearerToken(effectiveReq, effectivePolicy.token, options)) {
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

    // 5. 业务领域路由分发（完全委托 Service 与 RouteContext 中的 activePolicy）
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

    // 6. 404 路由兜底
    return jsonResponse(
      {
        ok: false,
        error: {
          code: NOT_FOUND,
          message: `Route not found: ${req.method} ${rawPathname}`,
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
