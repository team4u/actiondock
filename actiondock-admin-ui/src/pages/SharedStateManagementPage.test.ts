import { describe, expect, it } from "vitest";
import {
  buildSharedStateSnippetItems,
  toGroovyLiteral,
  toPythonLiteral
} from "./SharedStateManagementPage";

describe("SharedStateManagementPage helpers", () => {
  it("returns no snippets when namespace or key is blank", () => {
    expect(buildSharedStateSnippetItems({
      apiKey: undefined,
      origin: "http://localhost:8080",
      namespace: "  ",
      key: "token",
      valueText: "{}",
      secret: false,
      exposeValue: true
    })).toEqual([]);

    expect(buildSharedStateSnippetItems({
      apiKey: undefined,
      origin: "http://localhost:8080",
      namespace: "oauth.github",
      key: "   ",
      valueText: "{}",
      secret: false,
      exposeValue: true
    })).toEqual([]);
  });

  it("builds groovy and python snippets from normalized values", () => {
    const snippets = buildSharedStateSnippetItems({
      apiKey: "local-dev-key",
      currentVersion: 7,
      expiresAt: "2026-04-28T12:00:00",
      namespace: " oauth.github ",
      key: " access-token ",
      origin: "http://localhost:8080",
      valueText: '{"accessToken":"gho_xxx","scopes":["repo"],"active":true,"ttl":null}',
      secret: true,
      exposeValue: true
    });

    expect(snippets).toHaveLength(10);
    expect(snippets[0]).toEqual({
      family: "Groovy",
      label: "state.get",
      value: 'def entry = state.get("oauth.github", "access-token")\nif (entry) {\n    return entry.value\n}\nreturn null'
    });
    expect(snippets[1]?.value).toContain('["accessToken": "gho_xxx", "scopes": ["repo"], "active": true, "ttl": null]');
    expect(snippets[1]?.value).toContain("[secret: true]");
    expect(snippets[2]?.value).toContain("current?.version");
    expect(snippets[4]).toEqual({
      family: "Python",
      label: "state.get",
      value: 'entry = state.get("oauth.github", "access-token")\nif entry:\n    return entry["value"]\nreturn None'
    });
    expect(snippets[5]?.value).toContain('{"accessToken": "gho_xxx", "scopes": ["repo"], "active": True, "ttl": None}');
    expect(snippets[6]?.value).toContain('current["version"] if current else None');
    expect(snippets[7]?.value).toContain('state.list("oauth.github")');
    expect(snippets[8]).toEqual({
      family: "CLI",
      label: "actiondock state put",
      value: "actiondock state put 'oauth.github' 'access-token' --token 'local-dev-key' --value-json '{\"accessToken\":\"gho_xxx\",\"scopes\":[\"repo\"],\"active\":true,\"ttl\":null}' --secret --expires-at '2026-04-28T12:00:00'"
    });
    expect(snippets[9]?.value).toContain("--expected-version");
    expect(snippets[9]?.value).toContain("'7'");
  });

  it("falls back to placeholder values when the current secret is hidden", () => {
    const snippets = buildSharedStateSnippetItems({
      apiKey: undefined,
      origin: "http://localhost:8080",
      namespace: "oauth.github",
      key: "access-token",
      valueText: '{"accessToken":"should-not-leak"}',
      secret: true,
      exposeValue: false
    });

    expect(snippets[1]?.value).not.toContain("should-not-leak");
    expect(snippets[1]?.value).toContain('["value": "..."]');
    expect(snippets[5]?.value).not.toContain("should-not-leak");
    expect(snippets[5]?.value).toContain('{"value": "..."}');
    expect(snippets[8]?.value).not.toContain("should-not-leak");
  });

  it("falls back to placeholder values when json is invalid", () => {
    const snippets = buildSharedStateSnippetItems({
      apiKey: undefined,
      origin: "http://localhost:8080",
      namespace: "workflow.invoice",
      key: "cursor",
      valueText: '{"cursor":',
      secret: false,
      exposeValue: true
    });

    expect(snippets[1]?.value).toContain('["value": "..."]');
    expect(snippets[2]?.value).toContain('["value": "..."]');
    expect(snippets[5]?.value).toContain('{"value": "..."}');
    expect(snippets[6]?.value).toContain('{"value": "..."}');
    expect(snippets[8]?.value).toContain('{"value":"..."}');
    expect(snippets[9]?.value).toContain('{"value":"..."}');
  });

  it("serializes json-compatible values into groovy and python literals", () => {
    expect(toGroovyLiteral(["a", 1, true, null, { nested: ["x"] }])).toBe('["a", 1, true, null, ["nested": ["x"]]]');
    expect(toPythonLiteral(["a", 1, true, null, { nested: ["x"] }])).toBe('["a", 1, True, None, {"nested": ["x"]}]');
    expect(toGroovyLiteral("hello")).toBe('"hello"');
    expect(toPythonLiteral(false)).toBe("False");
  });
});
