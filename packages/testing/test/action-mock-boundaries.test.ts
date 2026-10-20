import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { defineAction } from "@actiondock/sdk";
import { createTestRuntime, MemoryStorage } from "../src";

function caller(ref: string, binding?: string) {
  return defineAction({
    uses: [ref],
    run: (_input, ctx) => ctx.actions.invoke(ref, {}, binding === undefined ? undefined : { binding }),
  });
}

describe("动作模拟接入边界", () => {
  it("支持 scoped 包引用和编程式动作名称，显式 default 与省略绑定一致", async () => {
    const runtime = createTestRuntime({ packageId: "app" });
    runtime.actions.register("@scope/math/calcFast", { value: 3 });
    assert.deepEqual(await runtime.run(caller("@scope/math/calcFast")), { value: 3 });
    assert.deepEqual(await runtime.run(caller("@scope/math/calcFast", "default")), { value: 3 });
    assert.deepEqual(runtime.actions.calls.map((call) => [call.ref, call.binding]), [
      ["@scope/math/calcFast", "default"], ["@scope/math/calcFast", "default"],
    ]);
  });

  it("默认与命名模拟按字段继承已注册动作契约，不能丢失输出校验", async () => {
    for (const binding of [undefined, "primary"]) {
      const runtime = createTestRuntime({
        packageId: "app",
        actions: {
          "ext/validated": defineAction({
            inputSchema: true, outputSchema: { type: "number" }, run: () => 1,
          }),
        },
      });
      runtime.actions.register("ext/validated", "wrong", {
        binding, contract: { inputSchema: true },
      });
      const result = await runtime.execute(caller("ext/validated", binding));
      assert.equal(result.ok, false);
      if (!result.ok) assert.equal(result.error.code, "OUTPUT_VALIDATION_FAILED");
    }
  });

  it("同包名的具名独立目标不豁免 uses", async () => {
    const runtime = createTestRuntime({ packageId: "app" });
    runtime.actions.register("app/leaf", {}, { binding: "primary" });
    const result = await runtime.execute(defineAction({
      run: (_input, ctx) => ctx.actions.invoke("app/leaf", {}, { binding: "primary" }),
    }));
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error.code, "UNDECLARED_ACTION_DEPENDENCY");
    assert.equal(runtime.actions.calls.length, 0);
  });

  it("具名模拟目标内部短名自调用立即被同目标环路检查阻断", async () => {
    const runtime = createTestRuntime({ packageId: "app" });
    let entered = 0;
    runtime.actions.register("ext/loop", (_input, ctx) => {
      entered++;
      return ctx.actions.invoke("loop", {});
    }, { binding: "primary" });
    const result = await runtime.execute(caller("ext/loop", "primary"));
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error.code, "ACTION_CALL_CYCLE");
    assert.equal(entered, 1);
  });

  it("命名模拟调用保留真实深度上限", async () => {
    const runtime = createTestRuntime({ packageId: "app" });
    for (let index = 0; index < 18; index++) {
      const next = `ext/layer-${index + 1}`;
      runtime.actions.register(`ext/layer-${index}`, (_input, ctx) =>
        ctx.actions.invoke(next, {}, { binding: "primary" }), {
        binding: "primary", contract: { uses: [next] },
      });
    }
    const result = await runtime.execute(caller("ext/layer-0", "primary"));
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.error.code, "ACTION_CALL_CYCLE");
      assert.match(result.error.message, /Maximum call depth/);
    }
    assert.equal(runtime.actions.calls.length, 15);
  });

  it("模拟子调用遵守配额且结束后释放槽位", async () => {
    const runtime = createTestRuntime({ packageId: "app" });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    runtime.actions.register("ext/job", async () => {
      await gate;
      return { done: true };
    }, { binding: "primary" });
    const root = defineAction({
      uses: ["ext/job"],
      run: async (_input, ctx) => {
        const tasks = Array.from({ length: 65 }, () =>
          ctx.actions.invoke("ext/job", {}, { binding: "primary" }).catch((error) => {
            release();
            throw error;
          })
        );
        const results = await Promise.allSettled(tasks);
        const failed = results.filter((result) => result.status === "rejected");
        const after = await ctx.actions.invoke("ext/job", {}, { binding: "primary" });
        return {
          fulfilled: results.length - failed.length,
          errors: failed.map((result) => result.reason.code), after,
        };
      },
    });
    const result = await runtime.run<unknown, { fulfilled: number; errors: string[]; after: unknown }>(root);
    // 包级执行并发上限 32 与宿主子任务上限 64 同时生效，不因模拟而放宽。
    assert.equal(result.fulfilled, 32);
    assert.equal(result.errors.filter((code) => code === "ACTION_SUBRUN_LIMIT").length, 1);
    assert.equal(result.errors.filter((code) => code === "EXECUTION_CONCURRENCY_LIMIT").length, 32);
    assert.deepEqual(result.after, { done: true });
  });

  it("预先取消的父任务不执行任何模拟处理函数", async () => {
    const runtime = createTestRuntime({ packageId: "app" });
    runtime.actions.register("ext/job", {}, { binding: "primary" });
    const controller = new AbortController();
    controller.abort();
    const result = await runtime.execute(caller("ext/job", "primary"), {}, { signal: controller.signal });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error.code, "ACTION_CANCELLED");
    assert.equal(runtime.actions.calls.length, 0);
  });

  it("未命中绑定时不访问网络，也不误用默认响应", async () => {
    const previousFetch = globalThis.fetch;
    let requests = 0;
    globalThis.fetch = async () => {
      requests++;
      throw new Error("Unexpected network request in unit test");
    };
    try {
      const runtime = createTestRuntime({ packageId: "app" });
      runtime.actions.register("pricing/quote", { price: 1 });
      const result = await runtime.execute(caller("pricing/quote", "missing"));
      assert.equal(result.ok, false);
      if (!result.ok) assert.equal(result.error.code, "NOT_FOUND");
      assert.equal(runtime.actions.calls.length, 0);
      assert.equal(requests, 0);
    } finally {
      globalThis.fetch = previousFetch;
    }
  });

  it("重建宿主不会关闭外部存储或使其他绑定规则失效", async () => {
    const storage = new MemoryStorage();
    const originalClose = storage.close.bind(storage);
    let closes = 0;
    storage.close = async () => { closes++; await originalClose(); };
    try {
      const runtime = createTestRuntime({ packageId: "app", storage });
      runtime.actions.register("ext/value", { value: 1 }, { binding: "primary" });
      const root = caller("ext/value", "primary");
      assert.deepEqual(await runtime.run(root), { value: 1 });
      runtime.actions.register("ext/value", { value: 2 }, { binding: "primary" });
      assert.deepEqual(await runtime.run(root), { value: 2 });
      await runtime.state.set("still-open", true);
      assert.equal(await runtime.state.get("still-open"), true);
      assert.equal(closes, 0);
    } finally { await originalClose(); }
  });

  it("具名模拟的子运行保留事件与父子关联", async () => {
    const runtime = createTestRuntime({ packageId: "app" });
    runtime.actions.register("ext/job", { done: true }, { binding: "primary" });
    const result = await runtime.execute(caller("ext/job", "primary"));
    assert.equal(result.ok, true);
    const call = runtime.actions.calls[0];
    assert.ok(call.runId);
    assert.notEqual(call.runId, result.runId);
    assert.equal(call.rootRunId, result.runId);
    const events = runtime.events.getEvents(call.runId);
    assert.ok(events.some((event) => event.type === "status" && event.status === "running"));
    assert.ok(events.some((event) => event.type === "finish"));
    assert.ok(events.every((event) => event.rootRunId === result.runId));
  });

  it("调用历史的返回值不会污染内部输入快照", async () => {
    const runtime = createTestRuntime({ packageId: "app" });
    runtime.actions.register("ext/echo", {});
    await runtime.run(caller("ext/echo"));
    (runtime.actions.calls[0].input as Record<string, unknown>).changed = true;
    assert.deepEqual(runtime.actions.getCalls("ext/echo")[0].input, {});
    for (const binding of [" primary", "primary ", "constructor"]) {
      assert.throws(() => runtime.actions.register("ext/echo", {}, { binding }));
    }
  });
});
