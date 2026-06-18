import { describe, expect, it, vi } from "vitest";

import { registerPluginTools } from "../../../src/mcp/tools/plugins.js";
import { defaultPolicy } from "../../../src/mcp/types.js";
import type { ActionDockClient } from "../../../src/lib/client.js";
import type {
  PluginInvokeResponse,
  PluginSummaryView,
  PluginView
} from "../../../src/lib/types.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

interface RegisteredTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  handler: (args: Record<string, unknown>) => Promise<unknown>;
}

function fakeServer(): McpServer & { tools: RegisteredTool[] } {
  const tools: RegisteredTool[] = [];
  const server = {
    registerTool(
      name: string,
      config: { description: string; inputSchema: Record<string, unknown> },
      handler: RegisteredTool["handler"]
    ): void {
      tools.push({ name, description: config.description, inputSchema: config.inputSchema, handler });
    }
  };
  return { ...server, tools } as unknown as McpServer & { tools: RegisteredTool[] };
}

function fakeClient(opts: {
  summaries: PluginSummaryView[];
  view: PluginView;
  invokeResult: PluginInvokeResponse;
}): ActionDockClient {
  return {
    plugins: {
      list: vi.fn().mockResolvedValue(opts.summaries),
      get: vi.fn().mockResolvedValue(opts.view),
      invoke: vi.fn().mockResolvedValue(opts.invokeResult)
    }
  } as unknown as ActionDockClient;
}

function toolByName(server: McpServer & { tools: RegisteredTool[] }, name: string): RegisteredTool {
  const tool = server.tools.find((t) => t.name === name);
  if (!tool) {
    throw new Error(`tool ${name} not registered; got: ${server.tools.map((t) => t.name).join(", ")}`);
  }
  return tool;
}

function parseContent(result: unknown): unknown {
  const r = result as { content: [{ text: string }] };
  return JSON.parse(r.content[0].text);
}

describe("registerPluginTools", () => {
  const summaries: PluginSummaryView[] = [
    { pluginId: "p1", name: "Plugin One", actionCount: 2 }
  ];
  const view: PluginView = {
    pluginId: "p1",
    name: "Plugin One",
    actions: []
  };
  const invokeResult: PluginInvokeResponse = {
    pluginId: "p1",
    action: "doThing",
    result: { ok: true }
  };

  it("registers exactly three plugin tools", () => {
    const server = fakeServer();
    registerPluginTools(server, { client: fakeClient({ summaries, view, invokeResult }), policy: defaultPolicy() });

    expect(server.tools.map((t) => t.name)).toEqual([
      "actiondock_plugin_list",
      "actiondock_plugin_get",
      "actiondock_plugin_invoke"
    ]);
  });

  describe("actiondock_plugin_list", () => {
    it("is a read-risk tool with empty input schema", () => {
      const server = fakeServer();
      registerPluginTools(server, { client: fakeClient({ summaries, view, invokeResult }), policy: defaultPolicy() });

      const tool = toolByName(server, "actiondock_plugin_list");
      expect(tool.inputSchema).toEqual({});
      expect(tool.description).toContain("plugin");
    });

    it("is registered even with read-only policy", () => {
      const policy = {
        ...defaultPolicy(),
        enableExecuteTools: false,
        enableWriteTools: false,
        enableAdminTools: false,
        enableDynamicTools: false
      };
      const server = fakeServer();
      registerPluginTools(server, { client: fakeClient({ summaries, view, invokeResult }), policy });

      expect(toolByName(server, "actiondock_plugin_list")).toBeTruthy();
    });

    it("handler delegates to client.plugins.list() with no args", async () => {
      const client = fakeClient({ summaries, view, invokeResult });
      const server = fakeServer();
      registerPluginTools(server, { client, policy: defaultPolicy() });

      const result = await toolByName(server, "actiondock_plugin_list").handler({});
      expect(client.plugins.list).toHaveBeenCalledTimes(1);
      expect(client.plugins.list).toHaveBeenCalledWith();
      expect(parseContent(result)).toEqual({ ok: true, data: summaries });
    });
  });

  describe("actiondock_plugin_get", () => {
    it("is a read-risk tool with a pluginId string field", () => {
      const server = fakeServer();
      registerPluginTools(server, { client: fakeClient({ summaries, view, invokeResult }), policy: defaultPolicy() });

      const tool = toolByName(server, "actiondock_plugin_get");
      expect(tool.inputSchema).toHaveProperty("pluginId");
      expect(tool.description).toContain("plugin");
    });

    it("handler delegates to client.plugins.get(pluginId)", async () => {
      const client = fakeClient({ summaries, view, invokeResult });
      const server = fakeServer();
      registerPluginTools(server, { client, policy: defaultPolicy() });

      const result = await toolByName(server, "actiondock_plugin_get").handler({ pluginId: "p1" });
      expect(client.plugins.get).toHaveBeenCalledTimes(1);
      expect(client.plugins.get).toHaveBeenCalledWith("p1");
      expect(parseContent(result)).toEqual({ ok: true, data: view });
    });
  });

  describe("actiondock_plugin_invoke", () => {
    it("is an execute-risk tool gated by enableExecuteTools", () => {
      // enabled: registered
      const enabled = fakeServer();
      registerPluginTools(enabled, {
        client: fakeClient({ summaries, view, invokeResult }),
        policy: { ...defaultPolicy(), enableExecuteTools: true }
      });
      expect(enabled.tools.map((t) => t.name)).toContain("actiondock_plugin_invoke");

      // disabled: not registered (list + get still register)
      const disabled = fakeServer();
      registerPluginTools(disabled, {
        client: fakeClient({ summaries, view, invokeResult }),
        policy: { ...defaultPolicy(), enableExecuteTools: false }
      });
      expect(disabled.tools.map((t) => t.name)).toEqual([
        "actiondock_plugin_list",
        "actiondock_plugin_get"
      ]);
    });

    it("declares the full input schema", () => {
      const server = fakeServer();
      registerPluginTools(server, { client: fakeClient({ summaries, view, invokeResult }), policy: defaultPolicy() });

      const schema = toolByName(server, "actiondock_plugin_invoke").inputSchema;
      expect(Object.keys(schema).sort()).toEqual(
        ["action", "args", "configName", "pluginId", "responseView", "scriptInput"].sort()
      );
    });

    it("handler delegates to client.plugins.invoke with defaults for omitted optionals", async () => {
      const client = fakeClient({ summaries, view, invokeResult });
      const server = fakeServer();
      registerPluginTools(server, { client, policy: defaultPolicy() });

      await toolByName(server, "actiondock_plugin_invoke").handler({
        pluginId: "p1",
        action: "doThing"
      });

      expect(client.plugins.invoke).toHaveBeenCalledTimes(1);
      expect(client.plugins.invoke).toHaveBeenCalledWith("p1", "doThing", {
        args: {},
        scriptInput: {},
        responseView: undefined,
        configName: undefined
      });
    });

    it("handler forwards provided args / scriptInput / responseView / configName", async () => {
      const client = fakeClient({ summaries, view, invokeResult });
      const server = fakeServer();
      registerPluginTools(server, { client, policy: defaultPolicy() });

      await toolByName(server, "actiondock_plugin_invoke").handler({
        pluginId: "p1",
        action: "doThing",
        args: { x: 1 },
        scriptInput: { y: 2 },
        responseView: "DEBUG",
        configName: "prod"
      });

      expect(client.plugins.invoke).toHaveBeenCalledWith("p1", "doThing", {
        args: { x: 1 },
        scriptInput: { y: 2 },
        responseView: "DEBUG",
        configName: "prod"
      });
    });

    it("handler wraps the invoke result in the ok envelope", async () => {
      const client = fakeClient({ summaries, view, invokeResult });
      const server = fakeServer();
      registerPluginTools(server, { client, policy: defaultPolicy() });

      const result = await toolByName(server, "actiondock_plugin_invoke").handler({
        pluginId: "p1",
        action: "doThing"
      });
      expect(parseContent(result)).toEqual({ ok: true, data: invokeResult });
    });

    it("handler wraps a thrown error as an MCP error result", async () => {
      const client = fakeClient({ summaries, view, invokeResult });
      (client.plugins.invoke as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("plugin crashed"));

      const server = fakeServer();
      registerPluginTools(server, { client, policy: defaultPolicy() });

      const result = (await toolByName(server, "actiondock_plugin_invoke").handler({
        pluginId: "p1",
        action: "doThing"
      })) as { isError: true; content: [{ text: string }] };

      expect(result.isError).toBe(true);
      expect(JSON.parse(result.content[0].text)).toEqual({
        ok: false,
        error: { code: "ACTIONDOCK_ERROR", message: "plugin crashed" }
      });
    });
  });
});
