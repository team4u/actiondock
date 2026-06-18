import { describe, expect, it } from "vitest";

import { isRiskEnabled, requireRisk } from "../../../src/mcp/core/policy.js";
import { defaultPolicy } from "../../../src/mcp/types.js";
import type { McpPolicy } from "../../../src/mcp/types.js";

describe("isRiskEnabled", () => {
  it("always allows read", () => {
    expect(isRiskEnabled("read", defaultPolicy())).toBe(true);
    const lockedDown: McpPolicy = {
      ...defaultPolicy(),
      enableExecuteTools: false,
      enableWriteTools: false,
      enableAdminTools: false
    };
    expect(isRiskEnabled("read", lockedDown)).toBe(true);
  });

  it("maps execute to enableExecuteTools", () => {
    expect(isRiskEnabled("execute", defaultPolicy())).toBe(true);
    expect(isRiskEnabled("execute", { ...defaultPolicy(), enableExecuteTools: false })).toBe(false);
  });

  it("maps write to enableWriteTools", () => {
    expect(isRiskEnabled("write", defaultPolicy())).toBe(false);
    expect(isRiskEnabled("write", { ...defaultPolicy(), enableWriteTools: true })).toBe(true);
  });

  it("maps admin to enableAdminTools", () => {
    expect(isRiskEnabled("admin", defaultPolicy())).toBe(false);
    expect(isRiskEnabled("admin", { ...defaultPolicy(), enableAdminTools: true })).toBe(true);
  });
});

describe("requireRisk", () => {
  it("never throws for read", () => {
    expect(() => requireRisk("read", defaultPolicy())).not.toThrow();
  });

  it("throws when the matching flag is disabled", () => {
    expect(() => requireRisk("execute", { ...defaultPolicy(), enableExecuteTools: false }))
      .toThrow("Tool disabled by MCP policy: execute");
    expect(() => requireRisk("write", defaultPolicy()))
      .toThrow("Tool disabled by MCP policy: write");
    expect(() => requireRisk("admin", defaultPolicy()))
      .toThrow("Tool disabled by MCP policy: admin");
  });

  it("does not throw when the matching flag is enabled", () => {
    expect(() => requireRisk("execute", defaultPolicy())).not.toThrow();
    expect(() => requireRisk("write", { ...defaultPolicy(), enableWriteTools: true })).not.toThrow();
    expect(() => requireRisk("admin", { ...defaultPolicy(), enableAdminTools: true })).not.toThrow();
  });
});
