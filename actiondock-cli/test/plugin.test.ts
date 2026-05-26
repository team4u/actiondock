import { describe, expect, it } from "vitest";

import { renderPluginActionDetail, renderPluginDetail } from "../src/lib/render.js";
import type { PluginActionDefinition, PluginView } from "../src/lib/types.js";

describe("renderPluginActionDetail", () => {
  it("renders minimal action with name only", () => {
    const action: PluginActionDefinition = { action: "hello" };
    const result = renderPluginActionDetail(action);
    expect(result).toBe("Action: hello");
  });

  it("renders action with title and description", () => {
    const action: PluginActionDefinition = {
      action: "search",
      title: "Search",
      description: "Search the knowledge base"
    };
    const result = renderPluginActionDetail(action);
    expect(result).toContain("Action: search (Search)");
    expect(result).toContain("Description: Search the knowledge base");
  });

  it("renders input schema fields with flag and json-only split", () => {
    const action: PluginActionDefinition = {
      action: "create",
      inputSchema: {
        type: "object",
        required: ["name"],
        properties: {
          name: { type: "string", description: "Item name" },
          count: { type: "integer", default: 10 },
          filter: { type: "object", description: "Filter object" },
          mode: { type: "string", enum: ["fast", "slow"] }
        }
      }
    };
    const result = renderPluginActionDetail(action);
    expect(result).toContain("Input:");
    expect(result).toContain("--name <string> required");
    expect(result).toContain("--count <integer>");
    expect(result).toContain("default=10");
    expect(result).toContain("--mode <enum>");
    expect(result).toContain("enum=fast|slow");
    expect(result).toContain("JSON-only fields:");
    expect(result).toContain("filter <object>");
  });

  it("renders output schema as formatted JSON", () => {
    const action: PluginActionDefinition = {
      action: "query",
      outputSchema: {
        type: "object",
        properties: { total: { type: "integer" } }
      }
    };
    const result = renderPluginActionDetail(action);
    expect(result).toContain("Output:");
    expect(result).toContain('"total"');
  });

  it("renders example args as formatted JSON", () => {
    const action: PluginActionDefinition = {
      action: "search",
      exampleArgs: { query: "hello", limit: 5 }
    };
    const result = renderPluginActionDetail(action);
    expect(result).toContain("Example:");
    expect(result).toContain('"query": "hello"');
    expect(result).toContain('"limit": 5');
  });

  it("shows Input: (none) when inputSchema has no properties", () => {
    const action: PluginActionDefinition = {
      action: "ping",
      inputSchema: { type: "object" }
    };
    const result = renderPluginActionDetail(action);
    expect(result).toContain("Input: (none)");
  });
});

describe("renderPluginDetail", () => {
  it("renders actions with name, title, and description only", () => {
    const plugin: PluginView = {
      pluginId: "my-plugin",
      actions: [
        { action: "hello", title: "Hello", description: "Say hello", inputSchema: { type: "object" }, outputSchema: {}, exampleArgs: {} },
        { action: "search", description: "Search things" }
      ]
    };
    const result = renderPluginDetail(plugin);
    expect(result).toContain("hello (Hello) - Say hello");
    expect(result).toContain("search - Search things");
    expect(result).not.toContain("inputSchema");
    expect(result).not.toContain("outputSchema");
  });
});
