import {
  ACTIONDOCK_VERSION,
  UNAUTHORIZED,
} from "@actiondock/core";
import {
  DEFAULT_MAX_BODY_BYTES,
  formatHostForUrl,
  isLoopbackHost,
  launchHttpServer,
  resolveCorsHeaders,
  verifyBearerToken,
} from "@actiondock/core/server";
import { createMcpHandler } from "@modelcontextprotocol/server";
import { createActionDockMcpServer, resolveService } from "./adapter";
import type { ActionDockMcpHttpOptions, ActionDockMcpHttpServerInstance } from "./types";

/** 请求体读取超限时返回的哨兵，调用方据此构造 413 响应 */
const REQUEST_BODY_TOO_LARGE = Symbol("actiondock.requestBodyTooLarge");

/**
 * 有界读取请求体字节流（本包私有的限流读取原语）。
 *
 * 防护策略与 core/server 的 readJsonBody 保持同构：
 * 快速拒绝（Content-Length 预检）、流式计数（超限即刻取消读流）、
 * chunk 拼接为完整 Uint8Array；超限时不抛出异常而是返回哨兵值，
 * 由调用方自行决定错误响应形态（如 413 JSON）。
 *
 * @param req 待读取的 Request 对象
 * @param maxBytes 单次请求体允许的最大字节数
 * @returns 完整请求体字节；超限时返回 REQUEST_BODY_TOO_LARGE 哨兵
 */
async function readBodyWithLimit(
  req: Request,
  maxBytes: number
): Promise<Uint8Array | typeof REQUEST_BODY_TOO_LARGE> {
  // 1. 快速拒绝：Content-Length 头部预检，避免任何内存分配
  const contentLengthHeader = req.headers.get("content-length");
  if (contentLengthHeader) {
    const parsedLength = parseInt(contentLengthHeader, 10);
    if (!isNaN(parsedLength) && parsedLength > maxBytes) {
      return REQUEST_BODY_TOO_LARGE;
    }
  }

  if (!req.body) {
    return new Uint8Array(0);
  }

  // 2. 流式读取并实时计数：中途超限即刻取消并释放流锁，防止大文件 DoS 与内存耗尽
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
    return REQUEST_BODY_TOO_LARGE;
  }

  // 3. 拼接完整字节数组
  const merged = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return merged;
}

/**
 * 构造 413 Payload Too Large JSON 响应。
 */
function requestTooLargeResponse(corsHeaders: Record<string, string>): Response {
  return new Response(
    JSON.stringify({
      ok: false,
      error: {
        code: "REQUEST_TOO_LARGE",
        message: "Request body exceeds maximum allowed size",
      },
    }),
    {
      status: 413,
      headers: {
        "Content-Type": "application/json",
        ...corsHeaders,
      },
    }
  );
}

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

    const handler = createMcpHandler(
      () => createActionDockMcpServer({ service }),
      {
        onerror: (err) => {
          process.stderr.write(`[MCP HTTP Error] ${err?.message || String(err)}\n`);
        },
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

      // 1. Health check
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

      // 2. Authentication check
      if (!verifyBearerToken(req, token, verifyOptions)) {
        return new Response(
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
      }

      // 3. Delegate MCP endpoint
      if (pathname === "/mcp" || pathname === "/") {
        const maxBytes = options.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES;

        let currentReq = req;
        if (req.body && req.method !== "GET" && req.method !== "HEAD") {
          const bodyBytes = await readBodyWithLimit(req, maxBytes);
          if (bodyBytes === REQUEST_BODY_TOO_LARGE) {
            return requestTooLargeResponse(corsHeaders);
          }

          // BodyInit 交叉类型对 Uint8Array 的 ArrayBuffer 变体敏感，
          // 复制到确切 ArrayBuffer 后以字节数组视图传递
          const bodyBuffer = new ArrayBuffer(bodyBytes.byteLength);
          new Uint8Array(bodyBuffer).set(bodyBytes);
          currentReq = new Request(req.url, {
            method: req.method,
            headers: req.headers,
            body: new Uint8Array(bodyBuffer),
            signal: req.signal,
          });
        }

        const mcpResponse = await handler.fetch(currentReq);
        if (Object.keys(corsHeaders).length > 0) {
          const newHeaders = new Headers(mcpResponse.headers);
          for (const [k, v] of Object.entries(corsHeaders)) {
            newHeaders.set(k, String(v));
          }
          return new Response(mcpResponse.body, {
            status: mcpResponse.status,
            statusText: mcpResponse.statusText,
            headers: newHeaders,
          });
        }
        return mcpResponse;
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
