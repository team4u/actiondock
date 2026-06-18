import { describe, expect, it, vi } from "vitest";

import { registerWebhookTools } from "../../../src/mcp/tools/webhooks.js";
import { defaultPolicy } from "../../../src/mcp/types.js";
import type { ActionDockClient } from "../../../src/lib/client.js";
import type {
  WebhookDefinition,
  WebhookInvokeResult
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

function fakeClient(
  list: WebhookDefinition[],
  webhook: WebhookDefinition,
  invokeResult: WebhookInvokeResult
): ActionDockClient {
  return {
    webhooks: {
      list: vi.fn().mockResolvedValue(list),
      get: vi.fn().mockResolvedValue(webhook),
      invoke: vi.fn().mockResolvedValue(invokeResult)
    }
  } as unknown as ActionDockClient;
}

describe("registerWebhookTools", () => {
  const webhookList: WebhookDefinition[] = [
    { id: "wh1", name: "GitHub Push", enabled: true },
    { id: "wh2", name: "Slack Command", enabled: false }
  ];
  const singleWebhook: WebhookDefinition = {
    id: "wh1",
    name: "GitHub Push",
    enabled: true
  };
  const invokeResult: WebhookInvokeResult = {
    status: 200,
    headers: { "content-type": ["application/json"] },
    body: { ok: true }
  };

  function registerAll() {
    const server = fakeServer();
    const client = fakeClient(webhookList, singleWebhook, invokeResult);
    registerWebhookTools(server, { client, policy: defaultPolicy() });
    return { server, client };
  }

  it("registers all three webhook tools", () => {
    const { server } = registerAll();
    const names = server.tools.map((t) => t.name);
    expect(names).toEqual([
      "actiondock_webhook_list",
      "actiondock_webhook_get",
      "actiondock_webhook_invoke"
    ]);
  });

  describe("actiondock_webhook_list", () => {
    it("is a read-risk tool with empty input schema", () => {
      const { server } = registerAll();
      const tool = server.tools.find((t) => t.name === "actiondock_webhook_list");
      expect(tool).toBeDefined();
      expect(tool!.inputSchema).toEqual({});
      expect(tool!.description).toContain("webhook");
    });

    it("handler delegates to client.webhooks.list()", async () => {
      const { server, client } = registerAll();
      const tool = server.tools.find((t) => t.name === "actiondock_webhook_list")!;
      const result = await tool.handler({});

      expect(client.webhooks.list).toHaveBeenCalledTimes(1);
      expect(client.webhooks.list).toHaveBeenCalledWith();

      const parsed = JSON.parse((result as { content: [{ text: string }] }).content[0].text);
      expect(parsed).toEqual({ ok: true, data: webhookList });
    });

    it("is registered even with read-only policy (read tools always enabled)", () => {
      const policy = {
        ...defaultPolicy(),
        enableExecuteTools: false,
        enableWriteTools: false,
        enableAdminTools: false,
        enableDynamicTools: false
      };
      const server = fakeServer();
      const client = fakeClient(webhookList, singleWebhook, invokeResult);
      registerWebhookTools(server, { client, policy });

      expect(
        server.tools.some((t) => t.name === "actiondock_webhook_list")
      ).toBe(true);
    });
  });

  describe("actiondock_webhook_get", () => {
    it("is a read-risk tool requiring webhookId", () => {
      const { server } = registerAll();
      const tool = server.tools.find((t) => t.name === "actiondock_webhook_get")!;
      expect(tool.inputSchema).toHaveProperty("webhookId");
      expect(tool.description).toContain("webhook");
    });

    it("handler delegates to client.webhooks.get(webhookId)", async () => {
      const { server, client } = registerAll();
      const tool = server.tools.find((t) => t.name === "actiondock_webhook_get")!;
      const result = await tool.handler({ webhookId: "wh1" });

      expect(client.webhooks.get).toHaveBeenCalledTimes(1);
      expect(client.webhooks.get).toHaveBeenCalledWith("wh1");

      const parsed = JSON.parse((result as { content: [{ text: string }] }).content[0].text);
      expect(parsed).toEqual({ ok: true, data: singleWebhook });
    });

    it("is registered even with read-only policy (read tools always enabled)", () => {
      const policy = {
        ...defaultPolicy(),
        enableExecuteTools: false,
        enableWriteTools: false,
        enableAdminTools: false,
        enableDynamicTools: false
      };
      const server = fakeServer();
      const client = fakeClient(webhookList, singleWebhook, invokeResult);
      registerWebhookTools(server, { client, policy });

      expect(server.tools.some((t) => t.name === "actiondock_webhook_get")).toBe(true);
    });
  });

  describe("actiondock_webhook_invoke", () => {
    it("is an execute-risk tool requiring webhookId and payload", () => {
      const { server } = registerAll();
      const tool = server.tools.find((t) => t.name === "actiondock_webhook_invoke")!;
      expect(tool.inputSchema).toHaveProperty("webhookId");
      expect(tool.inputSchema).toHaveProperty("payload");
      expect(tool.description.toLowerCase()).toContain("invoke");
    });

    it("handler delegates to client.webhooks.invoke(webhookId, payload)", async () => {
      const { server, client } = registerAll();
      const tool = server.tools.find((t) => t.name === "actiondock_webhook_invoke")!;
      const payload = { method: "POST", headers: { "x-event": ["push"] }, rawBody: '{"a":1}' };
      const result = await tool.handler({ webhookId: "wh1", payload });

      expect(client.webhooks.invoke).toHaveBeenCalledTimes(1);
      expect(client.webhooks.invoke).toHaveBeenCalledWith("wh1", payload);

      const parsed = JSON.parse((result as { content: [{ text: string }] }).content[0].text);
      expect(parsed).toEqual({ ok: true, data: invokeResult });
    });

    it("handler defaults payload to {} when omitted", async () => {
      const { server, client } = registerAll();
      const tool = server.tools.find((t) => t.name === "actiondock_webhook_invoke")!;
      await tool.handler({ webhookId: "wh1" });

      expect(client.webhooks.invoke).toHaveBeenCalledWith("wh1", {});
    });

    it("preserves status/headers/body from WebhookInvokeResult unchanged", async () => {
      const { server } = registerAll();
      const tool = server.tools.find((t) => t.name === "actiondock_webhook_invoke")!;
      const result = await tool.handler({ webhookId: "wh1", payload: {} });

      const parsed = JSON.parse((result as { content: [{ text: string }] }).content[0].text);
      expect(parsed.data).toEqual({
        status: 200,
        headers: { "content-type": ["application/json"] },
        body: { ok: true }
      });
    });

    it("is NOT registered when execute tools are disabled", () => {
      const policy = { ...defaultPolicy(), enableExecuteTools: false };
      const server = fakeServer();
      const client = fakeClient(webhookList, singleWebhook, invokeResult);
      registerWebhookTools(server, { client, policy });

      const names = server.tools.map((t) => t.name);
      expect(names).toEqual(["actiondock_webhook_list", "actiondock_webhook_get"]);
    });
  });
});
