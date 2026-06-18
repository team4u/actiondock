import { describe, expect, it } from "vitest";

import { toToolSafeName, splitCsv, isScriptAllowed } from "../../../src/mcp/core/names.js";
import { defaultPolicy } from "../../../src/mcp/types.js";

describe("toToolSafeName", () => {
  it("lowercases and replaces non-safe runs with underscores", () => {
    expect(toToolSafeName("hello-groovy")).toBe("hello_groovy");
    expect(toToolSafeName("a.b/c")).toBe("a_b_c");
  });

  it("strips leading and trailing underscores", () => {
    expect(toToolSafeName("__x__")).toBe("x");
  });

  it("collapses multiple consecutive underscores into one", () => {
    expect(toToolSafeName("a---b___c")).toBe("a_b_c");
  });

  it("returns empty string for empty input", () => {
    expect(toToolSafeName("")).toBe("");
  });

  it("returns empty string when only separators are present", () => {
    expect(toToolSafeName("---...___")).toBe("");
  });
});

describe("splitCsv", () => {
  it("returns empty array for undefined", () => {
    expect(splitCsv(undefined)).toEqual([]);
  });

  it("returns empty array for empty string", () => {
    expect(splitCsv("")).toEqual([]);
  });

  it("returns a single trimmed entry", () => {
    expect(splitCsv(" foo ")).toEqual(["foo"]);
  });

  it("returns multiple trimmed entries", () => {
    expect(splitCsv("a, b ,c")).toEqual(["a", "b", "c"]);
  });

  it("drops blank entries", () => {
    expect(splitCsv("a, , b,")).toEqual(["a", "b"]);
  });
});

describe("isScriptAllowed", () => {
  it("allows everything when lists are empty", () => {
    expect(isScriptAllowed("any", defaultPolicy())).toBe(true);
  });

  it("rejects scripts in the denylist", () => {
    const policy = { ...defaultPolicy(), deniedScripts: ["secret"] };
    expect(isScriptAllowed("secret", policy)).toBe(false);
    expect(isScriptAllowed("other", policy)).toBe(true);
  });

  it("only allows scripts in a non-empty allowlist", () => {
    const policy = { ...defaultPolicy(), allowedScripts: ["good"] };
    expect(isScriptAllowed("good", policy)).toBe(true);
    expect(isScriptAllowed("bad", policy)).toBe(false);
  });

  it("denylist takes precedence over allowlist", () => {
    const policy = { ...defaultPolicy(), allowedScripts: ["good"], deniedScripts: ["good"] };
    expect(isScriptAllowed("good", policy)).toBe(false);
  });
});
