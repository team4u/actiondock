import {
  ACTIONDOCK_VERSION,
  DEFAULT_MAX_BODY_BYTES,
  formatHostForUrl,
  isLoopbackHost,
  launchHttpServer,
  resolveCorsHeaders,
  verifyBearerToken,
  UNAUTHORIZED,
} from "@actiondock/core";
import { createMcpHandler } from "@modelcontextprotocol/server";
import { createActionDockMcpServer, resolveTarget } from "./adapter";
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

  // Non-loopback address requires token authentication by default
  if (!isLoopbackHost(host) && !token && !options.allowInsecureNoAuth) {
    throw new Error(
      "Authentication token is required when binding to a non-loopback address. Use --allow-insecure-no-auth to override."
    );
  }

  return (async () => {
    // 先一次性解析 target，工厂闭包直接捕获已解析产物，消除选项重复展开
    const { target } = await resolveTarget({
      ...options,
      host: hostInstance ?? (typeof options.host === "object" ? options.host : undefined),
    });

    const handler = createMcpHandler(
      () => createActionDockMcpServer({ target }),
      {
        onerror: (err) => {
          process.stderr.write(`[MCP HTTP Error] ${err?.message || String(err)}\n`);
        },
      }
    );

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
      const verifyOptions = { allowQueryToken: (options as any).allowQueryToken };

      // 1. Health check
      if (pathname === "/health" || pathname === "/api/v1/health") {
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
        const contentLengthHeader = req.headers.get("content-length");
        if (contentLengthHeader) {
          const parsedLength = parseInt(contentLengthHeader, 10);
          if (!isNaN(parsedLength) && parsedLength > maxBytes) {
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
        }

        let currentReq = req;
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

          const merged = new Uint8Array(totalBytes);
          let offset = 0;
          for (const chunk of chunks) {
            merged.set(chunk, offset);
            offset += chunk.byteLength;
          }
          currentReq = new Request(req.url, {
            method: req.method,
            headers: req.headers,
            body: merged,
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
    });

    if (server.ready) {
      await server.ready;
    }

    const actualHost = host === "0.0.0.0" ? "127.0.0.1" : host;
    const url = `http://${formatHostForUrl(actualHost)}:${server.port}`;

    return {
      port: server.port ?? port,
      host,
      url,
      target,
      stop: async () => {
        let targetError: unknown;
        try {
          await target.close();
        } catch (err) {
          targetError = err;
        }
        try {
          await server.stop(true);
        } catch (serverErr) {
          if (targetError) {
            throw new AggregateError([targetError, serverErr], "Failed to stop MCP HTTP server and target");
          }
          throw serverErr;
        }
        if (targetError) {
          throw targetError;
        }
      },
    };
  })();
}
