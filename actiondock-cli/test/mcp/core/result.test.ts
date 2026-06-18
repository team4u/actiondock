import { describe, expect, it } from "vitest";

import { toMcpJson, toMcpError } from "../../../src/mcp/core/result.js";
import { defaultPolicy } from "../../../src/mcp/types.js";
import { ActionDockCliError } from "../../../src/lib/error.js";

function parseContent(result: { content: [{ type: string; text: string }] }): unknown {
  return JSON.parse(result.content[0].text);
}

describe("toMcpJson", () => {
  it("wraps data in an ok envelope", () => {
    const result = toMcpJson({ name: "bob" }, defaultPolicy());
    expect(result.content[0].type).toBe("text");
    expect(parseContent(result)).toEqual({ ok: true, data: { name: "bob" } });
  });

  it("redacts secrets when redactSecrets is enabled", () => {
    const result = toMcpJson({ token: "abc" }, defaultPolicy());
    expect(parseContent(result)).toEqual({ ok: true, data: { token: "***" } });
  });

  it("skips redaction when redactSecrets is disabled", () => {
    const policy = { ...defaultPolicy(), redactSecrets: false };
    const result = toMcpJson({ token: "abc" }, policy);
    expect(parseContent(result)).toEqual({ ok: true, data: { token: "abc" } });
  });

  it("truncates oversized payloads", () => {
    const policy = { ...defaultPolicy(), maxResultBytes: 8 };
    const big = { value: "abcdefghijklmnopqrstuvwxyz" };
    const result = toMcpJson(big, policy);
    const parsed = parseContent(result) as { ok: boolean; truncated: boolean; sizeBytes: number; data: { preview: string } };
    expect(parsed.ok).toBe(true);
    expect(parsed.truncated).toBe(true);
    expect(parsed.sizeBytes).toBeGreaterThan(8);
    expect(parsed.data.preview.length).toBe(8);
    expect(parsed.data.preview).toBe(JSON.stringify(big, null, 2).slice(0, 8));
  });

  it("does not truncate payloads under the cap", () => {
    const policy = { ...defaultPolicy(), maxResultBytes: 1_000_000 };
    const result = toMcpJson({ value: "small" }, policy);
    expect(parseContent(result)).toEqual({ ok: true, data: { value: "small" } });
  });
});

describe("toMcpError", () => {
  it("wraps a plain Error", () => {
    const result = toMcpError(new Error("boom"));
    expect(result.isError).toBe(true);
    expect(result.content[0].type).toBe("text");
    expect(JSON.parse(result.content[0].text)).toEqual({
      ok: false,
      error: { code: "ACTIONDOCK_ERROR", message: "boom" }
    });
  });

  it("includes details from ActionDockCliError when present", () => {
    const result = toMcpError(new ActionDockCliError("bad input", 2, { field: "x" }));
    expect(JSON.parse(result.content[0].text)).toEqual({
      ok: false,
      error: { code: "ACTIONDOCK_ERROR", message: "bad input", detail: { field: "x" } }
    });
  });

  it("handles non-Error throwables", () => {
    const result = toMcpError("string error");
    expect(JSON.parse(result.content[0].text)).toEqual({
      ok: false,
      error: { code: "ACTIONDOCK_ERROR", message: "string error" }
    });
  });

  it("omits detail key when ActionDockCliError has no details", () => {
    const result = toMcpError(new ActionDockCliError("nope", 2));
    const parsed = JSON.parse(result.content[0].text) as { error: { detail?: unknown } };
    expect(parsed.error.detail).toBeUndefined();
  });
});
