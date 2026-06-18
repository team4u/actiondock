import { describe, expect, it, vi } from "vitest";
import * as z from "zod";

import type { ActionDockClient } from "../../../src/lib/client.js";
import type { ExecutionResponse, ScriptDefinition } from "../../../src/lib/types.js";
import { defaultPolicy } from "../../../src/mcp/types.js";
import {
  dynamicDescription,
  extractInput,
  registerDynamicScriptTools,
  truncate
} from "../../../src/mcp/tools/dynamic-scripts.js";

interface RegisteredTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  handler: (args: Record<string, unknown>) => Promise<unknown>;
}

interface CapturingServer {
  registerTool(name: string, config: { description: string; inputSchema: unknown }, handler: unknown): void;
}

function capturingServer(): CapturingServer & { tools: RegisteredTool[] } {
  const tools: RegisteredTool[] = [];
  return {
    tools,
    registerTool(name, config, handler) {
      // Mimic the real McpServer, which rejects duplicate tool names.
      if (tools.some((tool) => tool.name === name)) {
        throw new Error(`tool already registered: ${name}`);
      }
      tools.push({
        name,
        description: config.description,
        inputSchema: config.inputSchema as Record<string, unknown>,
        handler: handler as RegisteredTool["handler"]
      });
    }
  };
}

function mockScript(overrides: Partial<ScriptDefinition> = {}): ScriptDefinition {
  return {
    id: "demo",
    name: "Demo",
    type: "GROOVY",
    description: "A demo script",
    inputSchema: {
      type: "object",
      required: ["name"],
      properties: {
        name: { type: "string", title: "Name", description: "Who to greet" }
      }
    },
    publication: { published: true, dirty: false },
    ...overrides
  };
}

function mockClient(options: {
  list?: ScriptDefinition[];
  listThrows?: Error;
  executeResult?: ExecutionResponse;
} = {}): ActionDockClient {
  const list = vi.fn(async () => {
    if (options.listThrows) {
      throw options.listThrows;
    }
    return options.list ?? [mockScript()];
  });
  const execute = vi.fn(async () => options.executeResult ?? { id: "exec-1", status: "SUCCESS" });
  return {
    scripts: { list, execute }
  } as unknown as ActionDockClient;
}

async function runTool(server: CapturingServer & { tools: RegisteredTool[] }, name: string, args: Record<string, unknown>): Promise<unknown> {
  const tool = server.tools.find((entry) => entry.name === name);
  if (!tool) {
    throw new Error(`tool not registered: ${name}`);
  }
  const result = await tool.handler(args) as { content: [{ type: string; text: string }] };
  const parsed = JSON.parse(result.content[0].text) as { ok: boolean; data: unknown };
  return parsed.data;
}

describe("registerDynamicScriptTools", () => {
  describe("gating", () => {
    it("registers nothing when enableDynamicTools is false", async () => {
      const server = capturingServer();
      const client = mockClient({ list: [mockScript()] });
      await registerDynamicScriptTools(server, {
        client,
        policy: { ...defaultPolicy(), enableDynamicTools: false }
      });

      expect(server.tools).toHaveLength(0);
      expect(client.scripts.list).not.toHaveBeenCalled();
    });

    it("does not call scripts.list when dynamic tools are disabled", async () => {
      const server = capturingServer();
      const client = mockClient({ list: [mockScript()] });
      await registerDynamicScriptTools(server, {
        client,
        policy: { ...defaultPolicy(), enableDynamicTools: false }
      });

      expect(client.scripts.list).not.toHaveBeenCalled();
    });
  });

  describe("filtering", () => {
    it("skips unpublished scripts", async () => {
      const unpublished = mockScript({
        id: "draft-only",
        publication: { published: false, dirty: true },
        published: null
      });
      const published = mockScript({ id: "live" });
      const server = capturingServer();
      await registerDynamicScriptTools(server, {
        client: mockClient({ list: [unpublished, published] }),
        policy: defaultPolicy()
      });

      const names = server.tools.map((tool) => tool.name);
      expect(names).toEqual(["actiondock_script__live"]);
    });

    it("treats a present published revision as published even without publication flag", async () => {
      const script = mockScript({
        id: "rev-only",
        publication: undefined,
        published: { scriptId: "rev-only", revisionId: "r1", version: 1 } as ScriptDefinition["published"]
      });
      const server = capturingServer();
      await registerDynamicScriptTools(server, {
        client: mockClient({ list: [script] }),
        policy: defaultPolicy()
      });

      expect(server.tools.map((tool) => tool.name)).toEqual(["actiondock_script__rev_only"]);
    });

    it("honors deniedScripts", async () => {
      const server = capturingServer();
      await registerDynamicScriptTools(server, {
        client: mockClient({ list: [mockScript({ id: "a" }), mockScript({ id: "b" })] }),
        policy: { ...defaultPolicy(), deniedScripts: ["a"] }
      });

      expect(server.tools.map((tool) => tool.name)).toEqual(["actiondock_script__b"]);
    });

    it("honors allowedScripts as an allowlist", async () => {
      const server = capturingServer();
      await registerDynamicScriptTools(server, {
        client: mockClient({ list: [mockScript({ id: "a" }), mockScript({ id: "b" }), mockScript({ id: "c" })] }),
        policy: { ...defaultPolicy(), allowedScripts: ["b"] }
      });

      expect(server.tools.map((tool) => tool.name)).toEqual(["actiondock_script__b"]);
    });
  });

  describe("naming and description", () => {
    it("normalizes the script id into a tool-safe name", async () => {
      const server = capturingServer();
      await registerDynamicScriptTools(server, {
        client: mockClient({ list: [mockScript({ id: "My-Cool Script!" })] }),
        policy: defaultPolicy()
      });

      expect(server.tools[0].name).toBe("actiondock_script__my_cool_script");
    });

    it("builds the description from id, name and description", async () => {
      const server = capturingServer();
      await registerDynamicScriptTools(server, {
        client: mockClient({ list: [mockScript({ id: "demo", name: "Demo", description: "A demo script" })] }),
        policy: defaultPolicy()
      });

      expect(server.tools[0].description).toBe("Execute published ActionDock script 'demo' (Demo): A demo script");
    });

    it("omits the name part when name is absent", async () => {
      const server = capturingServer();
      await registerDynamicScriptTools(server, {
        client: mockClient({ list: [mockScript({ id: "demo", name: undefined, description: "d" })] }),
        policy: defaultPolicy()
      });

      expect(server.tools[0].description).toBe("Execute published ActionDock script 'demo': d");
    });

    it("omits the description part when description is absent", async () => {
      const server = capturingServer();
      await registerDynamicScriptTools(server, {
        client: mockClient({ list: [mockScript({ id: "demo", name: "Demo", description: undefined })] }),
        policy: defaultPolicy()
      });

      expect(server.tools[0].description).toBe("Execute published ActionDock script 'demo' (Demo)");
    });
  });

  describe("input schema conversion", () => {
    it("uses published revision schema when present", async () => {
      const script = mockScript({
        id: "demo",
        inputSchema: { type: "object", properties: { draftOnly: { type: "string" } } },
        published: {
          scriptId: "demo",
          revisionId: "r1",
          version: 1,
          inputSchema: {
            type: "object",
            required: ["name"],
            properties: { name: { type: "string" } }
          }
        } as ScriptDefinition["published"]
      });
      const server = capturingServer();
      await registerDynamicScriptTools(server, {
        client: mockClient({ list: [script] }),
        policy: defaultPolicy()
      });

      expect(Object.keys(server.tools[0].inputSchema)).toEqual(["name"]);
    });

    it("falls back to draft inputSchema when no published schema exists", async () => {
      const script = mockScript({
        id: "demo",
        inputSchema: {
          type: "object",
          required: ["name"],
          properties: { name: { type: "string" } }
        },
        published: { scriptId: "demo", revisionId: "r1", version: 1 } as ScriptDefinition["published"]
      });
      const server = capturingServer();
      await registerDynamicScriptTools(server, {
        client: mockClient({ list: [script] }),
        policy: defaultPolicy()
      });

      expect(Object.keys(server.tools[0].inputSchema)).toEqual(["name"]);
    });

    it("falls back to free-form input when schema has no properties", async () => {
      const script = mockScript({
        id: "demo",
        inputSchema: { type: "object" },
        published: { scriptId: "demo", revisionId: "r1", version: 1 } as ScriptDefinition["published"]
      });
      const server = capturingServer();
      await registerDynamicScriptTools(server, {
        client: mockClient({ list: [script] }),
        policy: defaultPolicy()
      });

      expect(Object.keys(server.tools[0].inputSchema)).toEqual(["input"]);
      const inputSchema = server.tools[0].inputSchema.input as z.ZodTypeAny;
      expect(inputSchema).toBeInstanceOf(z.ZodRecord);
    });

    it("falls back to free-form input when schema is absent", async () => {
      const script = mockScript({
        id: "demo",
        inputSchema: undefined,
        published: { scriptId: "demo", revisionId: "r1", version: 1 } as ScriptDefinition["published"]
      });
      const server = capturingServer();
      await registerDynamicScriptTools(server, {
        client: mockClient({ list: [script] }),
        policy: defaultPolicy()
      });

      expect(Object.keys(server.tools[0].inputSchema)).toEqual(["input"]);
    });

    it("falls back to free-form input when schema is not an object type", async () => {
      const script = mockScript({
        id: "demo",
        inputSchema: { type: "string" },
        published: { scriptId: "demo", revisionId: "r1", version: 1 } as ScriptDefinition["published"]
      });
      const server = capturingServer();
      await registerDynamicScriptTools(server, {
        client: mockClient({ list: [script] }),
        policy: defaultPolicy()
      });

      expect(Object.keys(server.tools[0].inputSchema)).toEqual(["input"]);
    });
  });

  describe("execution", () => {
    it("executes the published snapshot with SYNC + RESULT", async () => {
      const client = mockClient({ executeResult: { id: "exec-1", status: "SUCCESS" } });
      const server = capturingServer();
      await registerDynamicScriptTools(server, {
        client,
        policy: defaultPolicy()
      });

      const result = await runTool(server, "actiondock_script__demo", { input: { name: "world" } });
      expect(result).toMatchObject({ id: "exec-1", status: "SUCCESS" });
      expect(client.scripts.execute).toHaveBeenCalledWith(
        { scriptId: "demo", input: { name: "world" }, mode: "SYNC", responseView: "RESULT" },
        false
      );
    });

    it("uses an empty object when no input is provided", async () => {
      const client = mockClient({});
      const server = capturingServer();
      await registerDynamicScriptTools(server, { client, policy: defaultPolicy() });

      await runTool(server, "actiondock_script__demo", {});

      expect(client.scripts.execute).toHaveBeenCalledWith(
        { scriptId: "demo", input: {}, mode: "SYNC", responseView: "RESULT" },
        false
      );
    });
  });

  describe("resilience", () => {
    it("returns without registering when scripts.list throws", async () => {
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
      const server = capturingServer();
      await registerDynamicScriptTools(server, {
        client: mockClient({ listThrows: new Error("boom") }),
        policy: defaultPolicy()
      });

      expect(server.tools).toHaveLength(0);
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("failed to list scripts"));
      errorSpy.mockRestore();
    });

    it("continues registering remaining tools when one script's registration throws", async () => {
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
      const good = mockScript({ id: "good" });
      const collidingA = mockScript({ id: "dup" });
      const collidingB = mockScript({ id: "dup" });
      const server = capturingServer();
      await registerDynamicScriptTools(server, {
        client: mockClient({ list: [good, collidingA, collidingB] }),
        policy: defaultPolicy()
      });

      // First "good" and first "dup" register; the second "dup" collides on
      // tool name and is skipped with a logged warning.
      const names = server.tools.map((tool) => tool.name).sort();
      expect(names).toEqual(["actiondock_script__dup", "actiondock_script__good"].sort());
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("failed to register dynamic tool for script 'dup'"));
      errorSpy.mockRestore();
    });
  });
});

describe("dynamicDescription", () => {
  it("includes id, name and description", () => {
    expect(dynamicDescription({ id: "a", name: "B", description: "C" } as ScriptDefinition)).toBe(
      "Execute published ActionDock script 'a' (B): C"
    );
  });

  it("omits name and description when absent", () => {
    expect(dynamicDescription({ id: "a" } as ScriptDefinition)).toBe(
      "Execute published ActionDock script 'a'"
    );
  });
});

describe("truncate", () => {
  it("returns the value unchanged when within the limit", () => {
    expect(truncate("hello", 10)).toBe("hello");
  });

  it("truncates and appends an ellipsis when over the limit", () => {
    expect(truncate("hello world", 6)).toBe("hello…");
  });

  it("handles a limit of 1", () => {
    expect(truncate("abc", 1)).toBe("a");
  });
});

describe("extractInput", () => {
  it("unwraps an args.input object", () => {
    expect(extractInput({ input: { a: 1 } })).toEqual({ a: 1 });
  });

  it("returns the args object when input is not a record", () => {
    expect(extractInput({ a: 1, input: "nope" })).toEqual({ a: 1, input: "nope" });
  });

  it("returns the args object when no input key is present", () => {
    expect(extractInput({ a: 1 })).toEqual({ a: 1 });
  });

  it("returns an empty object for non-object args", () => {
    expect(extractInput(undefined)).toEqual({});
    expect(extractInput(null)).toEqual({});
    expect(extractInput([1, 2])).toEqual({});
    expect(extractInput("str")).toEqual({});
  });
});
