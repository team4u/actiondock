import {
  ACTIONDOCK_VERSION,
  isLoopbackHost,
  launchHttpServer,
  resolveCorsHeaders,
  verifyBearerToken,
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
    const hostTarget = hostInstance ?? (typeof options.host === "object" ? options.host : undefined);
    const { target } = await resolveTarget({
      ...options,
      host: hostTarget,
    });

    const handler = createMcpHandler(
      () => {
        const { host: _httpHost, ...restOptions } = options;
        return createActionDockMcpServer({
          ...restOptions,
          host: hostTarget,
          target,
        });
      },
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

      // 1. Health check
      if (pathname === "/health" || pathname === "/api/v1/health") {
        if (!verifyBearerToken(req, token)) {
          return new Response(
            JSON.stringify({
              ok: false,
              error: {
                code: "UNAUTHORIZED",
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
      if (!verifyBearerToken(req, token)) {
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
        const mcpResponse = await handler.fetch(req);
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
    const url = `http://${actualHost}:${server.port}`;

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
