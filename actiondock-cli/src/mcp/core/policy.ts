import type { McpPolicy, ToolRisk } from "../types.js";

/**
 * Non-throwing variant of {@link requireRisk}. Returns whether tools of the
 * given risk level may be registered under {@code policy}.
 */
export function isRiskEnabled(risk: ToolRisk, policy: McpPolicy): boolean {
  switch (risk) {
    case "read":
      return true;
    case "execute":
      return policy.enableExecuteTools;
    case "write":
      return policy.enableWriteTools;
    case "admin":
      return policy.enableAdminTools;
    default:
      return false;
  }
}

/**
 * Assert that tools of {@code risk} are permitted by {@code policy}. Throws an
 * {@link Error} with message {@code Tool disabled by MCP policy: <risk>} when
 * the level is gated off.
 */
export function requireRisk(risk: ToolRisk, policy: McpPolicy): void {
  if (!isRiskEnabled(risk, policy)) {
    throw new Error(`Tool disabled by MCP policy: ${risk}`);
  }
}
