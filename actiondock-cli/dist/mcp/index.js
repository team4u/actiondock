import { startHttp } from "./transports/http.js";
import { startStdio } from "./transports/stdio.js";
export { defaultPolicy } from "./types.js";
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
export async function startActionDockMcp(opts) {
    const ctx = { client: opts.client, policy: opts.policy };
    if (opts.transport === "stdio") {
        await startStdio(ctx);
        return;
    }
    await startHttp(ctx, { host: opts.host, port: opts.port, endpoint: opts.endpoint });
}
