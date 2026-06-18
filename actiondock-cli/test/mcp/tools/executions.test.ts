import { describe, expect, it, vi } from "vitest";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { registerExecutionTools } from "../../../src/mcp/tools/executions.js";
import { defaultPolicy } from "../../../src/mcp/types.js";
import type { ActionDockClient } from "../../../src/lib/client.js";

/**
 * Minimal ActionDockClient double with only the {@code executions} facet that
 * these tools touch. Cast through {@code unknown} because the real constructor
 * wires up many facets we do not need here.
 */
function mockClient(executions: object): ActionDockClient {
  return { executions } as unknown as ActionDockClient;
}

describe("registerExecutionTools", () => {
  it("registers both read tools", () => {
    const server = new McpServer({ name: "test", version: "0.0.0" });
    const registerTool = vi.spyOn(server, "registerTool");
    const client = mockClient({ list: vi.fn(), get: vi.fn() });

    registerExecutionTools(server, { client, policy: defaultPolicy() });

    const names = registerTool.mock.calls.map((call) => call[0]);
    expect(names).toEqual(["actiondock_execution_list", "actiondock_execution_get"]);

    for (const call of registerTool.mock.calls) {
      // Both tools are read-only.
      const config = call[1] as { description: string };
      expect(typeof config.description).toBe("string");
      expect(config.description.length).toBeGreaterThan(0);
    }
  });

  it("calls executions.list with provided filters", async () => {
    const server = new McpServer({ name: "test", version: "0.0.0" });
    const registerTool = vi.spyOn(server, "registerTool");
    const list = vi.fn().mockResolvedValue([{ id: "e1" }]);
    const client = mockClient({ list, get: vi.fn() });

    registerExecutionTools(server, { client, policy: defaultPolicy() });

    // First registered tool's handler is the list handler.
    const listHandler = registerTool.mock.calls[0]![2] as (
      args: Record<string, unknown>
    ) => Promise<unknown>;
    await listHandler({ scriptId: "s1", scheduleId: "sch1" });

    expect(list).toHaveBeenCalledWith({ scriptId: "s1", scheduleId: "sch1" });
  });

  it("calls executions.list with undefined filters when none given", async () => {
    const server = new McpServer({ name: "test", version: "0.0.0" });
    const registerTool = vi.spyOn(server, "registerTool");
    const list = vi.fn().mockResolvedValue([]);
    const client = mockClient({ list, get: vi.fn() });

    registerExecutionTools(server, { client, policy: defaultPolicy() });

    const listHandler = registerTool.mock.calls[0]![2] as (
      args: Record<string, unknown>
    ) => Promise<unknown>;
    await listHandler({});

    expect(list).toHaveBeenCalledWith({ scriptId: undefined, scheduleId: undefined });
  });

  it("calls executions.get with the executionId", async () => {
    const server = new McpServer({ name: "test", version: "0.0.0" });
    const registerTool = vi.spyOn(server, "registerTool");
    const get = vi.fn().mockResolvedValue({ id: "e9" });
    const client = mockClient({ list: vi.fn(), get });

    registerExecutionTools(server, { client, policy: defaultPolicy() });

    // Second registered tool's handler is the get handler.
    const getHandler = registerTool.mock.calls[1]![2] as (
      args: Record<string, unknown>
    ) => Promise<unknown>;
    await getHandler({ executionId: "e9" });

    expect(get).toHaveBeenCalledWith("e9");
  });
});
