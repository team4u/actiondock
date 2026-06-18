import { ActionDockCliError } from "../../lib/error.js";
import { redactSecrets } from "./redaction.js";
/**
 * Wrap a business {@code data} payload as an MCP text tool result.
 *
 * <p>The payload is first passed through {@link redactSecrets}, then serialized
 * to pretty JSON. When the byte size exceeds {@link McpPolicy.maxResultBytes}
 * the result is replaced with a truncated envelope carrying a preview of the
 * first {@code maxResultBytes} bytes.
 */
export function toMcpJson(data, policy) {
    const redacted = redactSecrets(data, policy.redactSecrets);
    const serialized = JSON.stringify(redacted, null, 2);
    const sizeBytes = Buffer.byteLength(serialized, "utf8");
    let result;
    if (sizeBytes > policy.maxResultBytes) {
        const preview = serialized.slice(0, policy.maxResultBytes);
        result = { ok: true, truncated: true, sizeBytes, data: { preview } };
    }
    else {
        result = { ok: true, data: redacted };
    }
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
}
/**
 * Wrap a thrown {@code error} as an MCP error tool result. Unwraps the message
 * (and optional {@link ActionDockCliError.details}) into a structured envelope.
 */
export function toMcpError(error) {
    const message = error instanceof Error ? error.message : String(error);
    const detail = error instanceof ActionDockCliError ? error.details : undefined;
    const payload = {
        ok: false,
        error: {
            code: "ACTIONDOCK_ERROR",
            message,
            ...(detail === undefined ? {} : { detail })
        }
    };
    return { content: [{ type: "text", text: JSON.stringify(payload, null, 2) }], isError: true };
}
