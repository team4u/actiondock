import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { defineAction } from "@actiondock/sdk";
import { InMemoryTransport } from "@modelcontextprotocol/server";
import { createActionDockMcpServer } from "../src/adapter";
import { resolveExecutionTimeout } from "../src/execution-mode";
import { toMcpSchema } from "../src/schemas";

describe("MCP adapter pure contract semantics", () => {
  it("does not inject execution wrapper into tool schema, keeping schema faithful", async () => {
    const wrapped: any = toMcpSchema({
      type: "object",
      properties: { q: { type: "string" } },
      required: ["q"],
      additionalProperties: false,
    });
    const validate = wrapped["~standard"].validate;

    // 原始业务定义入参顺利通过校验
    const valid = await validate({ q: "a" });
    assert.strictEqual(valid.issues, undefined);

    // 未经注入的 execution 字段在严格模式下被直接拒绝，保持对原始 schema 的忠实
    const withExecution = await validate({ q: "a", execution: { mode: "async" } });
    assert.notStrictEqual(withExecution.issues, undefined);
  });

  it("tool schema clone does not mutate the caller's original schema object", () => {
    const original: any = {
      type: "object",
      properties: { q: { type: "string" } },
    };
    toMcpSchema(original);
    assert.deepStrictEqual(Object.keys(original.properties), ["q"]);
  });

  it("passes through business input fields directly without modification", async () => {
    let received: any = null;
    const action = defineAction({
      run(input: any) {
        received = input;
        return { ok: true };
      },
    });

    const server = await createActionDockMcpServer({
      actions: new Map([["biz-action", action]]),
      storage: {
        getRun: () => undefined,
        listRuns: () => [],
        updateRun: () => {},
        createRun: () => {},
        close: () => {},
      } as any,
    });

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);

    let callResult: any = null;
    clientTransport.onmessage = (msg: any) => {
      if (msg.id === 1) {
        clientTransport.send({ jsonrpc: "2.0", method: "notifications/initialized" });
        clientTransport.send({
          jsonrpc: "2.0",
          id: 2,
          method: "tools/call",
          params: {
            name: "biz-action",
            arguments: { async: true, tag: "keep", count: 42 },
          },
        });
      } else if (msg.id === 2) {
        callResult = msg.result;
      }
    };

    clientTransport.send({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2026-07-28", capabilities: {}, clientInfo: { name: "c", version: "1.0" } },
    });

    await new Promise((r) => setTimeout(r, 150));

    assert.notStrictEqual(callResult, undefined);
    assert.ok(!(callResult.isError));
    // 业务入参纯净送达，未被适配层拦截或包装
    assert.deepStrictEqual(received, { async: true, tag: "keep", count: 42 });

    await server.close();
  });

  it("resolves execution timeout from context or options", () => {
    assert.strictEqual(resolveExecutionTimeout({ timeoutMs: 5000 }, { timeoutMs: 2000 }), 2000);
    assert.strictEqual(resolveExecutionTimeout({ timeoutMs: 5000 }), 5000);
    assert.strictEqual(resolveExecutionTimeout(undefined, { timeoutMs: 3000 }), 3000);
    assert.strictEqual(resolveExecutionTimeout(), undefined);
    assert.strictEqual(resolveExecutionTimeout({ timeoutMs: -100 }), undefined);
    assert.strictEqual(resolveExecutionTimeout({ timeoutMs: 0 }), undefined);
  });
});

describe("MCP adapter storage lifecycle semantics", () => {
  const buildMockStorage = (onClose: () => void) =>
    ({
      getRun: () => undefined,
      listRuns: () => [],
      updateRun: () => {},
      createRun: () => {},
      close: onClose,
    }) as any;

  it("default: external storage is not closed by server.close()", async () => {
    let closed = false;
    const server = await createActionDockMcpServer({
      actions: new Map(),
      storage: buildMockStorage(() => {
        closed = true;
      }),
    });
    await server.close();
    assert.strictEqual(closed, false);
  });

  it("ownStorageLifecycle: true cascades close through service.close()", async () => {
    let closed = false;
    const server = await createActionDockMcpServer({
      actions: new Map(),
      storage: buildMockStorage(() => {
        closed = true;
      }),
      ownStorageLifecycle: true,
      // 独立持有实例场景：显式声明 close 级联 service 生命周期
      cascadeServiceClose: true,
    });
    await server.close();
    assert.strictEqual(closed, true);
  });

  it("external storage view delegates reads while suppressing close", async () => {
    const runs = new Map<string, any>();
    runs.set("run-1", {
      id: "run-1",
      status: "running",
      startedAt: new Date().toISOString(),
    });
    let closed = false;
    const server = await createActionDockMcpServer({
      actions: new Map(),
      storage: {
        getRun: (id: string) => runs.get(id),
        listRuns: () => Array.from(runs.values()),
        updateRun: () => {},
        createRun: () => {},
        close: () => {
          closed = true;
        },
      } as any,
    });

    const run = await server.service.runs.get("run-1");
    assert.strictEqual(run?.id, "run-1");

    await server.close();
    assert.strictEqual(closed, false);
  });
});

describe("MCP adapter execution timeout passing", () => {
  const buildMockStorage = () =>
    ({
      getRun: () => undefined,
      listRuns: () => [],
      updateRun: () => {},
      createRun: () => {},
      close: () => {},
    }) as any;

  it("passes server configured timeoutMs to service.execution.run", async () => {
    const receivedOptions: any[] = [];
    const action = defineAction({
      async run() {
        return { ok: true };
      },
    });

    const server = await createActionDockMcpServer({
      actions: new Map([["timeout-probe", action]]),
      storage: buildMockStorage(),
      timeoutMs: 5000,
    });

    // 拦截底层 service 的 execution.run 以观测实际传入的超时配置
    const service = server.service as any;
    const originalRun = service.execution.run.bind(service.execution);
    service.execution.run = async (_ref: string, _input: unknown, options: any) => {
      receivedOptions.push(options);
      return originalRun(_ref, _input, options);
    };

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);

    clientTransport.onmessage = (msg: any) => {
      if (msg.id === 1) {
        clientTransport.send({ jsonrpc: "2.0", method: "notifications/initialized" });
        clientTransport.send({
          jsonrpc: "2.0",
          id: 2,
          method: "tools/call",
          params: {
            name: "timeout-probe",
            arguments: {},
          },
        });
      }
    };

    clientTransport.send({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2026-07-28",
        capabilities: {},
        clientInfo: { name: "timeout-client", version: "1.0" },
      },
    });

    await new Promise((r) => setTimeout(r, 200));

    assert.strictEqual(receivedOptions.length, 1);
    assert.strictEqual(receivedOptions[0]?.timeoutMs, 5000);

    await server.close();
  });
});

describe("MCP adapter packageAllowlist filtering semantics", () => {
  it("filters tools and playbooks according to packageAllowlist", async () => {
    const fakeService: any = {
      info: async () => [
        { id: "pkg-a", name: "Package A", version: "1.0.0" },
        { id: "pkg-b", name: "Package B", version: "2.0.0" },
      ],
      discovery: {
        listActions: async () => [
          { id: "action-a", packageId: "pkg-a", description: "Action A" },
          { id: "action-b", packageId: "pkg-b", description: "Action B" },
        ],
        listPlaybooks: async () => [
          { id: "pb-a", packageId: "pkg-a", description: "Playbook A" },
          { id: "pb-b", packageId: "pkg-b", description: "Playbook B" },
        ],
        describeAction: async () => ({}),
        describePlaybook: async () => ({ content: "content" }),
      },
      execution: {
        run: async () => ({ ok: true, data: {} }),
        start: async () => ({ runId: "r1" }),
      },
      runs: {
        get: async (id: string) => ({ id, packageId: "pkg-a" }),
        list: async () => [],
        cancel: async () => ({ outcome: "requested" }),
      },
      close: async () => {},
    };

    const server = await createActionDockMcpServer({
      service: fakeService,
      packageAllowlist: ["pkg-a"],
    });

    // 1. Verify tools
    const toolsHandler = (server.server as any)._requestHandlers.get("tools/list");
    const toolsResult = await toolsHandler({ method: "tools/list", params: {} });
    const toolNames = toolsResult.tools.map((t: any) => t.name);
    assert.ok((toolNames).includes("action-a"));
    assert.ok(!(toolNames).includes("action-b"));

    // 2. Verify resources and prompts
    const resourcesHandler = (server.server as any)._requestHandlers.get("resources/list");
    const resourcesResult = await resourcesHandler({ method: "resources/list", params: {} });
    const resourceUris = resourcesResult.resources.map((r: any) => r.uri);
    assert.strictEqual(resourceUris.some((u: string) => u.includes("pb-a")), true);
    assert.strictEqual(resourceUris.some((u: string) => u.includes("pb-b")), false);

    const promptsHandler = (server.server as any)._requestHandlers.get("prompts/list");
    const promptsResult = await promptsHandler({ method: "prompts/list", params: {} });
    const promptNames = promptsResult.prompts.map((p: any) => p.name);
    assert.ok((promptNames).includes("pb-a"));
    assert.ok(!(promptNames).includes("pb-b"));

    await server.close();
  });

  it("filters tools according to actionAllowlist", async () => {
    const fakeService: any = {
      info: async () => [
        { id: "pkg-a", name: "Package A", version: "1.0.0" },
      ],
      discovery: {
        listActions: async () => [
          { id: "action-a", packageId: "pkg-a", description: "Action A" },
          { id: "action-b", packageId: "pkg-a", description: "Action B" },
        ],
        listPlaybooks: async () => [],
        describeAction: async () => ({}),
        describePlaybook: async () => ({ content: "content" }),
      },
      execution: {
        run: async () => ({ ok: true, data: {} }),
        start: async () => ({ runId: "r1" }),
      },
      runs: {
        get: async () => undefined,
        list: async () => [],
        cancel: async () => ({ outcome: "requested" }),
      },
      close: async () => {},
    };

    const server = await createActionDockMcpServer({
      service: fakeService,
      actionAllowlist: ["pkg-a/action-a"],
    });

    // 1. Verify tools
    const toolsHandler = (server.server as any)._requestHandlers.get("tools/list");
    const toolsResult = await toolsHandler({ method: "tools/list", params: {} });
    const toolNames = toolsResult.tools.map((t: any) => t.name);
    assert.ok((toolNames).includes("action-a"));
    assert.ok(!(toolNames).includes("action-b"));

    await server.close();
  });
});
