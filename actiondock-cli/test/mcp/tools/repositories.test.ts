import { describe, expect, it } from "vitest";

import { registerRepositoryTools, type ToolContext } from "../../../src/mcp/tools/repositories.js";
import { defaultPolicy } from "../../../src/mcp/types.js";
import type { ActionDockClient } from "../../../src/lib/client.js";

/**
 * Minimal stub of {@link McpServer} that records every {@code registerTool}
 * call. The handler is captured (not invoked) so the test can drive it directly
 * with crafted arguments and assert on the underlying client method calls.
 */
interface CapturedTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  handler: (args: Record<string, unknown>) => Promise<unknown>;
}

function captureServer(): { tools: CapturedTool[]; server: { registerTool: unknown } } {
  const tools: CapturedTool[] = [];
  const server = {
    registerTool(
      name: string,
      config: { description: string; inputSchema: Record<string, unknown> },
      handler: (args: Record<string, unknown>) => Promise<unknown>
    ): void {
      tools.push({ name, description: config.description, inputSchema: config.inputSchema, handler });
    }
  };
  return { tools, server };
}

/** Build a fake client whose {@code repositories} methods are spies. */
function fakeClient(calls: { method: string; args: unknown[] }[]): ActionDockClient {
  const repositories = {
    list: (...args: unknown[]): Promise<unknown> => {
      calls.push({ method: "list", args });
      return Promise.resolve([{ id: "repo-1" }]);
    },
    resolveProject: (...args: unknown[]): Promise<unknown> => {
      calls.push({ method: "resolveProject", args });
      return Promise.resolve({ repositoryId: args[0], content: "# ACTIONDOCK" });
    },
    listScripts: (...args: unknown[]): Promise<unknown> => {
      calls.push({ method: "listScripts", args });
      return Promise.resolve([{ scriptId: "s1" }]);
    },
    getScript: (...args: unknown[]): Promise<unknown> => {
      calls.push({ method: "getScript", args });
      return Promise.resolve({ descriptor: { scriptId: args[1] } });
    },
    listKnowledge: (...args: unknown[]): Promise<unknown> => {
      calls.push({ method: "listKnowledge", args });
      return Promise.resolve([{ knowledgeId: "k1" }]);
    },
    getKnowledge: (...args: unknown[]): Promise<unknown> => {
      calls.push({ method: "getKnowledge", args });
      return Promise.resolve({ descriptor: { knowledgeId: args[1] } });
    }
  };
  return { repositories } as unknown as ActionDockClient;
}

function setup() {
  const calls: { method: string; args: unknown[] }[] = [];
  const { tools, server } = captureServer();
  const ctx: ToolContext = { client: fakeClient(calls), policy: defaultPolicy() };
  registerRepositoryTools(server as never, ctx);
  return { tools, calls };
}

const EXPECTED_NAMES = [
  "actiondock_repository_list",
  "actiondock_repository_resolve",
  "actiondock_repository_script_list",
  "actiondock_repository_script_get",
  "actiondock_repository_knowledge_list",
  "actiondock_repository_knowledge_get"
];

describe("registerRepositoryTools", () => {
  it("registers all six tools with read classification", () => {
    const { tools } = setup();
    expect(tools.map((t) => t.name)).toEqual(EXPECTED_NAMES);
    // read tools always register regardless of policy; descriptions are non-empty
    for (const tool of tools) {
      expect(tool.description.length).toBeGreaterThan(0);
    }
  });

  it("actiondock_repository_list forwards no arguments", async () => {
    const { tools, calls } = setup();
    const tool = tools.find((t) => t.name === "actiondock_repository_list")!;
    await tool.handler({});
    expect(calls).toEqual([{ method: "list", args: [] }]);
  });

  it("actiondock_repository_resolve forwards repositoryId and returns content verbatim", async () => {
    const { tools, calls } = setup();
    const tool = tools.find((t) => t.name === "actiondock_repository_resolve")!;
    const result = (await tool.handler({ repositoryId: "my-repo" })) as {
      content: [{ type: string; text: string }];
    };
    expect(calls).toEqual([{ method: "resolveProject", args: ["my-repo"] }]);
    // business data is wrapped by toMcpJson in { ok: true, data: ... }; the
    // ACTIONDOCK.md content survives verbatim inside that envelope.
    const parsed = JSON.parse(result.content[0].text) as {
      ok: boolean;
      data: { repositoryId: string; content: string };
    };
    expect(parsed).toEqual({
      ok: true,
      data: { repositoryId: "my-repo", content: "# ACTIONDOCK" }
    });
  });

  it("actiondock_repository_script_list forwards a provided repositoryId", async () => {
    const { tools, calls } = setup();
    const tool = tools.find((t) => t.name === "actiondock_repository_script_list")!;
    await tool.handler({ repositoryId: "repo-a" });
    expect(calls).toEqual([{ method: "listScripts", args: ["repo-a"] }]);
  });

  it("actiondock_repository_script_list forwards undefined when repositoryId omitted", async () => {
    const { tools, calls } = setup();
    const tool = tools.find((t) => t.name === "actiondock_repository_script_list")!;
    await tool.handler({});
    expect(calls).toEqual([{ method: "listScripts", args: [undefined] }]);
  });

  it("actiondock_repository_script_get forwards repositoryId and scriptId", async () => {
    const { tools, calls } = setup();
    const tool = tools.find((t) => t.name === "actiondock_repository_script_get")!;
    await tool.handler({ repositoryId: "repo-a", scriptId: "s1" });
    expect(calls).toEqual([{ method: "getScript", args: ["repo-a", "s1"] }]);
  });

  it("actiondock_repository_knowledge_list forwards a provided repositoryId", async () => {
    const { tools, calls } = setup();
    const tool = tools.find((t) => t.name === "actiondock_repository_knowledge_list")!;
    await tool.handler({ repositoryId: "repo-a" });
    expect(calls).toEqual([{ method: "listKnowledge", args: ["repo-a"] }]);
  });

  it("actiondock_repository_knowledge_list forwards undefined when repositoryId omitted", async () => {
    const { tools, calls } = setup();
    const tool = tools.find((t) => t.name === "actiondock_repository_knowledge_list")!;
    await tool.handler({});
    expect(calls).toEqual([{ method: "listKnowledge", args: [undefined] }]);
  });

  it("actiondock_repository_knowledge_get forwards repositoryId and knowledgeId", async () => {
    const { tools, calls } = setup();
    const tool = tools.find((t) => t.name === "actiondock_repository_knowledge_get")!;
    await tool.handler({ repositoryId: "repo-a", knowledgeId: "k1" });
    expect(calls).toEqual([{ method: "getKnowledge", args: ["repo-a", "k1"] }]);
  });

  it("defines the required repositoryId input for the *_get tools", () => {
    const { tools } = setup();
    const scriptGet = tools.find((t) => t.name === "actiondock_repository_script_get")!;
    expect(Object.keys(scriptGet.inputSchema).sort()).toEqual(["repositoryId", "scriptId"]);
    const knowledgeGet = tools.find((t) => t.name === "actiondock_repository_knowledge_get")!;
    expect(Object.keys(knowledgeGet.inputSchema).sort()).toEqual(["knowledgeId", "repositoryId"]);
  });

  it("marks repositoryId optional on the *_list tools", () => {
    const { tools } = setup();
    const scriptList = tools.find((t) => t.name === "actiondock_repository_script_list")!;
    expect(Object.keys(scriptList.inputSchema)).toEqual(["repositoryId"]);
    expect(scriptList.inputSchema.repositoryId).toBeDefined();
    const knowledgeList = tools.find((t) => t.name === "actiondock_repository_knowledge_list")!;
    expect(Object.keys(knowledgeList.inputSchema)).toEqual(["repositoryId"]);
  });
});
