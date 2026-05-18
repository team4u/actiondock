import { describe, expect, it } from "vitest";
import { buildPluginInvokeSnippet, buildScriptInvokeSnippet } from "./scriptInvocationSnippets";

describe("script invocation snippets", () => {
  it("formats Groovy script invocation with Groovy literals", () => {
    expect(
      buildScriptInvokeSnippet("GROOVY", "child", {
        name: "Alice",
        enabled: true,
        nested: {
          count: 2
        }
      })
    ).toBe(`scripts.invoke("child", [
  "name": "Alice",
  "enabled": true,
  "nested": [
    "count": 2
  ]
])`);
  });

  it("formats Python script invocation with Python literals", () => {
    expect(
      buildScriptInvokeSnippet("PYTHON", "child", {
        name: "Alice",
        enabled: true,
        missing: null
      })
    ).toBe(`scripts.invoke("child", {
  "name": "Alice",
  "enabled": True,
  "missing": None
})`);
  });

  it("omits empty args for plugin invocation", () => {
    expect(buildPluginInvokeSnippet("GROOVY", "demo-plugin", "ping", {})).toBe(
      `plugins.invoke("demo-plugin", "ping")`
    );
  });

  it("formats ActionDock AI plugin invocation with nested Groovy literals", () => {
    expect(
      buildPluginInvokeSnippet("GROOVY", "actiondock-ai", "chat", {
        modelProfile: "default-chat",
        messages: [
          {
            role: "user",
            content: "hello"
          }
        ]
      })
    ).toBe(`plugins.invoke("actiondock-ai", "chat", [
  "modelProfile": "default-chat",
  "messages": [
    [
      "role": "user",
      "content": "hello"
    ]
  ]
])`);
  });
});
