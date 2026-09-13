import { describe, expect, it } from "bun:test";
import { defineAction } from "@actiondock/sdk";
import { InMemoryTransport } from "@modelcontextprotocol/server";
import { createActionDockMcpServer } from "../src/adapter";
import { isAsyncExecutionRequested, stripExecutionWrapper } from "../src/execution-mode";
import { toMcpSchema } from "../src/schemas";

describe("MCP adapter async execution mode semantics", () => {
  it("detects async mode only via execution.mode and legacy __async read-only probe", () => {
    expect(isAsyncExecutionRequested({ execution: { mode: "async" } })).toBe(true);
    expect(isAsyncExecutionRequested({ execution: { mode: "sync" } })).toBe(false);
    expect(isAsyncExecutionRequested({ __async: true })).toBe(true);
    expect(isAsyncExecutionRequested({ __async: false })).toBe(false);
    expect(isAsyncExecutionRequested({ async: true })).toBe(false);
    expect(isAsyncExecutionRequested(null)).toBe(false);
    expect(isAsyncExecutionRequested("string")).toBe(false);
    expect(isAsyncExecutionRequested([1, 2])).toBe(false);
  });

  it("strips only wrapper fields (execution, __async) and preserves business async field", () => {
    expect(stripExecutionWrapper({ a: 1, execution: { mode: "sync" }, __async: false })).toEqual({
      a: 1,
    });
    // 业务自有的 async 入参字段原样透传，不再被吞没
    expect(stripExecutionWrapper({ async: true, query: "x" })).toEqual({ async: true, query: "x" });
    // 未携带包装字段时原样返回
    const untouched = { b: 2 };
    expect(stripExecutionWrapper(untouched)).toBe(untouched);
    // 非对象输入原样返回
    expect(stripExecutionWrapper("raw")).toBe("raw");
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
    expect(withExecution.value.execution).toEqual({ mode: "async" });

    // __async 魔法字段不再注入 schema，严格模式下成为非法未知字段
    const withMagic = await validate({ q: "a", __async: true });
    expect(withMagic.issues).toBeDefined();
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
    expect(plain.issues).toBeUndefined();

    // 注入的 execution 字段反而应被拒绝（与实际 structuredContent 不符）
    const polluted = await validate({ result: 42, execution: { mode: "sync" } });
    expect(polluted.issues).toBeDefined();

    // 默认参数保持入参注入行为
    const input: any = toMcpSchema({ type: "object", properties: {} });
    const inputProps = await input["~standard"].validate({ execution: { timeoutMs: 100 } });
    expect(inputProps.value.execution).toEqual({ timeoutMs: 100 });
  });

  it("tool schema clone does not mutate the caller's original schema object", () => {
    const original: any = {
      type: "object",
      properties: { q: { type: "string" } },
    };
    toMcpSchema(original);
    expect(Object.keys(original.properties)).toEqual(["q"]);
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

    expect(callResult).toBeDefined();
    expect(callResult.isError).toBeFalsy();
    // 名为 async 的业务入参字段完整送达，未被适配层吞没
    expect(received).toEqual({ async: true, tag: "keep" });

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
    expect(closed).toBe(false);
  });

  it("ownStorageLifecycle: true cascades close through target.close()", async () => {
    let closed = false;
    const server = await createActionDockMcpServer({
      actions: new Map(),
      storage: buildMockStorage(() => {
        closed = true;
      }),
      ownStorageLifecycle: true,
      // 独立持有实例场景：显式声明 close 级联 target 生命周期
      cascadeTargetClose: true,
    });
    await server.close();
    expect(closed).toBe(true);
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

    const run = await server.target.getRun("run-1");
    expect(run?.id).toBe("run-1");

    await server.close();
    expect(closed).toBe(false);
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

    // 拦截底层 target 的 runAction 以观测实际传入的超时组合结果
    const target = server.target as any;
    const originalRun = target.runAction.bind(target);
    target.runAction = async (_ref: string, _input: unknown, options: any) => {
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

    expect(receivedOptions.length).toBe(2);
    expect(receivedOptions[0]?.timeoutMs).toBe(200);
    expect(receivedOptions[1]?.timeoutMs).toBe(5000);

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
    expect(handlers.get("tasks/get")).toBeDefined();
    expect(handlers.get("tasks/list")).toBeDefined();
    expect(handlers.get("tasks/cancel")).toBeDefined();

    // 缺少 taskId 时由 schema 校验拒绝，而非进入业务处理器
    const getHandler = handlers.get("tasks/get");
    await expect(
      getHandler({ method: "tasks/get", params: {} })
    ).rejects.toThrow();

    // tasks/list 按启动时间倒序返回
    const listHandler = handlers.get("tasks/list");
    const listRes = await listHandler({ method: "tasks/list", params: { limit: 10 } });
    expect(listRes.tasks.map((t: any) => t.taskId)).toEqual(["task-x"]);

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
    expect(getCode).toBe(-32001);

    // tasks/cancel 未命中时同样携带语义码
    const cancelHandler = handlers.get("tasks/cancel");
    let cancelCode: unknown;
    try {
      await cancelHandler({ method: "tasks/cancel", params: { taskId: "missing" } });
    } catch (err: any) {
      cancelCode = err?.code;
    }
    expect(cancelCode).toBe(-32001);

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
    expect(invalidCode).toBe(-32002);

    // 缺省 limit 默认 50，超上限钳制到 500：均正常返回不抛错
    const defaulted = await listHandler({ method: "tasks/list", params: {} });
    expect(defaulted.tasks.length).toBe(3);
    const clamped = await listHandler({ method: "tasks/list", params: { limit: 99999 } });
    expect(clamped.tasks.length).toBe(3);

    await server.close();
  });
});
