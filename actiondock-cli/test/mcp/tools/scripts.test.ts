import { describe, expect, it, vi } from "vitest";

import type { ActionDockClient } from "../../../src/lib/client.js";
import type {
  ExecutionResponse,
  PublishedScriptRevision,
  ScriptDefinition
} from "../../../src/lib/types.js";
import { defaultPolicy } from "../../../src/mcp/types.js";
import { registerScriptTools } from "../../../src/mcp/tools/scripts.js";

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
    ...overrides
  };
}

function mockPublishedScript(overrides: Partial<PublishedScriptRevision> = {}): PublishedScriptRevision {
  return {
    scriptId: "demo",
    revisionId: "rev-1",
    version: 1,
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
    ...overrides
  };
}

function mockClient(scripts: {
  list?: ScriptDefinition[];
  getScript?: ScriptDefinition;
  executeResult?: ExecutionResponse;
}): ActionDockClient {
  const get = vi.fn(async (scriptId: string, draft: boolean) => {
    if (scripts.getScript) {
      return scripts.getScript;
    }
    return mockScript({ id: scriptId });
  });
  const execute = vi.fn(async () => scripts.executeResult ?? { id: "exec-1", status: "SUCCESS" });
  return {
    scripts: {
      list: vi.fn(async () => scripts.list ?? [mockScript()]),
      get,
      execute
    }
  } as unknown as ActionDockClient;
}

/**
 * The {@link registerActionDockTool} wrapper wraps the business handler output in
 * an MCP {@code CallToolResult} ({@code { content: [{ type: "text", text }] }}),
 * where {@code text} is a JSON envelope {@code { ok, data }} (or {@code { ok,
 * error }} on failure). This helper invokes the captured handler and unwraps the
 * {@code data} payload for assertions.
 */
async function runTool(server: CapturingServer & { tools: RegisteredTool[] }, name: string, args: Record<string, unknown>): Promise<unknown> {
  const tool = server.tools.find((tool) => tool.name === name);
  if (!tool) {
    throw new Error(`tool not registered: ${name}`);
  }
  const result = await tool.handler(args) as { content: [{ type: string; text: string }] };
  const parsed = JSON.parse(result.content[0].text) as { ok: boolean; data: unknown };
  return parsed.data;
}

describe("registerScriptTools", () => {
  describe("registration", () => {
    it("registers all four tools when execute is enabled", () => {
      const server = capturingServer();
      registerScriptTools(server, { client: mockClient({}), policy: defaultPolicy() });

      const names = server.tools.map((tool) => tool.name);
      expect(names).toEqual([
        "actiondock_script_list",
        "actiondock_script_get",
        "actiondock_script_schema",
        "actiondock_script_run"
      ]);
    });

    it("omits actiondock_script_run when execute is disabled", () => {
      const server = capturingServer();
      const policy = { ...defaultPolicy(), enableExecuteTools: false };
      registerScriptTools(server, { client: mockClient({}), policy });

      const names = server.tools.map((tool) => tool.name);
      expect(names).toEqual([
        "actiondock_script_list",
        "actiondock_script_get",
        "actiondock_script_schema"
      ]);
    });

    it("always registers the read tools regardless of execute policy", () => {
      const server = capturingServer();
      const policy = { ...defaultPolicy(), enableExecuteTools: false };
      registerScriptTools(server, { client: mockClient({}), policy });

      expect(server.tools.find((tool) => tool.name === "actiondock_script_list")).toBeDefined();
      expect(server.tools.find((tool) => tool.name === "actiondock_script_get")).toBeDefined();
      expect(server.tools.find((tool) => tool.name === "actiondock_script_schema")).toBeDefined();
    });

    it("uses Zod raw shapes as input schemas", () => {
      const server = capturingServer();
      registerScriptTools(server, { client: mockClient({}), policy: defaultPolicy() });

      const run = server.tools.find((tool) => tool.name === "actiondock_script_run");
      expect(run).toBeDefined();
      expect(Object.keys(run!.inputSchema).sort()).toEqual(
        ["draft", "input", "mode", "responseView", "scriptId"].sort()
      );

      const list = server.tools.find((tool) => tool.name === "actiondock_script_list");
      expect(list!.inputSchema).toEqual({});
    });

    it("attaches descriptions to every tool", () => {
      const server = capturingServer();
      registerScriptTools(server, { client: mockClient({}), policy: defaultPolicy() });

      for (const tool of server.tools) {
        expect(typeof tool.description).toBe("string");
        expect(tool.description.length).toBeGreaterThan(0);
      }
    });
  });

  describe("actiondock_script_list", () => {
    it("calls client.scripts.list()", async () => {
      const scripts = [mockScript({ id: "a" }), mockScript({ id: "b" })];
      const client = mockClient({ list: scripts });
      const server = capturingServer();
      registerScriptTools(server, { client, policy: defaultPolicy() });

      const result = await runTool(server, "actiondock_script_list", {});
      expect(result).toEqual(scripts);
      expect(client.scripts.list).toHaveBeenCalledOnce();
    });
  });

  describe("actiondock_script_get", () => {
    it("fetches the published snapshot by default", async () => {
      const client = mockClient({ getScript: mockScript({ id: "demo" }) });
      const server = capturingServer();
      registerScriptTools(server, { client, policy: defaultPolicy() });

      const result = await runTool(server, "actiondock_script_get", { scriptId: "demo" });
      expect(result).toMatchObject({ id: "demo" });
      expect(client.scripts.get).toHaveBeenCalledWith("demo", false);
    });

    it("fetches the draft when draft=true", async () => {
      const client = mockClient({ getScript: mockScript({ id: "demo" }) });
      const server = capturingServer();
      registerScriptTools(server, { client, policy: defaultPolicy() });

      await runTool(server, "actiondock_script_get", { scriptId: "demo", draft: true });
      expect(client.scripts.get).toHaveBeenCalledWith("demo", true);
    });

    it("defaults draft to false when omitted", async () => {
      const client = mockClient({ getScript: mockScript() });
      const server = capturingServer();
      registerScriptTools(server, { client, policy: defaultPolicy() });

      await runTool(server, "actiondock_script_get", { scriptId: "x", draft: undefined });
      expect(client.scripts.get).toHaveBeenCalledWith("x", false);
    });
  });

  describe("actiondock_script_schema", () => {
    it("returns published schema fields by default", async () => {
      const published = mockPublishedScript({
        inputSchema: {
          type: "object",
          required: ["name"],
          properties: { name: { type: "string", description: "Who to greet" } }
        }
      });
      const client = mockClient({
        getScript: {
          id: "demo",
          name: "Demo",
          type: "GROOVY",
          description: "A demo script",
          inputSchema: { type: "object", properties: { draftOnly: { type: "string" } } },
          published
        }
      });
      const server = capturingServer();
      registerScriptTools(server, { client, policy: defaultPolicy() });

      const result = (await runTool(server, "actiondock_script_schema", { scriptId: "demo" })) as {
        script: { id: string; name?: string };
        target: string;
        fields: { name: string }[];
      };

      expect(result.target).toBe("published");
      expect(result.script).toMatchObject({ id: "demo", name: "Demo" });
      expect(result.fields.map((field) => field.name)).toEqual(["name"]);
    });

    it("returns draft schema fields when draft=true", async () => {
      const client = mockClient({
        getScript: {
          id: "demo",
          name: "Demo",
          type: "GROOVY",
          description: "A demo script",
          inputSchema: {
            type: "object",
            required: ["draftOnly"],
            properties: { draftOnly: { type: "string", description: "draft field" } }
          },
          published: mockPublishedScript({
            inputSchema: { type: "object", properties: { name: { type: "string" } } }
          })
        }
      });
      const server = capturingServer();
      registerScriptTools(server, { client, policy: defaultPolicy() });

      const result = (await runTool(server, "actiondock_script_schema", {
        scriptId: "demo",
        draft: true
      })) as { target: string; fields: { name: string }[] };

      expect(result.target).toBe("draft");
      expect(result.fields.map((field) => field.name)).toEqual(["draftOnly"]);
    });

    it("falls back to script.inputSchema when no published schema exists", async () => {
      const client = mockClient({
        getScript: {
          id: "demo",
          name: "Demo",
          type: "GROOVY",
          description: "A demo script",
          inputSchema: {
            type: "object",
            required: ["name"],
            properties: { name: { type: "string" } }
          },
          published: undefined
        }
      });
      const server = capturingServer();
      registerScriptTools(server, { client, policy: defaultPolicy() });

      const result = (await runTool(server, "actiondock_script_schema", { scriptId: "demo" })) as {
        fields: { name: string }[];
      };

      expect(result.fields.map((field) => field.name)).toEqual(["name"]);
    });

    it("includes the script identity and target in the result", async () => {
      const client = mockClient({
        getScript: {
          id: "demo",
          name: "Demo",
          type: "GROOVY",
          description: "desc",
          inputSchema: { type: "object", properties: {} }
        }
      });
      const server = capturingServer();
      registerScriptTools(server, { client, policy: defaultPolicy() });

      const result = (await runTool(server, "actiondock_script_schema", { scriptId: "demo" })) as {
        script: { id: string; name?: string; type?: string; description?: string };
      };

      expect(result.script).toEqual({ id: "demo", name: "Demo", type: "GROOVY", description: "desc" });
    });
  });

  describe("actiondock_script_run", () => {
    it("executes with default SYNC + RESULT mode on published snapshot", async () => {
      const client = mockClient({ executeResult: { id: "exec-1", status: "SUCCESS" } });
      const server = capturingServer();
      registerScriptTools(server, { client, policy: defaultPolicy() });

      const result = await runTool(server, "actiondock_script_run", {
        scriptId: "demo",
        input: { name: "world" }
      });

      expect(result).toMatchObject({ id: "exec-1", status: "SUCCESS" });
      expect(client.scripts.execute).toHaveBeenCalledWith(
        { scriptId: "demo", input: { name: "world" }, mode: "SYNC", responseView: "RESULT" },
        false
      );
    });

    it("passes through mode, responseView and draft when provided", async () => {
      const client = mockClient({});
      const server = capturingServer();
      registerScriptTools(server, { client, policy: defaultPolicy() });

      await runTool(server, "actiondock_script_run", {
        scriptId: "demo",
        input: { name: "world" },
        draft: true,
        mode: "ASYNC",
        responseView: "DEBUG"
      });

      expect(client.scripts.execute).toHaveBeenCalledWith(
        { scriptId: "demo", input: { name: "world" }, mode: "ASYNC", responseView: "DEBUG" },
        true
      );
    });

    it("defaults input to an empty object when omitted", async () => {
      const client = mockClient({});
      const server = capturingServer();
      registerScriptTools(server, { client, policy: defaultPolicy() });

      await runTool(server, "actiondock_script_run", { scriptId: "demo" });

      expect(client.scripts.execute).toHaveBeenCalledWith(
        { scriptId: "demo", input: {}, mode: "SYNC", responseView: "RESULT" },
        false
      );
    });
  });
});
