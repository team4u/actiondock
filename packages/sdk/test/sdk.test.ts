import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import { decodeText, defineAction, encodeText } from "../src";
import type { ProcessAPI, ProcessInfo } from "../src";
import {
  ActionRuntimeError,
  createTestRuntime,
  MemoryLogger,
  MemoryStateStore,
} from "@actiondock/testing";

describe("@actiondock/sdk", () => {
  beforeEach(() => {
    // 每个用例独立构建运行时，无需全局清理
  });

  it("defines an action with run handler", () => {
    const action = defineAction({
      run: (input: { name: string }) => `Hello, ${input.name}!`,
    });

    assert.strictEqual(typeof action.run, "function");

    const directAction = defineAction((input: { name: string }) => `Hello, ${input.name}!`);
    assert.strictEqual(typeof directAction.run, "function");
  });

  it("throws error for invalid action definition", () => {
    assert.throws(() => defineAction({} as any));
    assert.throws(() => defineAction(null as any));
  });

  it("executes an action in test runtime with config and state", async () => {
    const counterAction = defineAction(async (_input: unknown, ctx) => {
      const prefix = ctx.config.get("PREFIX", "Count:");
      const current = (await ctx.state.get<number>("count")) || 0;
      const next = current + 1;
      await ctx.state.set("count", next);
      ctx.log.info(`Updated count to ${next}`);
      return `${prefix} ${next}`;
    });

    const runtime = createTestRuntime({
      config: { PREFIX: "Total:" },
      state: { count: 5 },
    });

    const res1 = await runtime.run(counterAction, {});
    assert.strictEqual(res1, "Total: 6");
    assert.strictEqual(await runtime.state.get<number>("count"), 6);

    const res2 = await runtime.run(counterAction, {});
    assert.strictEqual(res2, "Total: 7");
    assert.strictEqual(await runtime.state.get<number>("count"), 7);

    assert.strictEqual(runtime.logger.logs.length, 2);
    assert.ok((runtime.logger.logs[0].message).includes("Updated count to 6"));
  });

  it("supports MemoryStateStore scoping, prefix listing, and deletion", async () => {
    const store = new MemoryStateStore();
    await store.set("global_k1", "v1");
    await store.set("global_k2", "v2");

    const userScope = store.scope("users");
    await userScope.set("alice", { age: 30 });
    await userScope.set("bob", { age: 25 });

    // 隔离性检查
    assert.strictEqual(await store.get<string>("global_k1"), "v1");
    assert.deepStrictEqual(await userScope.get<{ age: number }>("alice"), { age: 30 });
    // 根命名空间读取严格限定空命名空间，与生产 RuntimeStateStore 语义一致，
    // 不做跨命名空间隐式回扫
    assert.strictEqual(await store.get("alice"), undefined);

    // 深拷贝验证 (structuredClone)
    const obj = { nested: { val: 100 } };
    await store.set("nested_obj", obj);
    obj.nested.val = 200;
    const fetched = await store.get<{ nested: { val: number } }>("nested_obj");
    assert.strictEqual(fetched?.nested.val, 100);

    // 带前缀的键列表检索
    const rootKeys = await store.keys();
    assert.deepStrictEqual(rootKeys.sort(), ["global_k1", "global_k2", "nested_obj"]);

    const userKeys = await userScope.keys();
    assert.deepStrictEqual(userKeys.sort(), ["alice", "bob"]);

    const userKeysFiltered = await userScope.keys("al");
    assert.deepStrictEqual(userKeysFiltered, ["alice"]);

    // 删除状态项
    const deleted = await userScope.delete("alice");
    assert.strictEqual(deleted, true);
    assert.strictEqual(await userScope.get("alice"), undefined);
    assert.deepStrictEqual(await userScope.keys(), ["bob"]);

    const deleteNonExistent = await userScope.delete("alice");
    assert.strictEqual(deleteNonExistent, false);

    // 清空状态项
    const cleared = await userScope.clear();
    assert.strictEqual(cleared, 1);
    assert.deepStrictEqual(await userScope.keys(), []);
  });

  it("supports MemoryStateStore with colon-containing keys and nested scopes", async () => {
    const store = new MemoryStateStore();

    // 包含冒号的根键
    await store.set("key:with:colon", "value-colon");
    assert.strictEqual(await store.get<string>("key:with:colon"), "value-colon");
    assert.ok((await store.keys()).includes("key:with:colon"));

    // 包含冒号的作用域键
    const scoped = store.scope("sub:ns");
    await scoped.set("another:colon:key", "value-nested");
    assert.strictEqual(await scoped.get<string>("another:colon:key"), "value-nested");
    assert.deepStrictEqual(await scoped.keys(), ["another:colon:key"]);

    // 根存储读取严格限定空命名空间，不隐式回扫作用域键；
    // keys 列表不暴露作用域键，写入也不落到根命名空间
    assert.strictEqual(await store.get("another:colon:key"), undefined);
    assert.ok(!(await store.keys()).includes("another:colon:key"));

    // 删除包含冒号的键
    const deleted = await scoped.delete("another:colon:key");
    assert.strictEqual(deleted, true);
    assert.strictEqual(await scoped.get("another:colon:key"), undefined);
    assert.deepStrictEqual(await scoped.keys(), []);

    // 命名空间碰撞测试：命名空间 a:b + 键 c 与命名空间 a + 键 b:c 隔离
    const storeAB = store.scope("a:b");
    const storeA = store.scope("a");
    await storeAB.set("c", "val-ab-c");
    await storeA.set("b:c", "val-a-bc");

    assert.strictEqual(await storeAB.get<string>("c"), "val-ab-c");
    assert.strictEqual(await storeA.get<string>("b:c"), "val-a-bc");
    assert.strictEqual(await storeAB.get("b:c"), undefined);
    assert.strictEqual(await storeA.get("c"), undefined);
  });

  it("supports MemoryLogger debug, info, warn, and error levels with data", () => {
    const logger = new MemoryLogger();
    logger.debug("debug message", { d: 1 });
    logger.info("info message", { i: 2 });
    logger.warn("warn message", { w: 3 });
    logger.error("error message", { e: 4 });

    assert.strictEqual(logger.logs.length, 4);
    assert.deepStrictEqual(logger.logs[0], { level: "debug", message: "debug message", data: { d: 1 } });
    assert.deepStrictEqual(logger.logs[1], { level: "info", message: "info message", data: { i: 2 } });
    assert.deepStrictEqual(logger.logs[2], { level: "warn", message: "warn message", data: { w: 3 } });
    assert.deepStrictEqual(logger.logs[3], { level: "error", message: "error message", data: { e: 4 } });
  });

  it("supports action-to-action invocation by identifier or ActionRef", async () => {
    const childAction = defineAction({
      run: (input: { val: number }) => input.val * 2,
    });

    const parentAction = defineAction({
      async run(input: { val: number }, ctx) {
        const doubled = await ctx.actions.invoke<unknown, number>("test.child", { val: input.val });
        return { result: doubled + 1 };
      },
    });

    const runtime = createTestRuntime({
      actions: {
        "test.child": childAction,
      },
    });
    const res = await runtime.run(parentAction, { val: 10 });
    assert.deepStrictEqual(res, { result: 21 });
  });

  it("strictly prohibits passing ActionDefinition to ctx.actions.invoke", async () => {
    const childAction = defineAction({
      run: () => 42,
    });

    const invalidCaller = defineAction({
      async run(_input, ctx) {
        return (ctx.actions.invoke as any)(childAction, {});
      },
    });

    const runtime = createTestRuntime({
      actions: {
        child: childAction,
      },
    });

    try {
      await runtime.run(invalidCaller, {});
      assert.fail("不应到达此分支");
    } catch (err: any) {
      assert.strictEqual(err.code, "INVALID_ACTION_REF");
    }
  });

  it("supports action invocation by string ID and ActionRef", async () => {
    const childAction = defineAction({
      run: (input: { val: number }) => input.val * 3,
    });

    const parentAction = defineAction({
      async run(input: { val: number }, ctx) {
        const res1 = await ctx.actions.invoke<{ val: number }, number>("child", { val: input.val });
        const res2 = await ctx.actions.invoke<{ val: number }, number>({ actionId: "child" }, { val: input.val });
        const res3 = await ctx.actions.invoke<{ val: number }, number>("my-pkg/child", { val: input.val });
        const res4 = await ctx.actions.invoke<{ val: number }, number>({ packageId: "my-pkg", actionId: "child" }, { val: input.val });
        return { total: res1 + res2 + res3 + res4 };
      },
    });

    const scopedWorker = defineAction({
      run: (input: { msg: string }) => `processed: ${input.msg}`,
    });

    const runtime = createTestRuntime({
      actions: {
        child: childAction,
        "shared-pkg/worker": scopedWorker,
      },
    });
    const res = await runtime.run(parentAction, { val: 5 });
    assert.deepStrictEqual(res, { total: 15 + 15 + 15 + 15 });

    // 验证以结构化 ActionRef 指定 packageId 调用以完全限定键名注册的 Action
    const scopedCaller = defineAction({
      async run(_input, ctx) {
        return ctx.actions.invoke({ packageId: "shared-pkg", actionId: "worker" }, { msg: "hello" });
      },
    });
    const scopedRes = await runtime.run(scopedCaller, {});
    assert.strictEqual(scopedRes, "processed: hello");
  });

  it("detects recursion/cycle in action invocation", async () => {
    const cycleAction = defineAction({
      async run(_input: unknown, ctx) {
        return ctx.actions.invoke("test.cycle", {});
      },
    });

    const runtime = createTestRuntime({
      actions: {
        "test.cycle": cycleAction,
      },
    });
    await assert.rejects(runtime.run("test.cycle", {}), /Cycle detected/);
  });

  it("supports full-trace run context (rootId, parentId) in nested action invocation", async () => {
    let capturedParentRun: any;
    let capturedChildRun: any;

    const childAction = defineAction({
      run(_input: unknown, ctx) {
        capturedChildRun = { ...ctx.run };
        return "child-ok";
      },
    });

    const parentAction = defineAction({
      async run(_input: unknown, ctx) {
        capturedParentRun = { ...ctx.run };
        await ctx.actions.invoke("child-worker", {});
        return "parent-ok";
      },
    });

    const runtime = createTestRuntime({
      actions: [{ id: "child-worker", action: childAction }],
    });

    await runtime.run(parentAction, {});

    assert.notStrictEqual(capturedParentRun, undefined);
    assert.notStrictEqual(capturedChildRun, undefined);

    assert.ok(capturedParentRun.id);
    assert.strictEqual(capturedParentRun.rootId, capturedParentRun.id);
    assert.strictEqual(capturedParentRun.parentId, undefined);

    assert.ok(capturedChildRun.id);
    assert.notStrictEqual(capturedChildRun.id, capturedParentRun.id);
    assert.strictEqual(capturedChildRun.rootId, capturedParentRun.rootId);
    assert.strictEqual(capturedChildRun.parentId, capturedParentRun.id);
  });

  it("handles cross-package same-name action invocation in test runtime without cycle false positive", async () => {
    const localCalc = defineAction({
      run: (input: { x: number }) => input.x + 1,
    });

    const extCalc = defineAction({
      run: (input: { x: number }) => input.x * 10,
    });

    const caller = defineAction({
      async run(input: { x: number }, ctx) {
        const local = await ctx.actions.invoke("calc", { x: input.x });
        const ext = await ctx.actions.invoke({ packageId: "ext-pkg", actionId: "calc" }, { x: input.x });
        return { local, ext };
      },
    });

    const runtime = createTestRuntime({
      actions: {
        calc: localCalc,
        "ext-pkg/calc": extCalc,
      },
    });

    const res = await runtime.run(caller, { x: 5 });
    assert.deepStrictEqual(res, { local: 6, ext: 50 });
  });

  it("supports concurrent sub-action invocations without call stack race conditions", async () => {
    const workerAction = defineAction({
      async run(input: { val: number }) {
        await new Promise((resolve) => setTimeout(resolve, 10));
        return input.val * 2;
      },
    });

    const concurrentCaller = defineAction({
      async run(_input: unknown, ctx) {
        const results = await Promise.all([
          ctx.actions.invoke("async-worker", { val: 1 }),
          ctx.actions.invoke("async-worker", { val: 2 }),
          ctx.actions.invoke("async-worker", { val: 3 }),
        ]);
        return results;
      },
    });

    const runtime = createTestRuntime({
      actions: [{ id: "async-worker", action: workerAction }],
    });

    const results = await runtime.run(concurrentCaller, {});
    assert.deepStrictEqual(results, [2, 4, 6]);
  });

  it("handles state expiration with TTL in MemoryStateStore", async () => {
    const runtime = createTestRuntime();

    await runtime.state.set("temp-key", "hello", 0.05);
    assert.strictEqual(await runtime.state.get<string>("temp-key"), "hello");
    assert.ok((await runtime.state.keys()).includes("temp-key"));

    await runtime.state.set("permanent", "keep-me");

    await runtime.clock.advance(100);

    assert.strictEqual(await runtime.state.get("temp-key"), undefined);
    assert.strictEqual(await runtime.state.get<string>("permanent"), "keep-me");

    const remainingKeys = await runtime.state.keys();
    assert.deepStrictEqual(remainingKeys, ["permanent"]);
  });

  it("executes CLI command using ctx.process.run", async () => {
    let calledSpec: any;
    const mockProcess: ProcessAPI = {
      async run(input) {
        calledSpec = input.spec;
        return {
          exit: { code: 0, signal: null },
          chunks: [{ stream: "stdout", data: encodeText("v24.12.0") }],
          truncated: false,
        };
      },
      async start() { throw new Error("not implemented"); },
      async inspect() { throw new Error("not implemented"); },
      async list() { return { processes: [] }; },
      async write() { throw new Error("not implemented"); },
      async operation() { throw new Error("not implemented"); },
      async read() { throw new Error("not implemented"); },
      async control() { throw new Error("not implemented"); },
      async stop() { throw new Error("not implemented"); },
    };

    const runtime = createTestRuntime({
      process: mockProcess as any,
    });
    const runAction = defineAction({
      async run(input: { executable: string; args: string[] }, ctx) {
        return await ctx.process.run({
          spec: { executable: input.executable, args: input.args, io: { mode: "pipe" } },
          timeoutMs: 5000,
          maxOutputBytes: 1024,
        });
      },
    });

    const res = await runtime.run(runAction, { executable: "node", args: ["--version"] });
    assert.strictEqual(res.exit.code, 0);
    assert.strictEqual(decodeText(res.chunks), "v24.12.0");
    assert.strictEqual(calledSpec.executable, "node");
    assert.deepStrictEqual(calledSpec.args, ["--version"]);
  });

  it("manages process lifecycle via ctx.process.start and inspect", async () => {
    const dummyInfo: ProcessInfo = {
      id: "proc-123",
      hostEpoch: "epoch-1",
      state: "running",
      control: "free",
      io: { mode: "pipe" },
      capabilities: {
        pty: false,
        resize: false,
        inputEOF: true,
        interruptForeground: false,
        terminationScope: "process",
      },
      createdAt: new Date().toISOString(),
      outputClosed: false,
      effectiveLimits: {
        idleMs: 1800000,
        lifetimeMs: 28800000,
        outputBufferBytes: 4194304,
      },
    };

    const mockProcess: ProcessAPI = {
      async run() { throw new Error("not implemented"); },
      async start(input) {
        return { process: { ...dummyInfo, id: `proc-${input.requestId}` }, initialCursor: "cur-0" };
      },
      async inspect(id) {
        return { ...dummyInfo, id };
      },
      async list() { return { processes: [dummyInfo] }; },
      async write() { throw new Error("not implemented"); },
      async operation() { throw new Error("not implemented"); },
      async read() { throw new Error("not implemented"); },
      async control() { throw new Error("not implemented"); },
      async stop(id) { return { ...dummyInfo, id, state: "stopping" }; },
    };

    const runtime = createTestRuntime({
      process: mockProcess as any,
    });

    const startAction = defineAction({
      async run(input: { requestId: string; executable: string }, ctx) {
        const started = await ctx.process.start({
          requestId: input.requestId,
          spec: { executable: input.executable, args: [], io: { mode: "pipe" } },
        });
        const inspected = await ctx.process.inspect(started.process.id);
        return {
          startedId: started.process.id,
          inspectedId: inspected.id,
          state: inspected.state,
        };
      },
    });

    const res = await runtime.run(startAction, { requestId: "req-abc", executable: "node" });
    assert.strictEqual(res.startedId, "proc-req-abc");
    assert.strictEqual(res.inspectedId, "proc-req-abc");
    assert.strictEqual(res.state, "running");
  });

  it("enforces input and output schema validation throwing ActionRuntimeError", async () => {
    const runtime = createTestRuntime();

    const strictAction = Object.assign(
      defineAction((input: any) => {
        if (input.count === -1) {
          return { valid: "not-a-bool" as any };
        }
        return { valid: true };
      }),
      {
        id: "test.strict",
        inputSchema: {
          type: "object",
          properties: { count: { type: "number" } },
          required: ["count"],
        },
        outputSchema: {
          type: "object",
          properties: { valid: { type: "boolean" } },
          required: ["valid"],
        },
      }
    );

    // 输入参数校验失败
    try {
      await runtime.run(strictAction, { count: "not-a-number" } as any);
      assert.fail("不应到达此分支");
    } catch (err: any) {
      assert.ok(err instanceof ActionRuntimeError);
      assert.strictEqual(err.code, "INPUT_VALIDATION_FAILED");
    }

    // 输出参数校验失败
    try {
      await runtime.run(strictAction, { count: -1 });
      assert.fail("不应到达此分支");
    } catch (err: any) {
      assert.ok(err instanceof ActionRuntimeError);
      assert.strictEqual(err.code, "OUTPUT_VALIDATION_FAILED");
    }

    // 校验成功通过
    const res = await runtime.run(strictAction, { count: 10 });
    assert.deepStrictEqual(res, { valid: true });
  });

  it("detects cyclic action invocations and throws ACTION_CALL_CYCLE", async () => {
    const loopA = defineAction({
      async run(_input: any, ctx) {
        return ctx.actions.invoke("test.loop-b", {});
      },
    });

    const loopB = defineAction({
      async run(_input: any, ctx) {
        return ctx.actions.invoke("test.loop-a", {});
      },
    });

    const runtime = createTestRuntime({
      actions: {
        "test.loop-a": loopA,
        "test.loop-b": loopB,
      },
    });

    try {
      await runtime.run(loopA, {});
      assert.fail("不应到达此分支");
    } catch (err: any) {
      assert.strictEqual(err.code, "ACTION_CALL_CYCLE");
    }
  });

  it("guarantees isolation and TTL expiry between separate test runtimes", async () => {
    const runtime1 = createTestRuntime({
      config: { KEY: "value1" },
      state: { item: "state1" },
    });
    const runtime2 = createTestRuntime({
      config: { KEY: "value2" },
      state: { item: "state2" },
    });

    assert.strictEqual(runtime1.config.get<string>("KEY"), "value1");
    assert.strictEqual(runtime2.config.get<string>("KEY"), "value2");

    await runtime1.state.set("item", "updated1");
    assert.strictEqual(await runtime1.state.get<string>("item"), "updated1");
    assert.strictEqual(await runtime2.state.get<string>("item"), "state2");

    await runtime1.state.set("temp", "expiring", 0.001);
    await runtime1.clock.advance(10);
    assert.strictEqual(await runtime1.state.get("temp"), undefined);
  });
});
