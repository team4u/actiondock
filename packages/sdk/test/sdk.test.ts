import { beforeEach, describe, expect, it } from "bun:test";
import {
  createTestRuntime,
  defineAction,
  MemoryConfig,
  MemoryLogger,
  MemoryStateStore,
  registerTestRuntimeProvider,
} from "../src";

describe("@actiondock/sdk", () => {
  beforeEach(() => {
    registerTestRuntimeProvider(null);
  });
  it("defines an action with validation", () => {
    const action = defineAction({
      id: "test.greet",
      description: "Greet a user",
      inputSchema: {
        type: "object",
        properties: { name: { type: "string" } },
        required: ["name"],
      },
      run: (input: { name: string }) => `Hello, ${input.name}!`,
    });

    expect(action.id).toBe("test.greet");
    expect(action.description).toBe("Greet a user");
    expect(typeof action.run).toBe("function");
  });

  it("throws error for invalid action definition", () => {
    expect(() => defineAction({} as any)).toThrow();
    expect(() => defineAction({ id: "test" } as any)).toThrow();
    expect(() => defineAction(null as any)).toThrow();
    expect(() => defineAction({ id: "", run: () => {} } as any)).toThrow();
  });

  it("executes an action in test runtime with config and state", async () => {
    const counterAction = defineAction({
      id: "test.counter",
      async run(_input: unknown, ctx) {
        const prefix = ctx.config.get("PREFIX", "Count:");
        const current = (await ctx.state.get<number>("count")) || 0;
        const next = current + 1;
        await ctx.state.set("count", next);
        ctx.log.info(`Updated count to ${next}`);
        return `${prefix} ${next}`;
      },
    });

    const runtime = createTestRuntime({
      config: { PREFIX: "Total:" },
      state: { count: 5 },
    });

    const res1 = await runtime.run(counterAction, {});
    expect(res1).toBe("Total: 6");
    expect(await runtime.state.get<number>("count")).toBe(6);

    const res2 = await runtime.run(counterAction, {});
    expect(res2).toBe("Total: 7");
    expect(await runtime.state.get<number>("count")).toBe(7);

    expect(runtime.logger.logs.length).toBe(2);
    expect(runtime.logger.logs[0].message).toContain("Updated count to 6");
  });

  it("supports MemoryConfig get, set, has, and fallback defaults", () => {
    const config = new MemoryConfig({ API_KEY: "secret_123" });
    expect(config.has("API_KEY")).toBe(true);
    expect(config.has("NON_EXISTENT")).toBe(false);
    expect(config.get<string>("API_KEY")).toBe("secret_123");
    expect(config.get("NON_EXISTENT")).toBeUndefined();
    expect(config.get("NON_EXISTENT", "default_val")).toBe("default_val");

    config.set("NEW_KEY", 42);
    expect(config.get<number>("NEW_KEY")).toBe(42);
    expect(config.has("NEW_KEY")).toBe(true);
  });

  it("supports MemoryStateStore scoping, prefix listing, and deletion", async () => {
    const store = new MemoryStateStore();
    await store.set("global_k1", "v1");
    await store.set("global_k2", "v2");

    const userScope = store.scope("users");
    await userScope.set("alice", { age: 30 });
    await userScope.set("bob", { age: 25 });

    // Isolation check
    expect(await store.get<string>("global_k1")).toBe("v1");
    expect(await userScope.get<{ age: number }>("alice")).toEqual({ age: 30 });
    expect(await store.get("alice")).toBeUndefined();

    // Deep copy verification (structuredClone)
    const obj = { nested: { val: 100 } };
    await store.set("nested_obj", obj);
    obj.nested.val = 200;
    const fetched = await store.get<{ nested: { val: number } }>("nested_obj");
    expect(fetched?.nested.val).toBe(100);

    // Keys listing with prefix
    const rootKeys = await store.keys();
    expect(rootKeys.sort()).toEqual(["global_k1", "global_k2", "nested_obj"]);

    const userKeys = await userScope.keys();
    expect(userKeys.sort()).toEqual(["alice", "bob"]);

    const userKeysFiltered = await userScope.keys("al");
    expect(userKeysFiltered).toEqual(["alice"]);

    // Deletion (returns boolean)
    const deleted = await userScope.delete("alice");
    expect(deleted).toBe(true);
    expect(await userScope.get("alice")).toBeUndefined();
    expect(await userScope.keys()).toEqual(["bob"]);

    const deleteNonExistent = await userScope.delete("alice");
    expect(deleteNonExistent).toBe(false);

    // Clear
    const cleared = await userScope.clear();
    expect(cleared).toBe(1); // bob
    expect(await userScope.keys()).toEqual([]);
  });

  it("supports MemoryStateStore with colon-containing keys and nested scopes", async () => {
    const store = new MemoryStateStore();

    // Root keys with colons
    await store.set("key:with:colon", "value-colon");
    expect(await store.get<string>("key:with:colon")).toBe("value-colon");
    expect(await store.keys()).toContain("key:with:colon");

    // Scoped keys with colons
    const scoped = store.scope("sub:ns");
    await scoped.set("another:colon:key", "value-nested");
    expect(await scoped.get<string>("another:colon:key")).toBe("value-nested");
    expect(await scoped.keys()).toEqual(["another:colon:key"]);

    // Root store should not expose scoped keys
    expect(await store.get("another:colon:key")).toBeUndefined();
    expect(await store.keys()).not.toContain("another:colon:key");

    // Clear with colon key
    const deleted = await scoped.delete("another:colon:key");
    expect(deleted).toBe(true);
    expect(await scoped.get("another:colon:key")).toBeUndefined();
    expect(await scoped.keys()).toEqual([]);

    // Namespace collision test: namespace a:b + key c vs namespace a + key b:c
    const storeAB = store.scope("a:b");
    const storeA = store.scope("a");
    await storeAB.set("c", "val-ab-c");
    await storeA.set("b:c", "val-a-bc");

    expect(await storeAB.get<string>("c")).toBe("val-ab-c");
    expect(await storeA.get<string>("b:c")).toBe("val-a-bc");
    expect(await storeAB.get("b:c")).toBeUndefined();
    expect(await storeA.get("c")).toBeUndefined();
  });

  it("supports MemoryLogger debug, info, warn, and error levels with data", () => {
    const logger = new MemoryLogger();
    logger.debug("debug message", { d: 1 });
    logger.info("info message", { i: 2 });
    logger.warn("warn message", { w: 3 });
    logger.error("error message", { e: 4 });

    expect(logger.logs.length).toBe(4);
    expect(logger.logs[0]).toEqual({ level: "debug", message: "debug message", data: { d: 1 } });
    expect(logger.logs[1]).toEqual({ level: "info", message: "info message", data: { i: 2 } });
    expect(logger.logs[2]).toEqual({ level: "warn", message: "warn message", data: { w: 3 } });
    expect(logger.logs[3]).toEqual({ level: "error", message: "error message", data: { e: 4 } });
  });

  it("supports action-to-action invocation", async () => {
    const childAction = defineAction({
      id: "test.child",
      run: (input: { val: number }) => input.val * 2,
    });

    const parentAction = defineAction({
      id: "test.parent",
      async run(input: { val: number }, ctx) {
        const doubled = await ctx.actions.invoke(childAction, { val: input.val });
        return { result: doubled + 1 };
      },
    });

    const runtime = createTestRuntime();
    const res = await runtime.run(parentAction, { val: 10 });
    expect(res).toEqual({ result: 21 });
  });

  it("supports action invocation by string ID and ActionRef", async () => {
    const childAction = defineAction({
      id: "child",
      run: (input: { val: number }) => input.val * 3,
    });

    const parentAction = defineAction({
      id: "parent",
      async run(input: { val: number }, ctx) {
        const res1 = await ctx.actions.invoke<{ val: number }, number>("child", { val: input.val });
        const res2 = await ctx.actions.invoke<{ val: number }, number>({ actionId: "child" }, { val: input.val });
        const res3 = await ctx.actions.invoke<{ val: number }, number>("my-pkg/child", { val: input.val });
        const res4 = await ctx.actions.invoke<{ val: number }, number>({ packageId: "my-pkg", actionId: "child" }, { val: input.val });
        return { total: res1 + res2 + res3 + res4 };
      },
    });

    const scopedWorker = defineAction({
      id: "worker",
      run: (input: { msg: string }) => `processed: ${input.msg}`,
    });

    const runtime = createTestRuntime({
      actions: {
        child: childAction,
        "shared-pkg/worker": scopedWorker,
      },
    });
    const res = await runtime.run(parentAction, { val: 5 });
    expect(res).toEqual({ total: 15 + 15 + 15 + 15 });

    // 验证以结构化 ActionRef 指定 packageId 调用以完全限定键名注册的 Action
    const scopedCaller = defineAction({
      id: "caller",
      async run(_input, ctx) {
        return ctx.actions.invoke({ packageId: "shared-pkg", actionId: "worker" }, { msg: "hello" });
      },
    });
    const scopedRes = await runtime.run(scopedCaller, {});
    expect(scopedRes).toBe("processed: hello");
  });

  it("detects recursion/cycle in action invocation", async () => {
    const cycleAction: any = defineAction({
      id: "test.cycle",
      async run(_input: unknown, ctx) {
        return ctx.actions.invoke(cycleAction, {});
      },
    });

    const runtime = createTestRuntime();
    expect(runtime.run(cycleAction, {})).rejects.toThrow("Cycle detected");
  });

  it("supports full-trace run context (rootId, parentId) in nested action invocation", async () => {
    let capturedParentRun: any;
    let capturedChildRun: any;

    const childAction = defineAction({
      id: "child-worker",
      run(_input: unknown, ctx) {
        capturedChildRun = { ...ctx.run };
        return "child-ok";
      },
    });

    const parentAction = defineAction({
      id: "parent-caller",
      async run(_input: unknown, ctx) {
        capturedParentRun = { ...ctx.run };
        await ctx.actions.invoke(childAction, {});
        return "parent-ok";
      },
    });

    const runtime = createTestRuntime({
      actions: [childAction],
    });

    await runtime.run(parentAction, {});

    expect(capturedParentRun).toBeDefined();
    expect(capturedChildRun).toBeDefined();

    // Parent is root, so rootId equals id and parentId is undefined
    expect(capturedParentRun.id).toBeTruthy();
    expect(capturedParentRun.rootId).toBe(capturedParentRun.id);
    expect(capturedParentRun.parentId).toBeUndefined();

    // Child inherits parent's rootId and sets parentId to parent's id
    expect(capturedChildRun.id).toBeTruthy();
    expect(capturedChildRun.id).not.toBe(capturedParentRun.id);
    expect(capturedChildRun.rootId).toBe(capturedParentRun.rootId);
    expect(capturedChildRun.parentId).toBe(capturedParentRun.id);
  });

  it("handles cross-package same-name action invocation in test runtime without cycle false positive", async () => {
    const localCalc = defineAction({
      id: "calc",
      run: (input: { x: number }) => input.x + 1,
    });

    const extCalc = defineAction({
      id: "calc",
      run: (input: { x: number }) => input.x * 10,
    });

    const caller = defineAction({
      id: "caller",
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
    expect(res).toEqual({ local: 6, ext: 50 });
  });

  it("supports concurrent sub-action invocations without call stack race conditions", async () => {
    const workerAction = defineAction({
      id: "async-worker",
      async run(input: { val: number }) {
        await new Promise((resolve) => setTimeout(resolve, 10));
        return input.val * 2;
      },
    });

    const concurrentCaller = defineAction({
      id: "concurrent-caller",
      async run(_input: unknown, ctx) {
        const results = await Promise.all([
          ctx.actions.invoke(workerAction, { val: 1 }),
          ctx.actions.invoke(workerAction, { val: 2 }),
          ctx.actions.invoke(workerAction, { val: 3 }),
        ]);
        return results;
      },
    });

    const runtime = createTestRuntime({
      actions: [workerAction],
    });

    const results = await runtime.run(concurrentCaller, {});
    expect(results).toEqual([2, 4, 6]);
  });

  it("handles state expiration with TTL in MemoryStateStore", async () => {
    const runtime = createTestRuntime();

    // 1. Set key with TTL (in seconds, 0.05s = 50ms)
    await runtime.state.set("temp-key", "hello", 0.05);
    expect(await runtime.state.get<string>("temp-key")).toBe("hello");
    expect(await runtime.state.keys()).toContain("temp-key");

    // 2. Permanent key
    await runtime.state.set("permanent", "keep-me");

    // Wait for 70ms to allow expiration
    await new Promise((resolve) => setTimeout(resolve, 70));

    expect(await runtime.state.get("temp-key")).toBeUndefined();
    expect(await runtime.state.get<string>("permanent")).toBe("keep-me");

    const remainingKeys = await runtime.state.keys();
    expect(remainingKeys).toEqual(["permanent"]);
  });

  it("executes CLI command safely using ctx.process.exec", async () => {
    const runtime = createTestRuntime();
    const execAction = defineAction({
      id: "test.exec",
      async run(input: { command: string; args?: string[]; options?: any }, ctx) {
        return await ctx.process.exec(input.command, input.args, input.options);
      },
    });

    // 1. Successful execution
    const res = await runtime.run(execAction, { command: "bun", args: ["--version"] });
    expect(res.ok).toBe(true);
    expect(res.exitCode).toBe(0);
    expect(res.stdout.length).toBeGreaterThan(0);
    expect(res.raw.length).toBeGreaterThan(0);
    expect(res.durationMs).toBeGreaterThanOrEqual(0);

    // 2. Stdin piping support (string input)
    const stdinRes = await runtime.run(execAction, {
      command: "cat",
      args: [],
      options: { input: "Hello ActionDock Stdin" },
    });
    expect(stdinRes.ok).toBe(true);
    expect(stdinRes.stdout).toBe("Hello ActionDock Stdin");

    // 3. Stdin piping support (Uint8Array input)
    const u8Input = new TextEncoder().encode("Binary Stdin");
    const u8Res = await runtime.run(execAction, {
      command: "cat",
      args: [],
      options: { input: u8Input },
    });
    expect(u8Res.ok).toBe(true);
    expect(u8Res.stdout).toBe("Binary Stdin");

    // 4. Custom env & cwd
    const envRes = await runtime.run(execAction, {
      command: "sh",
      args: ["-c", "echo $MY_CUSTOM_VAR"],
      options: { env: { MY_CUSTOM_VAR: "actiondock_val" } },
    });
    expect(envRes.ok).toBe(true);
    expect(envRes.stdout).toBe("actiondock_val");

    // 5. Timeout and timedOut flag
    const timedOutRes = await runtime.run(execAction, {
      command: "sleep",
      args: ["2"],
      options: { timeoutMs: 100 },
    });
    expect(timedOutRes.ok).toBe(false);
    expect(timedOutRes.timedOut).toBe(true);
    expect(timedOutRes.exitCode).toBe(-1);
    expect(timedOutRes.stderr).toContain("timed out");

    // 6. Non-existent command
    const notFound = await runtime.run(execAction, {
      command: "__non_existent_binary_xyz_123__",
    });
    expect(notFound.ok).toBe(false);
    expect(notFound.exitCode).toBe(-1);
    expect(notFound.stderr).toContain("not found in PATH");

    // 7. throwOnError support
    await expect(
      runtime.run(execAction, {
        command: "__non_existent_binary_xyz_123__",
        options: { throwOnError: true },
      })
    ).rejects.toThrow();

    // 8. Aborted signal
    const controller = new AbortController();
    controller.abort();
    const aborted = await runtime.run(execAction, {
      command: "bun",
      args: ["--version"],
      options: { signal: controller.signal },
    });
    expect(aborted.ok).toBe(false);
    expect(aborted.exitCode).toBe(-1);
    expect(aborted.stderr).toContain("aborted");
  });

  it("executes daemon-spawning CLI safely using ctx.process.spawnDetached", async () => {
    const runtime = createTestRuntime();
    const spawnAction = defineAction({
      id: "test.spawn-detached",
      async run(input: any, ctx) {
        return await ctx.process.spawnDetached(input);
      },
    });

    // 1. Successful execution and immediate probe success
    let probeCount = 0;
    const okRes = await runtime.run(spawnAction, {
      command: "bun",
      args: ["--version"],
      probe: () => {
        probeCount++;
        return true;
      },
    });
    expect(okRes.ready).toBe(true);
    expect(probeCount).toBe(1);

    // 2. Multi-step polling until probe becomes true
    let pollCount = 0;
    const polledRes = await runtime.run(spawnAction, {
      command: "bun",
      args: ["--version"],
      probeIntervalMs: 20,
      probeTimeoutMs: 1000,
      probe: async () => {
        pollCount++;
        return pollCount >= 3;
      },
    });
    expect(polledRes.ready).toBe(true);
    expect(pollCount).toBe(3);

    // 3. Timeout when probe never succeeds
    const timedOutRes = await runtime.run(spawnAction, {
      command: "bun",
      args: ["--version"],
      probeIntervalMs: 20,
      probeTimeoutMs: 100,
      probe: () => false,
    });
    expect(timedOutRes.ready).toBe(false);
  });

  it("enforces input and output schema validation throwing ActionRuntimeError", async () => {
    const runtime = createTestRuntime();

    const strictAction = defineAction({
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
      run(input: any) {
        if (input.count === -1) {
          return { valid: "not-a-bool" as any };
        }
        return { valid: true };
      },
    });

    // Input validation failure
    try {
      await runtime.run(strictAction, { count: "not-a-number" } as any);
      expect(true).toBe(false);
    } catch (err: any) {
      expect(err.code).toBe("INPUT_VALIDATION_FAILED");
    }

    // Output validation failure
    try {
      await runtime.run(strictAction, { count: -1 });
      expect(true).toBe(false);
    } catch (err: any) {
      expect(err.code).toBe("OUTPUT_VALIDATION_FAILED");
    }

    // Successful run
    const res = await runtime.run(strictAction, { count: 10 });
    expect(res).toEqual({ valid: true });
  });

  it("detects cyclic action invocations and throws ACTION_CYCLE_DETECTED", async () => {
    let loopA: any;
    let loopB: any;

    loopA = defineAction({
      id: "test.loop-a",
      async run(_input: any, ctx) {
        return ctx.actions.invoke(loopB, {});
      },
    });

    loopB = defineAction({
      id: "test.loop-b",
      async run(_input: any, ctx) {
        return ctx.actions.invoke(loopA, {});
      },
    });

    const runtime = createTestRuntime({
      actions: [loopA, loopB],
    });

    try {
      await runtime.run(loopA, {});
      expect(true).toBe(false);
    } catch (err: any) {
      expect(err.code).toBe("ACTION_CYCLE_DETECTED");
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

    expect(runtime1.config.get<string>("KEY")).toBe("value1");
    expect(runtime2.config.get<string>("KEY")).toBe("value2");

    await runtime1.state.set("item", "updated1");
    expect(await runtime1.state.get<string>("item")).toBe("updated1");
    expect(await runtime2.state.get<string>("item")).toBe("state2");

    // TTL expiry test
    await runtime1.state.set("temp", "expiring", 0.001); // 1 millisecond
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(await runtime1.state.get("temp")).toBeUndefined();
  });
});

