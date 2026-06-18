import http, { type IncomingMessage, type Server, type ServerResponse } from "node:http";

import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

import { ActionDockClient } from "../../lib/client.js";
import { createActionDockMcpServer } from "../server.js";
import type { McpPolicy, ToolContext } from "../types.js";

/**
 * Loopback addresses the HTTP transport is allowed to bind. Binding to a
 * non-loopback address (e.g. {@code 0.0.0.0}) would expose the MCP server to
 * the network and is rejected outright.
 */
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1"]);

/**
 * Maximum accepted request body size (10 MB). Larger requests are rejected
 * with {@code 413 Payload Too Large} before any JSON parsing.
 */
const MAX_BODY_BYTES = 10 * 1024 * 1024;

/**
 * Options controlling where the stateless HTTP transport listens.
 */
export interface HttpTransportOptions {
  /** Bind address; must be a loopback host (see {@link LOOPBACK_HOSTS}). */
  host: string;
  /** TCP port to listen on. */
  port: number;
  /** Request path that MCP clients POST to (e.g. {@code /mcp}). */
  endpoint: string;
}

/**
 * Per-request context: the ActionDock backend URL plus the active policy. The
 * token is intentionally absent here — it is taken from each incoming request's
 * {@code Authorization} header so identity is forwarded to the backend rather
 * than owned by the MCP process. See {@link deriveRequestContext}.
 */
export interface HttpTransportContext {
  /** ActionDock backend URL (e.g. {@code http://127.0.0.1:5177}). */
  serverUrl: string;
  /** Active policy gating tool registration and result shaping. */
  policy: McpPolicy;
}

/**
 * Start the ActionDock MCP server on a stateless Streamable HTTP transport.
 *
 * <p>Each incoming POST to {@code opts.endpoint} builds a fresh
 * {@link createActionDockMcpServer server} + {@link StreamableHTTPServerTransport}
 * pair (stateless mode: no session id, no SSE GET, no DELETE). Non-POST
 * requests or wrong paths get a {@code 405}; oversized bodies get a
 * {@code 413}; invalid JSON gets a {@code 400}. The bind host must be
 * loopback or an error is thrown before {@code listen}.
 *
 * <p><b>Authentication is pass-through, not enforced here.</b> The MCP server
 * holds no credentials of its own. For every request it derives an
 * {@link ActionDockClient} from the request's {@code Authorization: Bearer ...}
 * header (falling back to an anonymous client when none is present) and lets
 * the ActionDock backend decide — a missing/invalid token surfaces as a
 * {@code 401} from the backend, returned to the client as a tool error.
 *
 * <p>SIGINT/SIGTERM perform an orderly {@link Server.close} before exiting.
 *
 * @param ctx   backend URL + policy (token is per-request, see above)
 * @param opts  listen host/port/endpoint
 */
export async function startHttp(ctx: HttpTransportContext, opts: HttpTransportOptions): Promise<void> {
  if (!LOOPBACK_HOSTS.has(opts.host)) {
    throw new Error(
      `Refusing to bind HTTP transport to non-loopback host '${opts.host}'. ` +
        "Use one of: 127.0.0.1, localhost, ::1."
    );
  }

  const server = http.createServer(async (req: IncomingMessage, res: ServerResponse) => {
    await handleRequest(req, res, ctx, opts);
  });

  server.listen(opts.port, opts.host, () => {
    console.error(
      `[actiondock-mcp] http transport ready: http://${opts.host}:${opts.port}${opts.endpoint}`
    );
  });

  const shutdown = (signal: string): void => {
    console.error(`[actiondock-mcp] ${signal} received, shutting down HTTP transport`);
    server.close(() => process.exit(0));
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

/**
 * Extract the bearer token from an {@code Authorization} header, if present.
 *
 * <p>Accepts the standard {@code Bearer <token>} form (scheme matched
 * case-insensitively). Returns {@code undefined} when the header is absent or
 * does not use the bearer scheme — the caller then builds an anonymous client
 * and lets the backend reject it if credentials are required.
 *
 * @param header  raw {@code Authorization} header value, possibly {@code undefined}
 * @returns the bare token (no {@code Bearer } prefix) or {@code undefined}
 */
export function extractBearerToken(header: string | undefined): string | undefined {
  if (!header) {
    return undefined;
  }
  const match = header.match(/^\s*Bearer\s+(.+?)\s*$/i);
  return match ? match[1] : undefined;
}

/**
 * Derive a per-request {@link ToolContext} by forwarding the caller's identity.
 *
 * <p>Constructs a fresh {@link ActionDockClient} bound to {@code ctx.serverUrl}
 * using the token extracted from the request's {@code Authorization} header.
 * Constructing a client is pure object instantiation (no I/O), so doing it per
 * request is cheap. When no bearer token is present, an anonymous client is
 * built and the backend's own auth filter decides whether to allow the call.
 *
 * @param ctx   backend URL + policy
 * @param req   incoming request carrying the (optional) {@code Authorization} header
 * @returns a {@link ToolContext} whose client carries the caller's token
 */
export function deriveRequestContext(ctx: HttpTransportContext, req: IncomingMessage): ToolContext {
  const token = extractBearerToken(req.headers.authorization);
  const client = new ActionDockClient({ serverUrl: ctx.serverUrl, token });
  return { client, policy: ctx.policy };
}

/**
 * Handle a single HTTP request: route to the MCP handler or respond with the
 * appropriate error envelope. Extracted from {@link startHttp} so the request
 * path is isolated from server lifecycle wiring.
 */
async function handleRequest(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: HttpTransportContext,
  opts: HttpTransportOptions
): Promise<void> {
  const url = new URL(req.url ?? "/", "http://localhost");

  if (req.method !== "POST" || url.pathname !== opts.endpoint) {
    res.writeHead(405, { "content-type": "application/json" }).end(
      JSON.stringify({
        jsonrpc: "2.0",
        error: { code: -32000, message: "Method not allowed." },
        id: null
      })
    );
    return;
  }

  const chunks: Buffer[] = [];
  let size = 0;
  try {
    for await (const chunk of req) {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        res.writeHead(413, { "content-type": "text/plain" }).end("payload too large");
        return;
      }
      chunks.push(chunk as Buffer);
    }
  } catch {
    if (!res.headersSent) {
      res.writeHead(400, { "content-type": "text/plain" }).end("invalid request stream");
    }
    return;
  }

  const body = Buffer.concat(chunks).toString("utf8");
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    res.writeHead(400, { "content-type": "text/plain" }).end("invalid json");
    return;
  }

  // Stateless + pass-through auth: derive a client carrying the caller's token
  // for this request, then build a fresh server + transport pair around it.
  // The transport and server are torn down when the response closes.
  try {
    const requestCtx = deriveRequestContext(ctx, req);
    const mcpServer = await createActionDockMcpServer(requestCtx);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    await mcpServer.connect(transport);
    await transport.handleRequest(req, res, parsed);
    res.on("close", () => {
      transport.close();
      void mcpServer.close();
    });
  } catch (error) {
    console.error("[actiondock-mcp] request error", error);
    if (!res.headersSent) {
      res.writeHead(500, { "content-type": "application/json" }).end(
        JSON.stringify({
          jsonrpc: "2.0",
          error: { code: -32603, message: "Internal server error" },
          id: null
        })
      );
    }
  }
}
