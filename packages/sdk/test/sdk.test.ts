import { describe, expect, it } from "bun:test";
import {
  createTestRuntime,
  defineAction,
  MemoryConfig,
  MemoryLogger,
  MemoryStateStore,
} from "../src";

describe("@actiondock/sdk", () => {
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
});

