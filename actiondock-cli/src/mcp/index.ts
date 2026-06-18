import type { ActionDockClient } from "../lib/client.js";
import { startHttp } from "./transports/http.js";
import { startStdio } from "./transports/stdio.js";
import type { McpPolicy } from "./types.js";

export { defaultPolicy } from "./types.js";
export type { McpPolicy } from "./types.js";

/**
 * Options handed to {@link startActionDockMcp}.
 */
export interface StartActionDockMcpOptions {
  /** ActionDock client used by registered tools. */
  client: ActionDockClient;
  /** Active policy gating tool registration and result shaping. */
  policy: McpPolicy;
  /** Transport selection: {@code stdio} or {@code http}. */
  transport: "stdio" | "http";
  /** HTTP bind address (stdio mode ignores this). Must be loopback. */
  host: string;
  /** HTTP bind port (stdio mode ignores this). */
  port: number;
  /** HTTP request path (stdio mode ignores this). */
  endpoint: string;
}

/**
 * Start the ActionDock MCP server on the requested transport and block until
 * it shuts down.
 *
 * <p>{@code stdio} wires a {@link StdioServerTransport} that owns the process
 * lifetime. {@code http} starts a stateless Streamable HTTP server bound to
 * the loopback {@code host}/{@code port} and serving {@code endpoint}.
 *
 * @param opts  transport selection plus the shared client/policy context
 */
export async function startActionDockMcp(opts: StartActionDockMcpOptions): Promise<void> {
  const ctx = { client: opts.client, policy: opts.policy };

  if (opts.transport === "stdio") {
    await startStdio(ctx);
    return;
  }

  await startHttp(ctx, { host: opts.host, port: opts.port, endpoint: opts.endpoint });
}
