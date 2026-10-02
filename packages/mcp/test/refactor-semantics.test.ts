import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { defineAction } from "@actiondock/sdk";
import { InMemoryTransport } from "@modelcontextprotocol/server";
import { createActionDockMcpServer } from "../src/adapter";
import { isAsyncExecutionRequested, stripExecutionWrapper } from "../src/execution-mode";
import { toMcpSchema } from "../src/schemas";

describe("MCP adapter async execution mode semantics", () => {
  it("detects async mode only via execution.mode and legacy __async read-only probe", () => {
    assert.strictEqual(isAsyncExecutionRequested({ execution: { mode: "async" } }), true);
    assert.strictEqual(isAsyncExecutionRequested({ execution: { mode: "sync" } }), false);
    assert.strictEqual(isAsyncExecutionRequested({ __async: true }), true);
    assert.strictEqual(isAsyncExecutionRequested({ __async: false }), false);
    assert.strictEqual(isAsyncExecutionRequested({ async: true }), false);
    assert.strictEqual(isAsyncExecutionRequested(null), false);
    assert.strictEqual(isAsyncExecutionRequested("string"), false);
    assert.strictEqual(isAsyncExecutionRequested([1, 2]), false);
  });

  it("strips only wrapper fields (execution, __async) and preserves business async field", () => {
    assert.deepStrictEqual(stripExecutionWrapper({ a: 1, execution: { mode: "sync" }, __async: false }), {
      a: 1,
    });
    // 业务自有的 async 入参字段原样透传，不再被吞没
    assert.deepStrictEqual(stripExecutionWrapper({ async: true, query: "x" }), { async: true, query: "x" });
    // 未携带包装字段时原样返回
    const untouched = { b: 2 };
    assert.strictEqual(stripExecutionWrapper(untouched), untouched);
    // 非对象输入原样返回
    assert.strictEqual(stripExecutionWrapper("raw"), "raw");
  });

  it("injects only execution wrapper into tool schema, no __async magic field", async () => {
    const wrapped: any = toMcpSchema({
      type: "object",
      properties: { q: { type: "string" } },
      required: ["q"],
      additionalProperties: false,
    });
    const validate = wrapped["~standard"].validate;

    // execution 包装字段可被接受
    const withExecution = await validate({ q: "a", execution: { mode: "async" } });
    assert.deepStrictEqual(withExecution.value.execution, { mode: "async" });

    // __async 魔法字段不再注入 schema，严格模式下成为非法未知字段
    const withMagic = await validate({ q: "a", __async: true });
    assert.notStrictEqual(withMagic.issues, undefined);
  });

  it("does not inject execution wrapper into output schemas when injectExecution is false", async () => {
    const output: any = toMcpSchema(
      {
        type: "object",
        properties: { result: { type: "number" } },
        required: ["result"],
        additionalProperties: false,
      },
      false
    );
    const validate = output["~standard"].validate;

    // 出参不含 execution 包装字段，实际返回结构可直接通过校验
    const plain = await validate({ result: 42 });
    assert.strictEqual(plain.issues, undefined);

    // 注入的 execution 字段反而应被拒绝（与实际 structuredContent 不符）
    const polluted = await validate({ result: 42, execution: { mode: "sync" } });
    assert.notStrictEqual(polluted.issues, undefined);

    // 默认参数保持入参注入行为
    const input: any = toMcpSchema({ type: "object", properties: {} });
    const inputProps = await input["~standard"].validate({ execution: { timeoutMs: 100 } });
    assert.deepStrictEqual(inputProps.value.execution, { timeoutMs: 100 });
  });

  it("tool schema clone does not mutate the caller's original schema object", () => {
    const original: any = {
      type: "object",
      properties: { q: { type: "string" } },
    };
    toMcpSchema(original);
    assert.deepStrictEqual(Object.keys(original.properties), ["q"]);
  });

  it("passes through a business input field named async to the action", async () => {
    let received: any = null;
    const action = defineAction({
      run(input: any) {
        received = input;
        return { ok: true };
      },
    });

    const server = await createActionDockMcpServer({
      actions: new Map([["biz-async", action]]),
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
            name: "biz-async",
            arguments: { async: true, tag: "keep" },
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
    // 名为 async 的业务入参字段完整送达，未被适配层吞没
    assert.deepStrictEqual(received, { async: true, tag: "keep" });

    await server.close();
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
    // 外部 storage 视图需保持读写委托能力：注入的 run 记录可通过 tasks/get 读回
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

describe("MCP adapter execution timeout combination", () => {
  const buildMockStorage = () =>
    ({
      getRun: () => undefined,
      listRuns: () => [],
      updateRun: () => {},
      createRun: () => {},
      close: () => {},
    }) as any;

  it("combines client-declared execution.timeoutMs with server timeoutMs by taking the smaller value", async () => {
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

    // 拦截底层 service 的 execution.run 以观测实际传入的超时组合结果
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
        // 客户端声明更短的超时（200ms < 5000ms），组合后应取 200
        clientTransport.send({
          jsonrpc: "2.0",
          id: 2,
          method: "tools/call",
          params: {
            name: "timeout-probe",
            arguments: { execution: { timeoutMs: 200 } },
          },
        });
        // 客户端声明更长的超时（9000ms > 5000ms），组合后应取 5000
        clientTransport.send({
          jsonrpc: "2.0",
          id: 3,
          method: "tools/call",
          params: {
            name: "timeout-probe",
            arguments: { execution: { timeoutMs: 9000 } },
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

    assert.strictEqual(receivedOptions.length, 2);
    assert.strictEqual(receivedOptions[0]?.timeoutMs, 200);
    assert.strictEqual(receivedOptions[1]?.timeoutMs, 5000);

    await server.close();
  });
});

describe("MCP tasks extension isolation", () => {
  it("registers tasks handlers through the isolated module with schema validation", async () => {
    const runs = new Map<string, any>();
    runs.set("task-x", {
      id: "task-x",
      status: "success",
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
    });

    const server = await createActionDockMcpServer({
      actions: new Map(),
      storage: {
        getRun: (id: string) => runs.get(id),
        listRuns: () => Array.from(runs.values()),
        updateRun: () => {},
        createRun: () => {},
        close: () => {},
      } as any,
    });

    const handlers = (server.server as any)._requestHandlers;
    assert.notStrictEqual(handlers.get("tasks/get"), undefined);
    assert.notStrictEqual(handlers.get("tasks/list"), undefined);
    assert.notStrictEqual(handlers.get("tasks/cancel"), undefined);

    // 缺少 taskId 时由 schema 校验拒绝，而非进入业务处理器
    const getHandler = handlers.get("tasks/get");
    await assert.rejects(
      getHandler({ method: "tasks/get", params: {} })
    );

    // tasks/list 按启动时间倒序返回
    const listHandler = handlers.get("tasks/list");
    const listRes = await listHandler({ method: "tasks/list", params: { limit: 10 } });
    assert.deepStrictEqual(listRes.tasks.map((t: any) => t.taskId), ["task-x"]);

    await server.close();
  });

  it("propagates semantic JSON-RPC error codes for not-found tasks instead of internal errors", async () => {
    const server = await createActionDockMcpServer({
      actions: new Map(),
      storage: {
        getRun: () => undefined,
        listRuns: () => [],
        updateRun: () => {},
        createRun: () => {},
        close: () => {},
      } as any,
    });

    const handlers = (server.server as any)._requestHandlers;

    // tasks/get 未命中时携带服务端自定义语义码（-32001 码段），而非裸 Error
    const getHandler = handlers.get("tasks/get");
    let getCode: unknown;
    try {
      await getHandler({ method: "tasks/get", params: { taskId: "missing" } });
    } catch (err: any) {
      getCode = err?.code;
    }
    assert.strictEqual(getCode, -32001);

    // tasks/cancel 未命中时同样携带语义码
    const cancelHandler = handlers.get("tasks/cancel");
    let cancelCode: unknown;
    try {
      await cancelHandler({ method: "tasks/cancel", params: { taskId: "missing" } });
    } catch (err: any) {
      cancelCode = err?.code;
    }
    assert.strictEqual(cancelCode, -32001);

    await server.close();
  });

  it("validates and clamps tasks/list limit to the integer range with a semantic error code", async () => {
    const runs = new Map<string, any>();
    for (let i = 0; i < 3; i++) {
      runs.set(`task-${i}`, {
        id: `task-${i}`,
        status: "success",
        startedAt: new Date(Date.now() - i * 1000).toISOString(),
        finishedAt: new Date(Date.now() - i * 1000).toISOString(),
      });
    }

    const server = await createActionDockMcpServer({
      actions: new Map(),
      storage: {
        getRun: (id: string) => runs.get(id),
        listRuns: () => Array.from(runs.values()),
        updateRun: () => {},
        createRun: () => {},
        close: () => {},
      } as any,
    });

    const listHandler = (server.server as any)._requestHandlers.get("tasks/list");

    // 非整数 limit 抛携带语义码的参数错误
    let invalidCode: unknown;
    try {
      await listHandler({ method: "tasks/list", params: { limit: 2.5 } });
    } catch (err: any) {
      invalidCode = err?.code;
    }
    assert.strictEqual(invalidCode, -32002);

    // 缺省 limit 默认 50，超上限钳制到 500：均正常返回不抛错
    const defaulted = await listHandler({ method: "tasks/list", params: {} });
    assert.strictEqual(defaulted.tasks.length, 3);
    const clamped = await listHandler({ method: "tasks/list", params: { limit: 99999 } });
    assert.strictEqual(clamped.tasks.length, 3);

    await server.close();
  });
});

describe("MCP adapter packageAllowlist filtering semantics", () => {
  it("filters tools, playbooks, and tasks according to packageAllowlist", async () => {
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
        get: async (id: string) => {
          if (id === "run-b") return { id: "run-b", packageId: "pkg-b" };
          if (id === "run-none") return { id: "run-none" };
          return { id: "run-a", packageId: "pkg-a" };
        },
        list: async () => [
          { id: "run-a", packageId: "pkg-a", startedAt: new Date().toISOString() },
          { id: "run-b", packageId: "pkg-b", startedAt: new Date().toISOString() },
          { id: "run-none", startedAt: new Date().toISOString() },
        ],
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

    // 2. Verify tasks/list filters out both pkg-b and unassigned runs
    const tasksListHandler = (server.server as any)._requestHandlers.get("tasks/list");
    const tasksResult = await tasksListHandler({ method: "tasks/list", params: {} });
    const taskIds = tasksResult.tasks.map((t: any) => t.taskId);
    assert.ok((taskIds).includes("run-a"));
    assert.ok(!(taskIds).includes("run-b"));
    assert.ok(!(taskIds).includes("run-none"));

    // 3. Verify tasks/get for forbidden package and unassigned package
    const tasksGetHandler = (server.server as any)._requestHandlers.get("tasks/get");
    await assert.rejects(tasksGetHandler({ method: "tasks/get", params: { taskId: "run-b" } }));
    await assert.rejects(tasksGetHandler({ method: "tasks/get", params: { taskId: "run-none" } }));

    // 4. Verify tasks/cancel for forbidden package and unassigned package
    const tasksCancelHandler = (server.server as any)._requestHandlers.get("tasks/cancel");
    await assert.rejects(tasksCancelHandler({ method: "tasks/cancel", params: { taskId: "run-b" } }));
    await assert.rejects(tasksCancelHandler({ method: "tasks/cancel", params: { taskId: "run-none" } }));

    // 5. Verify resources and prompts
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

  it("filters tools and tasks according to actionAllowlist", async () => {
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
        get: async (id: string) => {
          if (id === "run-b") return { id: "run-b", packageId: "pkg-a", actionId: "action-b" };
          return { id: "run-a", packageId: "pkg-a", actionId: "action-a" };
        },
        list: async () => [
          { id: "run-a", packageId: "pkg-a", actionId: "action-a", startedAt: new Date().toISOString() },
          { id: "run-b", packageId: "pkg-a", actionId: "action-b", startedAt: new Date().toISOString() },
        ],
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

    // 2. Verify tasks/list
    const tasksListHandler = (server.server as any)._requestHandlers.get("tasks/list");
    const tasksResult = await tasksListHandler({ method: "tasks/list", params: {} });
    const taskIds = tasksResult.tasks.map((t: any) => t.taskId);
    assert.ok((taskIds).includes("run-a"));
    assert.ok(!(taskIds).includes("run-b"));

    // 3. Verify tasks/get
    const tasksGetHandler = (server.server as any)._requestHandlers.get("tasks/get");
    const taskGetOk = await tasksGetHandler({ method: "tasks/get", params: { taskId: "run-a" } });
    assert.strictEqual(taskGetOk.task.taskId, "run-a");
    await assert.rejects(tasksGetHandler({ method: "tasks/get", params: { taskId: "run-b" } }));

    // 4. Verify tasks/cancel
    const tasksCancelHandler = (server.server as any)._requestHandlers.get("tasks/cancel");
    await assert.rejects(tasksCancelHandler({ method: "tasks/cancel", params: { taskId: "run-b" } }));

    await server.close();
  });
});

