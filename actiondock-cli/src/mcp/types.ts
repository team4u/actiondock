import type { ActionDockClient } from "../lib/client.js";

/**
 * Risk classification for an MCP-exposed tool.
 *
 * <p>Used by {@link requireRisk} / {@link isRiskEnabled} to gate tool registration
 * against the active {@link McpPolicy}. {@code read} tools always pass; the other
 * levels are controlled by the matching policy flag.
 */
export type ToolRisk = "read" | "execute" | "write" | "admin";

/**
 * Policy that governs which MCP tools are registered and how results are shaped.
 */
export interface McpPolicy {
  /** Allow tools classified as {@code execute} (e.g. script execution). */
  enableExecuteTools: boolean;
  /** Allow tools classified as {@code write} (e.g. mutating repositories). */
  enableWriteTools: boolean;
  /** Allow tools classified as {@code admin} (e.g. token / config management). */
  enableAdminTools: boolean;
  /** Allow dynamic per-script tools generated from published scripts. */
  enableDynamicTools: boolean;
  /** When non-empty, only these script ids are exposed as dynamic tools. */
  allowedScripts: string[];
  /** These script ids are never exposed as dynamic tools. */
  deniedScripts: string[];
  /** Maximum byte size of a serialized tool result before it is truncated. */
  maxResultBytes: number;
  /** Whether to redact secret-looking fields from tool results. */
  redactSecrets: boolean;
}

/**
 * Context handed to a tool-registration function: the ActionDock client used by
 * handlers to talk to the backend, plus the active policy that gates which tools
 * are registered and how results are shaped.
 */
export interface ToolContext {
  /** ActionDock client used by tool handlers. */
  client: ActionDockClient;
  /** Active policy gating tool registration and result shaping. */
  policy: McpPolicy;
}

/**
 * Options used to construct and run the ActionDock MCP server.
 */
export interface McpServerOptions {
  /** ActionDock client used by tool handlers to talk to the backend. */
  client: ActionDockClient;
  /** Active policy gating tool registration and result shaping. */
  policy: McpPolicy;
  /** Server identity reported to the MCP client. */
  serverInfo?: { name: string; version: string };
}

/**
 * Sensible default policy: execute + dynamic tools enabled, write + admin
 * disabled, 200 KB result cap, secret redaction on, empty allow/deny lists.
 */
export function defaultPolicy(): McpPolicy {
  return {
    enableExecuteTools: true,
    enableWriteTools: false,
    enableAdminTools: false,
    enableDynamicTools: true,
    allowedScripts: [],
    deniedScripts: [],
    maxResultBytes: 200_000,
    redactSecrets: true
  };
}
