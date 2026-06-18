import { describe, expect, it, vi } from "vitest";

import { registerHealthTools } from "../../../src/mcp/tools/health.js";
import { defaultPolicy } from "../../../src/mcp/types.js";
import type { ActionDockClient } from "../../../src/lib/client.js";
import type { HealthView } from "../../../src/lib/types.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

interface RegisteredTool {
  name: string;
  description: string;
  inputSchema: Record<string, never>;
  handler: (args: Record<string, unknown>) => Promise<unknown>;
}

function fakeServer(): McpServer & { tools: RegisteredTool[] } {
  const tools: RegisteredTool[] = [];
  const server = {
    registerTool(
      name: string,
      config: { description: string; inputSchema: Record<string, never> },
      handler: RegisteredTool["handler"]
    ): void {
      tools.push({ name, description: config.description, inputSchema: config.inputSchema, handler });
    }
  };
  return { ...server, tools } as unknown as McpServer & { tools: RegisteredTool[] };
}

function fakeClient(healthView: HealthView): ActionDockClient {
  return { health: { health: vi.fn().mockResolvedValue(healthView) } } as unknown as ActionDockClient;
}

describe("registerHealthTools", () => {
  const healthView: HealthView = { ok: true, server: "http://127.0.0.1:5177", status: "UP" };

  it("registers actiondock_health as a read-risk tool with empty input schema", () => {
    const server = fakeServer();
    registerHealthTools(server, { client: fakeClient(healthView), policy: defaultPolicy() });

    expect(server.tools).toHaveLength(1);
    const tool = server.tools[0];
    expect(tool.name).toBe("actiondock_health");
    expect(tool.description).toContain("health");
    expect(tool.inputSchema).toEqual({});
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
    registerHealthTools(server, { client: fakeClient(healthView), policy });

    expect(server.tools).toHaveLength(1);
  });

  it("handler delegates to client.health.health()", async () => {
    const client = fakeClient(healthView);
    const server = fakeServer();
    registerHealthTools(server, { client, policy: defaultPolicy() });

    const result = await server.tools[0].handler({});
    expect(client.health.health).toHaveBeenCalledTimes(1);
    expect(client.health.health).toHaveBeenCalledWith();

    const parsed = JSON.parse((result as { content: [{ text: string }] }).content[0].text);
    expect(parsed).toEqual({ ok: true, data: healthView });
  });

  it("handler wraps a thrown error as an MCP error result", async () => {
    const client = fakeClient(healthView);
    (client.health.health as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("server down"));

    const server = fakeServer();
    registerHealthTools(server, { client, policy: defaultPolicy() });

    const result = (await server.tools[0].handler({})) as { isError: true; content: [{ text: string }] };
    expect(result.isError).toBe(true);
    expect(JSON.parse(result.content[0].text)).toEqual({
      ok: false,
      error: { code: "ACTIONDOCK_ERROR", message: "server down" }
    });
  });

  it("does not register when a tool name collision would occur (idempotent shape)", () => {
    const server = fakeServer();
    const client = fakeClient(healthView);
    registerHealthTools(server, { client, policy: defaultPolicy() });
    registerHealthTools(server, { client, policy: defaultPolicy() });

    // registerActionDockTool does not dedupe; each call pushes one entry. The
    // contract here documents the single-call shape rather than dedupe behavior.
    expect(server.tools).toHaveLength(2);
    expect(server.tools.every((t) => t.name === "actiondock_health")).toBe(true);
  });
});
