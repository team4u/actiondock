import { ACTIONDOCK_VERSION, UNAUTHORIZED } from "@actiondock/core";
import {
  createMcpEndpointHandler,
  formatHostForUrl,
  isLoopbackHost,
  launchHttpServer,
  resolveCorsHeaders,
  verifyBearerToken,
} from "@actiondock/core/server";
import { createMcpHandler } from "@modelcontextprotocol/server";
import { createActionDockMcpServer, resolveService } from "./adapter";
import type { ActionDockMcpHttpOptions, ActionDockMcpHttpServerInstance } from "./types";

/**
 * Starts an ActionDock MCP server over HTTP transport.
 */
export function startMcpHttpServer(
  options: ActionDockMcpHttpOptions = {}
): Promise<ActionDockMcpHttpServerInstance> {
  const hostInstance =
    typeof options.host === "object" && options.host !== null
      ? options.host
      : undefined;
  const hostString =
    typeof options.host === "string" ? options.host : "127.0.0.1";
  const port = options.port ?? 5178;
  const host = hostString;
  const token = options.token;

  // 死选项透明化：allowInsecureHttp 是客户端侧豁免开关，服务端明文 HTTP 监听
  // 由 allowInsecureNoAuth 与 token 策略约束，传入该字段不会产生任何效果，
  // 检测到时输出警告避免调用方误以为已生效
  if (options.allowInsecureHttp === true) {
    process.stderr.write(
      "[MCP HTTP Warning] allowInsecureHttp has no effect on the server side and is deprecated; it only applies to remote ActionDock clients.\n"
    );
  }

  // Non-loopback address requires token authentication by default
  if (!isLoopbackHost(host) && !token && !options.allowInsecureNoAuth) {
    throw new Error(
      "Authentication token is required when binding to a non-loopback address. Use --allow-insecure-no-auth to override."
    );
  }

  return (async () => {
    // 先一次性解析 service，工厂闭包直接捕获已解析产物，消除选项重复展开
    const { service } = await resolveService({
      ...options,
      host: hostInstance ?? (typeof options.host === "object" ? options.host : undefined),
    });

    const resolvedHost = hostInstance ?? (typeof options.host === "object" ? options.host : undefined);
    const handler = createMcpHandler(
      () => createActionDockMcpServer({ ...options, host: resolvedHost, service }),
      {
        onerror: (err) => {
          process.stderr.write(`[MCP HTTP Error] ${err?.message || String(err)}\n`);
        },
      }
    );

    // JSON-RPC 形态的 401 响应构造：mcp 客户端按 JSON-RPC 错误信封消费鉴权失败
    // （错误码 -32000），区别于 core 网关的标准 JSON 信封
    const unauthorizedJsonRpcResponse = (
      corsHeaders: Record<string, string>
    ): Response =>
      new Response(
        JSON.stringify({
          jsonrpc: "2.0",
          error: {
            code: -32000,
            message: "Unauthorized: Invalid or missing Bearer token",
          },
          id: null,
        }),
        {
          status: 401,
          headers: {
            "Content-Type": "application/json",
            ...corsHeaders,
          },
        }
      );

    // MCP 端点共享处理器：Bearer 鉴权（401 JSON-RPC 形态）→ 请求体有界读取
    // （413 拦截）→ 重建 Request 委托 SDK 处理器 → CORS merge 回写。
    // 序列收敛为 core 单一事实源，此处仅以定制钩子表达 mcp 独立服务的差异
    const mcpEndpoint = createMcpEndpointHandler(
      (req) => handler.fetch(req),
      {
        token,
        allowQueryToken: (options as any).allowQueryToken,
        corsOrigins: options.corsOrigins,
        maxBodyBytes: options.maxBodyBytes,
        // mcp 独立服务将解析出的 CORS 头合并覆盖到 MCP 响应（core 网关为 inherit 透传）
        corsApplyMode: "merge",
        unauthorizedResponse: unauthorizedJsonRpcResponse,
      }
    );

    const server = await launchHttpServer(
      port,
      host,
      async (req) => {
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
      const verifyOptions = { allowQueryToken: (options as any).allowQueryToken };

      // 健康检查路由
      if (pathname === "/health") {
        if (!verifyBearerToken(req, token, verifyOptions)) {
          return new Response(
            JSON.stringify({
              ok: false,
              error: {
                code: UNAUTHORIZED,
                message: "Invalid or missing Bearer token",
              },
            }),
            {
              status: 401,
              headers: {
                "Content-Type": "application/json",
                ...corsHeaders,
              },
            }
          );
        }
        return new Response(
          JSON.stringify({
            status: "ok",
            protocol: "mcp",
            version: ACTIONDOCK_VERSION,
            timestamp: new Date().toISOString(),
          }),
          {
            status: 200,
            headers: {
              "Content-Type": "application/json",
              ...corsHeaders,
            },
          }
        );
      }

      // 委托 MCP 端点（/mcp 与 / 双路径，鉴权与限流由共享端点处理器承担）
      if (pathname === "/mcp" || pathname === "/") {
        return (await mcpEndpoint(req))!;
      }

      // 其余路径统一鉴权拦截：未认证访问任意未知路径返回 401 而非 404
      if (!verifyBearerToken(req, token, verifyOptions)) {
        return unauthorizedJsonRpcResponse(corsHeaders);
      }

      return new Response(
        JSON.stringify({
          error: "Not Found",
        }),
        {
          status: 404,
          headers: {
            "Content-Type": "application/json",
            ...corsHeaders,
          },
        }
      );
    }, options.tls);

    if (server.ready) {
      await server.ready;
    }

    const actualHost = host === "0.0.0.0" ? "127.0.0.1" : host;
    const protocol = options.tls ? "https" : "http";
    const url = `${protocol}://${formatHostForUrl(actualHost)}:${server.port}`;

    return {
      port: server.port ?? port,
      host,
      url,
      service,
      stop: async () => {
        // 先停 HTTP 服务（等待在途请求收尾）再释放 service：
        // 若先关 service，在途请求的后续 Action 调用会全部异常
        let serverError: unknown;
        try {
          await server.stop(true);
        } catch (err) {
          serverError = err;
        }
        try {
          await service.close();
        } catch (serviceErr) {
          if (serverError) {
            throw new AggregateError([serverError, serviceErr], "Failed to stop MCP HTTP server and service");
          }
          throw serviceErr;
        }
        if (serverError) {
          throw serverError;
        }
      },
    };
  })();
}
