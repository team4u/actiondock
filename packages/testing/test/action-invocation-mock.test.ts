import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  defineAction,
  type ActionRef,
} from "@actiondock/sdk";
import {
  createTestRuntime,
  MockActionInvoker,
  ActionRuntimeError,
  FakeClock,
} from "../src";
import {
  ActionDockError,
  ACTION_FAILED,
  ACTION_CALL_CYCLE,
  ACTION_CANCELLED,
  UNDECLARED_ACTION_DEPENDENCY,
  INPUT_VALIDATION_FAILED,
  OUTPUT_VALIDATION_FAILED,
  INVALID_ACTION_REF,
  INVALID_ARGUMENT,
} from "@actiondock/core";

describe("Action 调用模拟器与多目标绑定模拟 (action-invocation-mock)", () => {
  it("普通返回与异常模拟验证", async () => {
    const runtime = createTestRuntime({ packageId: "app" });

    runtime.actions.register("ext/echo", (input: { msg: string }) => {
      return { echoed: input.msg };
    });
    runtime.actions.register("ext/fail", () => {
      throw new Error("Simulated downstream failure");
    });

    const caller = defineAction({
      uses: ["ext/echo", "ext/fail"],
      run: async (input: { mode: "ok" | "err" }, ctx) => {
        if (input.mode === "ok") {
          return await ctx.actions.invoke("ext/echo", { msg: "hello" });
        }
        return await ctx.actions.invoke("ext/fail", {});
      },
    });

    const okResult = await runtime.run(caller, { mode: "ok" });
    assert.deepStrictEqual(okResult, { echoed: "hello" });

    await assert.rejects(
      async () => {
        await runtime.run(caller, { mode: "err" });
      },
      (err: any) => {
        assert.ok(err instanceof ActionRuntimeError);
        assert.strictEqual(err.code, ACTION_FAILED);
        assert.match(err.message, /Simulated downstream failure/);
        return true;
      }
    );
  });

  it("同一 Action 中对完全相同 ref 进行 primary 失败并显式 fallback 成功", async () => {
    const runtime = createTestRuntime({ packageId: "app" });

    runtime.actions.register(
      "remote-calc/compute",
      () => {
        throw new ActionDockError("NETWORK_ERROR", "Primary remote service timeout");
      },
      { binding: "primary" }
    );

    runtime.actions.register(
      "remote-calc/compute",
      (input: { val: number }) => {
        return { val: input.val * 10, source: "fallback-worker" };
      },
      { binding: "fallback" }
    );

    const caller = defineAction({
      uses: ["remote-calc/compute"],
      run: async (input: { val: number }, ctx) => {
        try {
          return await ctx.actions.invoke(
            "remote-calc/compute",
            { val: input.val },
            { binding: "primary" }
          );
        } catch (err: any) {
          if (ctx.signal?.aborted) {
            throw err;
          }
          if (err instanceof ActionDockError && err.code === "NETWORK_ERROR") {
            return await ctx.actions.invoke(
              "remote-calc/compute",
              { val: input.val },
              { binding: "fallback" }
            );
          }
          throw err;
        }
      },
    });

    const result = await runtime.run(caller, { val: 5 });
    assert.deepStrictEqual(result, { val: 50, source: "fallback-worker" });

    const calls = runtime.actions.calls;
    assert.strictEqual(calls.length, 2);
    assert.strictEqual(calls[0].ref, "remote-calc/compute");
    assert.strictEqual(calls[0].binding, "primary");
    assert.deepStrictEqual(calls[0].input, { val: 5 });
    assert.strictEqual(calls[1].ref, "remote-calc/compute");
    assert.strictEqual(calls[1].binding, "fallback");
    assert.deepStrictEqual(calls[1].input, { val: 5 });
  });

  it("支持 callable 函数第三参传递 invoke options 与命名绑定", async () => {
    const runtime = createTestRuntime({ packageId: "app" });

    runtime.actions.register(
      "ext/worker",
      (input: { task: string }) => ({ done: input.task, role: "primary-worker" }),
      { binding: "primary" }
    );

    const caller = defineAction({
      uses: ["ext/worker"],
      run: async (_input, ctx) => {
        // 使用 callable 形式: ctx.actions(ref, input, options)
        const res = await (ctx.actions as any)(
          "ext/worker",
          { task: "sync" },
          { binding: "primary" }
        );
        return res;
      },
    });

    const res = await runtime.run(caller, {});
    assert.deepStrictEqual(res, { done: "sync", role: "primary-worker" });

    const calls = runtime.actions.getCalls("ext/worker", { binding: "primary" });
    assert.strictEqual(calls.length, 1);
    assert.strictEqual(calls[0].binding, "primary");
  });

  it("支持 ActionRef 对象作为入参及未命名 vs 显式 default 等价", async () => {
    const runtime = createTestRuntime({ packageId: "app" });

    runtime.actions.register(
      "service/process",
      (input: { val: number }) => ({ val: input.val + 1 }),
      { binding: "default" }
    );

    const caller = defineAction({
      uses: ["service/process"],
      run: async (_input, ctx) => {
        const refObj: ActionRef = { packageId: "service", actionId: "process" };
        // 未传 binding 视为 default
        const res1 = await ctx.actions.invoke(refObj, { val: 10 });
        // 显式 default 等价
        const res2 = await ctx.actions.invoke(refObj, { val: 20 }, { binding: "default" });
        return { res1, res2 };
      },
    });

    const res = await runtime.run(caller, {});
    assert.deepStrictEqual(res, {
      res1: { val: 11 },
      res2: { val: 21 },
    });

    const calls = runtime.actions.calls;
    assert.strictEqual(calls.length, 2);
    assert.strictEqual(calls[0].binding, "default");
    assert.strictEqual(calls[1].binding, "default");
  });

  it("调用记录输入快照保证不可变性与顺序记录真实 runId/rootRunId", async () => {
    const runtime = createTestRuntime({ packageId: "app" });

    runtime.actions.register("ext/mutate", (input: { list: number[] }) => {
      // 模拟下游修改入参
      input.list.push(999);
      return { count: input.list.length };
    });

    const caller = defineAction({
      uses: ["ext/mutate"],
      run: async (_input, ctx) => {
        const payload = { list: [1, 2, 3] };
        await ctx.actions.invoke("ext/mutate", payload);
        // 上游也变异入参
        payload.list.push(888);
        return { ok: true };
      },
    });

    await runtime.run(caller, {});

    const calls = runtime.actions.calls;
    assert.strictEqual(calls.length, 1);
    // 验证记录下来的快照依然是初始值 [1, 2, 3]，未被污染
    assert.deepStrictEqual(calls[0].input, { list: [1, 2, 3] });
    assert.ok(calls[0].runId);
    assert.ok(calls[0].rootRunId);
  });

  it("registerOnce 按顺序消费并在耗尽后明确失败，不复用最后响应", async () => {
    const runtime = createTestRuntime({ packageId: "app" });

    runtime.actions
      .registerOnce("ext/counter", { count: 1 }, { binding: "primary" })
      .registerOnce("ext/counter", { count: 2 }, { binding: "primary" });

    const caller = defineAction({
      uses: ["ext/counter"],
      run: async (input: { step: number }, ctx) => {
        return await ctx.actions.invoke("ext/counter", input, { binding: "primary" });
      },
    });

    const r1 = await runtime.run(caller, { step: 1 });
    assert.deepStrictEqual(r1, { count: 1 });

    const r2 = await runtime.run(caller, { step: 2 });
    assert.deepStrictEqual(r2, { count: 2 });

    // 第三次调用一次性规则已耗尽且无 persistent 规则，明确抛错
    await assert.rejects(
      async () => {
        await runtime.run(caller, { step: 3 });
      },
      (err: any) => {
        assert.ok(err instanceof ActionRuntimeError);
        assert.strictEqual(err.code, ACTION_FAILED);
        assert.match(err.message, /No mock rule available/);
        return true;
      }
    );
  });

  it("registerOnce 耗尽后可由显式 persistent 规则接替", async () => {
    const runtime = createTestRuntime({ packageId: "app" });

    runtime.actions
      .registerOnce("ext/step", { val: "once-1" })
      .register("ext/step", { val: "persistent-fallback" });

    const caller = defineAction({
      uses: ["ext/step"],
      run: async (_input, ctx) => {
        return await ctx.actions.invoke("ext/step", {});
      },
    });

    const r1 = await runtime.run(caller, {});
    assert.deepStrictEqual(r1, { val: "once-1" });

    const r2 = await runtime.run(caller, {});
    assert.deepStrictEqual(r2, { val: "persistent-fallback" });

    const r3 = await runtime.run(caller, {});
    assert.deepStrictEqual(r3, { val: "persistent-fallback" });
  });

  it("绑定未命中绝不意外回退 default 或真实网络", async () => {
    const runtime = createTestRuntime({ packageId: "app" });

    runtime.actions.register("ext/action", { ok: "default" }, { binding: "default" });

    const caller = defineAction({
      uses: ["ext/action"],
      run: async (_input, ctx) => {
        // 请求未注册的具名绑定 "non-existent"
        return await ctx.actions.invoke("ext/action", {}, { binding: "non-existent" });
      },
    });

    await assert.rejects(
      async () => {
        await runtime.run(caller, {});
      },
      (err: any) => {
        assert.ok(err instanceof ActionRuntimeError);
        // 绑定未命中必须明确失败，不能退回 default
        return true;
      }
    );

    // default 规则的调用记录应当为空
    assert.strictEqual(runtime.actions.calls.length, 0);
  });

  it("未声明 uses 不执行 mock handler", async () => {
    const runtime = createTestRuntime({ packageId: "app" });

    let handlerExecuted = false;
    runtime.actions.register("ext/secure", () => {
      handlerExecuted = true;
      return { secret: "123" };
    }, { binding: "primary" });

    // 未在 uses 中声明 ext/secure
    const caller = defineAction({
      uses: [],
      run: async (_input, ctx) => {
        return await ctx.actions.invoke("ext/secure", {}, { binding: "primary" });
      },
    });

    await assert.rejects(
      async () => {
        await runtime.run(caller, {});
      },
      (err: any) => {
        assert.ok(err instanceof ActionRuntimeError);
        assert.strictEqual(err.code, UNDECLARED_ACTION_DEPENDENCY);
        return true;
      }
    );

    assert.strictEqual(handlerExecuted, false);
    assert.strictEqual(runtime.actions.calls.length, 0);
  });

  it("真实 Schema 校验拒绝非法输入与非法输出", async () => {
    const runtime = createTestRuntime({ packageId: "app" });

    let handlerExecuted = false;
    runtime.actions.register(
      "ext/validated",
      (input: { num: number }) => {
        handlerExecuted = true;
        if (input.num === 0) {
          // 故意返回不符合 outputSchema 的非法格式
          return { str: 12345 } as any;
        }
        return { str: `valid:${input.num}` };
      },
      {
        binding: "default",
        contract: {
          inputSchema: {
            type: "object",
            properties: { num: { type: "number", minimum: 0 } },
            required: ["num"],
          },
          outputSchema: {
            type: "object",
            properties: { str: { type: "string" } },
            required: ["str"],
          },
        },
      }
    );

    const caller = defineAction({
      uses: ["ext/validated"],
      run: async (input: { num: any }, ctx) => {
        return await ctx.actions.invoke("ext/validated", input);
      },
    });

    // 1. 测试输入非法：传入负数
    handlerExecuted = false;
    await assert.rejects(
      async () => {
        await runtime.run(caller, { num: -1 });
      },
      (err: any) => {
        assert.ok(err instanceof ActionRuntimeError);
        assert.strictEqual(err.code, INPUT_VALIDATION_FAILED);
        return true;
      }
    );
    assert.strictEqual(handlerExecuted, false);

    // 2. 测试输出非法：模拟 handler 返回不符合 schema 的数据
    await assert.rejects(
      async () => {
        await runtime.run(caller, { num: 0 });
      },
      (err: any) => {
        assert.ok(err instanceof ActionRuntimeError);
        assert.strictEqual(err.code, OUTPUT_VALIDATION_FAILED);
        return true;
      }
    );

    // 3. 测试合法输入输出
    const okRes = await runtime.run(caller, { num: 42 });
    assert.deepStrictEqual(okRes, { str: "valid:42" });
  });

  it("父取消中断执行且停止下游 mock", async () => {
    const runtime = createTestRuntime({ packageId: "app" });

    let started!: () => void;
    const ready = new Promise<void>((resolve) => { started = resolve; });
    runtime.actions.register("ext/long-job", (_input, ctx) => {
      const result = new Promise<never>((_resolve, reject) => {
        ctx.signal.addEventListener("abort", () => {
          reject(new ActionDockError(ACTION_CANCELLED, "Mock aborted by caller"));
        }, { once: true });
      });
      started();
      return result;
    }, { binding: "primary" });
    runtime.actions.register("ext/long-job", { done: true }, { binding: "fallback" });

    const caller = defineAction({
      uses: ["ext/long-job"],
      run: async (_input, ctx) => {
        try {
          return await ctx.actions.invoke("ext/long-job", {}, { binding: "primary" });
        } catch (error: any) {
          if (ctx.signal.aborted || error.code !== "NETWORK_ERROR") throw error;
          return ctx.actions.invoke("ext/long-job", {}, { binding: "fallback" });
        }
      },
    });

    const ac = new AbortController();
    const execPromise = runtime.execute(caller, {}, { signal: ac.signal });
    await ready;
    ac.abort();

    const result = await execPromise;
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.error?.code, ACTION_CANCELLED);
    assert.equal(runtime.actions.getCalls("ext/long-job", { binding: "primary" }).length, 1);
    assert.equal(runtime.actions.getCalls("ext/long-job", { binding: "fallback" }).length, 0);
  });

  it("环路死锁检测与深度治理依然生效", async () => {
    const runtime = createTestRuntime({ packageId: "app" });

    // 注册递归互调，显式声明 uses: ['app/caller']
    runtime.actions.register(
      "ext/cycle",
      async (_input, ctx) => {
        return await ctx.actions.invoke("app/caller", {});
      },
      {
        contract: {
          uses: ["app/caller"],
        },
      }
    );

    const caller = defineAction({
      id: "caller",
      uses: ["ext/cycle"],
      run: async (_input, ctx) => {
        return await ctx.actions.invoke("ext/cycle", {});
      },
    });
    runtime.registerAction("caller", caller);

    await assert.rejects(
      async () => {
        await runtime.run(caller, {});
      },
      (err: any) => {
        assert.ok(err instanceof ActionRuntimeError);
        assert.strictEqual(err.code, ACTION_CALL_CYCLE);
        return true;
      }
    );
  });

  it("MockActionInvoker 实例隔离性与复用注入", async () => {
    const sharedMock = new MockActionInvoker("shared");
    sharedMock.register("tool/calc", { val: 100 });

    const runtime1 = createTestRuntime({ packageId: "app1", actionsMock: sharedMock });
    const runtime2 = createTestRuntime({ packageId: "app2", actionsMock: sharedMock });
    const runtime3 = createTestRuntime({ packageId: "app3" }); // 独立新实例

    const caller = defineAction({
      uses: ["tool/calc"],
      run: async (_input, ctx) => ctx.actions.invoke("tool/calc", {}),
    });

    const r1 = await runtime1.run(caller, {});
    const r2 = await runtime2.run(caller, {});
    assert.deepStrictEqual(r1, { val: 100 });
    assert.deepStrictEqual(r2, { val: 100 });

    assert.strictEqual(sharedMock.calls.length, 2);
    assert.strictEqual(runtime3.actions.calls.length, 0);
  });

  it("clearHistory 与 reset 状态治理语义", async () => {
    const runtime = createTestRuntime({ packageId: "app" });

    runtime.actions.register("ext/work", { done: true }, { binding: "primary" });

    const caller = defineAction({
      uses: ["ext/work"],
      run: async (_input, ctx) => ctx.actions.invoke("ext/work", {}, { binding: "primary" }),
    });

    await runtime.run(caller, {});
    assert.strictEqual(runtime.actions.calls.length, 1);

    const revBeforeClear = runtime.actions.revision;
    runtime.actions.clearHistory();
    assert.strictEqual(runtime.actions.calls.length, 0);
    // clearHistory 仅清空历史，不递增版本序号，规则依然保留
    assert.strictEqual(runtime.actions.revision, revBeforeClear);

    const r2 = await runtime.run(caller, {});
    assert.deepStrictEqual(r2, { done: true });
    assert.strictEqual(runtime.actions.calls.length, 1);

    // reset 清空规则和历史，并递增版本序号
    runtime.actions.reset();
    assert.strictEqual(runtime.actions.calls.length, 0);
    assert.ok(runtime.actions.revision > revBeforeClear);

    await assert.rejects(async () => {
      await runtime.run(caller, {});
    });
  });

  it("已有 Host 缓存后同名规则替换与 revision 驱逐生效", async () => {
    const runtime = createTestRuntime({ packageId: "app" });

    runtime.actions.register("ext/val", { value: "v1" });

    const caller = defineAction({
      uses: ["ext/val"],
      run: async (_input, ctx) => ctx.actions.invoke("ext/val", {}),
    });

    // 首次运行建立 Host 服务缓存
    const res1 = await runtime.run(caller, {});
    assert.deepStrictEqual(res1, { value: "v1" });

    // 覆盖注册相同引用相同绑定的新规则
    runtime.actions.register("ext/val", { value: "v2-updated" });

    // 再次运行必须执行新规则，而非旧缓存
    const res2 = await runtime.run(caller, {});
    assert.deepStrictEqual(res2, { value: "v2-updated" });
  });

  it("兼容原有 options.actions / registerAction 本地无绑定替身动作与 Mock 混合运行", async () => {
    const runtime = createTestRuntime({
      packageId: "app",
      actions: [
        {
          id: "local-helper",
          action: defineAction({
            run: () => ({ helper: "local-native" }),
          }),
        },
      ],
    });

    runtime.actions.register("remote/service", { remote: true }, { binding: "cloud" });

    const caller = defineAction({
      uses: ["local-helper", "remote/service"],
      run: async (_input, ctx) => {
        const local = await ctx.actions.invoke("local-helper", {});
        const remote = await ctx.actions.invoke("remote/service", {}, { binding: "cloud" });
        return { local, remote };
      },
    });

    const res = await runtime.run(caller, {});
    assert.deepStrictEqual(res, {
      local: { helper: "local-native" },
      remote: { remote: true },
    });
  });

  it("非法 ActionRef 与非法 binding 选项严格拒绝", () => {
    const invoker = new MockActionInvoker("test-pkg");

    // 拒绝非法 ref
    assert.throws(
      () => invoker.register("" as any, { ok: true }),
      (err: any) => err instanceof ActionDockError && err.code === INVALID_ACTION_REF
    );
    assert.throws(
      () => invoker.register("invalid:colon", { ok: true }),
      (err: any) => err instanceof ActionDockError && err.code === INVALID_ACTION_REF
    );
    assert.throws(
      () => invoker.register(null as any, { ok: true }),
      (err: any) => err instanceof ActionDockError && err.code === INVALID_ACTION_REF
    );
    assert.throws(
      () => invoker.register({} as any, { ok: true }),
      (err: any) => err instanceof ActionDockError && err.code === INVALID_ACTION_REF
    );

    // 拒绝非法 binding 与未知 options
    assert.throws(
      () => invoker.register("tool/calc", { ok: true }, { binding: "" }),
      (err: any) => err instanceof ActionDockError && err.code === INVALID_ARGUMENT
    );
    assert.throws(
      () => invoker.register("tool/calc", { ok: true }, { binding: 123 as any }),
      (err: any) => err instanceof ActionDockError && err.code === INVALID_ARGUMENT
    );
    assert.throws(
      () => invoker.register("tool/calc", { ok: true }, { unknownProp: 42 } as any),
      (err: any) => err instanceof ActionDockError && err.code === INVALID_ARGUMENT
    );
    assert.throws(
      () => invoker.hasRule("tool/calc", ""),
      (err: any) => err instanceof ActionDockError && err.code === INVALID_ARGUMENT
    );
    assert.throws(
      () => invoker.getCalls("tool/calc", { binding: "" }),
      (err: any) => err instanceof ActionDockError && err.code === INVALID_ARGUMENT
    );

    // 支持 @scope/pkg/action 引用
    invoker.register("@scope/pkg/action", { scoped: true });
    assert.strictEqual(invoker.hasRule("@scope/pkg/action"), true);
  });

  it("once 队列耗尽后保留已配置键且不恢复真实定义", async () => {
    const runtime = createTestRuntime({ packageId: "app" });

    runtime.actions.registerOnce("svc/task", { step: 1 }, { binding: "primary" });
    assert.strictEqual(runtime.actions.hasRule("svc/task", "primary"), true);

    const caller = defineAction({
      uses: ["svc/task"],
      run: async (_input, ctx) => {
        return await ctx.actions.invoke("svc/task", {}, { binding: "primary" });
      },
    });

    const res1 = await runtime.run(caller, {});
    assert.deepStrictEqual(res1, { step: 1 });

    // 队列耗尽后 hasRule 依然为 true，使真实 Runner 进入 handleInvocation 并抛出无可用规则错误
    assert.strictEqual(runtime.actions.hasRule("svc/task", "primary"), true);

    await assert.rejects(
      async () => {
        await runtime.run(caller, {});
      },
      (err: any) => {
        assert.ok(err instanceof ActionRuntimeError);
        assert.strictEqual(err.code, ACTION_FAILED);
        assert.match(err.message, /No mock rule available/);
        return true;
      }
    );
  });

  it("静态结果隔离返回独立深拷贝副本", async () => {
    const runtime = createTestRuntime({ packageId: "app" });

    const sharedData = { items: [1, 2], meta: { flag: true } };
    runtime.actions.register("ext/data", sharedData);

    const caller = defineAction({
      uses: ["ext/data"],
      run: async (_input, ctx) => {
        const res = (await ctx.actions.invoke("ext/data", {})) as typeof sharedData;
        // 尝试就地篡改返回值
        res.items.push(999);
        res.meta.flag = false;
        return res;
      },
    });

    const r1 = await runtime.run(caller, {});
    assert.deepStrictEqual(r1.items, [1, 2, 999]);

    // 第二次调用获取到的静态结果不应被第一次调用污染
    const r2 = await runtime.run(caller, {});
    assert.deepStrictEqual(r2.items, [1, 2, 999]);
    assert.deepStrictEqual(sharedData.items, [1, 2]);
    assert.strictEqual(sharedData.meta.flag, true);
  });

  it("契约合并支持 boolean Schema 且拒绝冲突显式契约", () => {
    const invoker = new MockActionInvoker("my-pkg");

    // 1. 注册 boolean 契约并与后续规则合并
    invoker.register("ext/check", { ok: true }, {
      contract: {
        inputSchema: false,
        outputSchema: { type: "object" },
      },
    });

    const contract1 = invoker.getContract("ext/check");
    assert.strictEqual(contract1?.inputSchema, false);
    assert.deepStrictEqual(contract1?.outputSchema, { type: "object" });

    // 2. 相同引用的不同规则显式契约不一致时应在注册阶段拒绝
    assert.throws(
      () => {
        invoker.register("ext/check", { ok: false }, {
          binding: "secondary",
          contract: {
            inputSchema: { type: "string" }, // 与 false 冲突
          },
        });
      },
      (err: any) => err instanceof ActionDockError && err.code === INVALID_ARGUMENT
    );
  });

  it("通过 FakeClock 确定性获取调用记录时间戳", async () => {
    const fixedTimestamp = 1700000000000;
    const fakeClock = new FakeClock({ now: fixedTimestamp });
    const invoker = new MockActionInvoker("app", fakeClock);

    invoker.register("ext/timed", { ok: true });
    const runtime = createTestRuntime({ packageId: "app", clock: fakeClock, actionsMock: invoker });
    const result = await runtime.execute(defineAction({
      uses: ["ext/timed"], run: (_input, ctx) => ctx.actions.invoke("ext/timed", {}),
    }));
    assert.equal(result.ok, true);
    const calls = invoker.calls;
    assert.strictEqual(calls.length, 1);
    assert.strictEqual(calls[0].timestamp, fixedTimestamp);
    assert.ok(calls[0].runId);
    assert.notEqual(calls[0].runId, result.runId);
    assert.strictEqual(calls[0].rootRunId, result.runId);
  });
});
