import { beforeEach, describe, expect, it, vi } from "vitest";

import { registerPlaybookTools } from "../../../src/mcp/tools/playbooks.js";
import { defaultPolicy } from "../../../src/mcp/types.js";
import type { ActionDockClient } from "../../../src/lib/client.js";
import type { Playbook } from "../../../src/lib/types.js";

// Capture every call to registerActionDockTool so we can assert on the options
// (name, risk, schema) and invoke the handler to verify client delegation.
const registrations: Array<{
  name: string;
  description: string;
  risk: string;
  inputSchema: Record<string, unknown>;
  handler: (args: Record<string, unknown>) => Promise<unknown>;
}> = [];

vi.mock("../../../src/mcp/core/register-tool.js", () => ({
  registerActionDockTool: (
    _server: unknown,
    options: {
      name: string;
      description: string;
      risk: string;
      inputSchema: Record<string, unknown>;
      handler: (args: Record<string, unknown>) => Promise<unknown>;
    }
  ) => {
    registrations.push(options);
  }
}));

function buildClient(overrides: Partial<ActionDockClient> = {}): ActionDockClient {
  const playbooks = {
    list: vi.fn(),
    get: vi.fn()
  };
  return { playbooks, ...overrides } as unknown as ActionDockClient;
}

describe("registerPlaybookTools", () => {
  // Each test re-invokes registerPlaybookTools, so reset the captured
  // registrations to avoid handlers from earlier tests leaking in.
  beforeEach(() => {
    registrations.length = 0;
  });

  it("registers exactly two read tools", () => {
    const client = buildClient();
    registerPlaybookTools({} as never, { client, policy: defaultPolicy() });

    const names = registrations.map((r) => r.name);
    expect(names).toEqual(["actiondock_playbook_list", "actiondock_playbook_get"]);
    expect(registrations.every((r) => r.risk === "read")).toBe(true);
    expect(registrations.every((r) => r.description.length > 0)).toBe(true);
  });

  describe("actiondock_playbook_list", () => {
    it("forwards all provided filters to client.playbooks.list", async () => {
      const client = buildClient();
      registerPlaybookTools({} as never, { client, policy: defaultPolicy() });

      const list = registrations.find((r) => r.name === "actiondock_playbook_list")!;
      await list.handler({
        repositoryId: "repo-1",
        tag: "ops",
        enabled: true,
        managed: false
      });

      expect(client.playbooks.list).toHaveBeenCalledWith({
        repositoryId: "repo-1",
        tag: "ops",
        enabled: true,
        managed: false
      });
    });

    it("passes through undefined filters untouched (no key dropping at this layer)", async () => {
      const client = buildClient();
      registerPlaybookTools({} as never, { client, policy: defaultPolicy() });

      const list = registrations.find((r) => r.name === "actiondock_playbook_list")!;
      await list.handler({});

      // All filters are optional; absent values arrive as undefined keys.
      expect(client.playbooks.list).toHaveBeenCalledWith({
        repositoryId: undefined,
        tag: undefined,
        enabled: undefined,
        managed: undefined
      });
    });

    it("returns the resolved playbooks", async () => {
      const playbooks: Playbook[] = [
        { id: "pb-1", name: "Deploy", guideMarkdown: "# deploy" }
      ];
      const client = buildClient();
      const list = vi.fn().mockResolvedValue(playbooks);
      (client as unknown as { playbooks: { list: typeof list } }).playbooks.list = list;

      registerPlaybookTools({} as never, { client, policy: defaultPolicy() });
      const reg = registrations.find((r) => r.name === "actiondock_playbook_list")!;
      const result = await reg.handler({});
      expect(result).toEqual(playbooks);
    });

    it("declares the optional filter schema", () => {
      const client = buildClient();
      registerPlaybookTools({} as never, { client, policy: defaultPolicy() });

      const list = registrations.find((r) => r.name === "actiondock_playbook_list")!;
      const shape = list.inputSchema as Record<string, { isOptional: () => boolean }>;
      expect(Object.keys(shape).sort()).toEqual(["enabled", "managed", "repositoryId", "tag"]);
      for (const key of Object.keys(shape)) {
        expect(shape[key].isOptional()).toBe(true);
      }
    });
  });

  describe("actiondock_playbook_get", () => {
    it("forwards the playbook id to client.playbooks.get", async () => {
      const client = buildClient();
      registerPlaybookTools({} as never, { client, policy: defaultPolicy() });

      const get = registrations.find((r) => r.name === "actiondock_playbook_get")!;
      await get.handler({ playbookId: "pb-42" });

      expect(client.playbooks.get).toHaveBeenCalledWith("pb-42");
    });

    it("returns the resolved playbook", async () => {
      const playbook: Playbook = { id: "pb-9", name: "Rollback", guideMarkdown: "# rollback" };
      const client = buildClient();
      const get = vi.fn().mockResolvedValue(playbook);
      (client as unknown as { playbooks: { get: typeof get } }).playbooks.get = get;

      registerPlaybookTools({} as never, { client, policy: defaultPolicy() });
      const reg = registrations.find((r) => r.name === "actiondock_playbook_get")!;
      const result = await reg.handler({ playbookId: "pb-9" });
      expect(result).toEqual(playbook);
    });

    it("declares playbookId as a required string", () => {
      const client = buildClient();
      registerPlaybookTools({} as never, { client, policy: defaultPolicy() });

      const get = registrations.find((r) => r.name === "actiondock_playbook_get")!;
      const shape = get.inputSchema as Record<string, unknown>;
      expect(Object.keys(shape)).toEqual(["playbookId"]);
    });
  });
});
