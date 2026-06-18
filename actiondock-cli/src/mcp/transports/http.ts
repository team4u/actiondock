import http, { type IncomingMessage, type Server, type ServerResponse } from "node:http";

import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

import { createActionDockMcpServer } from "../server.js";
import type { ToolContext } from "../types.js";

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
 * Start the ActionDock MCP server on a stateless Streamable HTTP transport.
 *
 * <p>Each incoming POST to {@code opts.endpoint} builds a fresh
 * {@link createActionDockMcpServer server} + {@link StreamableHTTPServerTransport}
 * pair (stateless mode: no session id, no SSE GET, no DELETE). Non-POST
 * requests or wrong paths get a {@code 405}; oversized bodies get a
 * {@code 413}; invalid JSON gets a {@code 400}. The bind host must be
 * loopback or an error is thrown before {@code listen}.
 *
 * <p>SIGINT/SIGTERM perform an orderly {@link Server.close} before exiting.
 *
 * @param ctx   shared context carrying the ActionDock client and active policy
 * @param opts  listen host/port/endpoint
 */
export async function startHttp(ctx: ToolContext, opts: HttpTransportOptions): Promise<void> {
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
 * Handle a single HTTP request: route to the MCP handler or respond with the
 * appropriate error envelope. Extracted from {@link startHttp} so the request
 * path is isolated from server lifecycle wiring.
 */
async function handleRequest(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: ToolContext,
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

  // Stateless: a brand-new server + transport pair per request. The transport
  // and server are torn down when the response closes.
  try {
    const mcpServer = await createActionDockMcpServer(ctx);
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
