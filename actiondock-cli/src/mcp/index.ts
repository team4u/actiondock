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
  /**
   * ActionDock backend URL (e.g. {@code http://127.0.0.1:5177}). Required for
   * the HTTP transport, which derives a per-request client from each caller's
   * {@code Authorization} header bound to this URL; ignored by stdio.
   */
  serverUrl: string;
}

/**
 * Start the ActionDock MCP server on the requested transport and block until
 * it shuts down.
 *
 * <p>{@code stdio} wires a {@link StdioServerTransport} that owns the process
 * lifetime and uses the supplied {@code client} (its token comes from the
 * process's {@code --token} / {@code ACTIONDOCK_TOKEN}).
 *
 * <p>{@code http} starts a stateless Streamable HTTP server bound to the
 * loopback {@code host}/{@code port} serving {@code endpoint}. Authentication
 * is pass-through: the supplied {@code client}'s token is <em>not</em> used —
 * each request derives its own client from the caller's
 * {@code Authorization} header (or none, when absent) against {@code serverUrl},
 * so identity is forwarded to the ActionDock backend rather than owned here.
 *
 * @param opts  transport selection plus client/policy context and backend URL
 */
export async function startActionDockMcp(opts: StartActionDockMcpOptions): Promise<void> {
  if (opts.transport === "stdio") {
    await startStdio({ client: opts.client, policy: opts.policy });
    return;
  }

  await startHttp(
    { serverUrl: opts.serverUrl, policy: opts.policy },
    { host: opts.host, port: opts.port, endpoint: opts.endpoint }
  );
}
