import { describe, expect, it } from "vitest";

import { redactSecrets } from "../../../src/mcp/core/redaction.js";

describe("redactSecrets", () => {
  it("returns input unchanged when disabled", () => {
    const input = { token: "abc", password: "x" };
    expect(redactSecrets(input, false)).toBe(input);
  });

  it("masks known secret keys", () => {
    expect(redactSecrets({ token: "abc", password: "x", apiKey: "k" }, true)).toEqual({
      token: "***",
      password: "***",
      apiKey: "***"
    });
  });

  it("leaves non-secret keys untouched", () => {
    expect(redactSecrets({ name: "bob", count: 3 }, true)).toEqual({ name: "bob", count: 3 });
  });

  it("matches secret hints case-insensitively", () => {
    expect(redactSecrets({ Authorization: "Bearer x", REFRESH_TOKEN: "y" }, true)).toEqual({
      Authorization: "***",
      REFRESH_TOKEN: "***"
    });
  });

  it("recurses into nested objects", () => {
    const input = { outer: { inner: { secret: "s" }, ok: 1 } };
    expect(redactSecrets(input, true)).toEqual({ outer: { inner: { secret: "***" }, ok: 1 } });
  });

  it("recurses into arrays", () => {
    const input = [{ password: "p" }, { name: "ok" }];
    expect(redactSecrets(input, true)).toEqual([{ password: "***" }, { name: "ok" }]);
  });

  it("returns primitives as-is", () => {
    expect(redactSecrets("plain", true)).toBe("plain");
    expect(redactSecrets(42, true)).toBe(42);
    expect(redactSecrets(null, true)).toBeNull();
  });

  it("handles credential-keyword keys", () => {
    expect(redactSecrets({ credentials: { sub: 1 } }, true)).toEqual({ credentials: "***" });
  });
});
