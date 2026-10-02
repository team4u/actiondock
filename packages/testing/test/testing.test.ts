import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { decodeText, defineAction, type ActionDefinition } from "@actiondock/sdk";
import {
  ActionRuntimeError,
  createTestRuntime,
  FakeClock,
  FakeProcessDriver,
  MemoryStorage,
  MemoryStateStore,
  MockProcessExecutor,
} from "../src";

describe("@actiondock/testing", () => {
  describe("FakeClock", () => {
    it("支持读取基准时间与单调时间", () => {
      const fixedTime = new Date("2026-01-01T00:00:00.000Z");
      const clock = new FakeClock({ now: fixedTime, startMonotonic: 100 });

      assert.strictEqual(clock.now().toISOString(), "2026-01-01T00:00:00.000Z");
      assert.strictEqual(clock.monotonic(), 100);
    });

    it("支持通过 advance 调度单调时间与定时器", async () => {
      const clock = new FakeClock({ startMonotonic: 0 });
      let triggered1 = false;
      let triggered2 = false;

      clock.sleep(100).then(() => {
        triggered1 = true;
      });
      clock.sleep(200).then(() => {
        triggered2 = true;
      });

      assert.strictEqual(clock.pendingCount, 2);

      await clock.advance(50);
      assert.strictEqual(clock.monotonic(), 50);
      assert.strictEqual(triggered1, false);
      assert.strictEqual(triggered2, false);

      await clock.advance(60);
      assert.strictEqual(clock.monotonic(), 110);
      assert.strictEqual(triggered1, true);
      assert.strictEqual(triggered2, false);

      await clock.advance(100);
      assert.strictEqual(clock.monotonic(), 210);
      assert.strictEqual(triggered2, true);
      assert.strictEqual(clock.pendingCount, 0);
    });

    it("单次 advance 内链式 sleep 逐层触发，无需多次推进", async () => {
      const clock = new FakeClock({ startMonotonic: 0 });
      const order: string[] = [];

      // 链式回调：A 触发后才注册 B，B 触发后才注册 C，多层 async 边界叠加
      const chain = (async () => {
        await clock.sleep(10);
        order.push("A");
        await Promise.resolve();
        await Promise.resolve();
        await clock.sleep(5);
        order.push("B");
        await Promise.resolve();
        await Promise.resolve();
        await clock.sleep(5);
        order.push("C");
      })();

      await clock.advance(20);

      // 链上全部节点必须在本次 advance 终点前触发完毕
      assert.deepStrictEqual(order, ["A", "B", "C"]);
      assert.strictEqual(clock.pendingCount, 0);
      await chain;
    });

    it("多层 async 边界内链式注册的到期 sleep 在同一次 advance 内全部触发", async () => {
      const clock = new FakeClock({ startMonotonic: 0 });
      const order: string[] = [];

      const chain = (async () => {
        await clock.sleep(5);
        order.push("X");
        // 三层 await 后再注册下一段 sleep，验证微任务排空深度
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
        await clock.sleep(5);
        order.push("Y");
        await Promise.resolve();
        await clock.sleep(5);
        order.push("Z");
      })();

      await clock.advance(15);

      assert.deepStrictEqual(order, ["X", "Y", "Z"]);
      assert.strictEqual(clock.pendingCount, 0);
      await chain;
    });

    it("推进负数时间时抛出异常", async () => {
      const clock = new FakeClock();
      await assert.rejects(clock.advance(-10), /Cannot advance clock by negative time/);
    });
  });

  describe("MockProcessExecutor", () => {
    it("支持注册匹配规则并记录执行历史", async () => {
      const proc = new MockProcessExecutor();
      proc.register("git status", {
        exitCode: 0,
        stdout: "On branch master\nnothing to commit",
      });

      const res = await proc.run({
        spec: { executable: "git", args: ["status"], io: { mode: "pipe" } },
        timeoutMs: 1000,
        maxOutputBytes: 1024,
      });
      assert.strictEqual(res.exit.code, 0);
      assert.strictEqual(decodeText(res.chunks), "On branch master\nnothing to commit");

      assert.strictEqual(proc.calls.length, 1);
      assert.strictEqual(proc.hasCalled("git"), true);
      assert.deepStrictEqual(proc.getLastCall()?.args, ["status"]);
    });

    it("支持模拟超时与信号取消", async () => {
      const proc = new MockProcessExecutor();
      proc.register("long-task", {
        timedOut: true,
      });
      proc.register("cancel-task", {
        cancelled: true,
      });

      await assert.rejects(
        proc.run({
          spec: { executable: "long-task", args: [], io: { mode: "pipe" } },
          timeoutMs: 1000,
          maxOutputBytes: 1024,
        })
      , /timeout/i);

      await assert.rejects(
        proc.run({
          spec: { executable: "cancel-task", args: [], io: { mode: "pipe" } },
          timeoutMs: 1000,
          maxOutputBytes: 1024,
        })
      , /cancelled/i);
    });

    it("字符串匹配器不再前缀匹配，避免命令名误命中", async () => {
      const driver = new FakeProcessDriver();
      driver.onSpawn = (handle) => {
        driver.emitOutput(handle.id, "stdout", "managed-path");
        driver.emitExit(handle.id, 0);
        driver.emitOutputClosed(handle.id, "natural");
      };
      const proc = new MockProcessExecutor({ driver });
      proc.register("git", { stdout: "should-not-hit" });

      const res = await proc.run({
        spec: { executable: "github-cli", args: ["repo", "list"], io: { mode: "pipe" } },
        timeoutMs: 1000,
        maxOutputBytes: 1024,
      });
      assert.strictEqual(decodeText(res.chunks), "managed-path");
    });

    it("开启 fallbackToReal 后未命中时回退真实异步子进程执行", async () => {
      const proc = new MockProcessExecutor({ fallbackToReal: true });
      const res = await proc.run({
        spec: { executable: "node", args: ["--version"], io: { mode: "pipe" } },
        timeoutMs: 5000,
        maxOutputBytes: 1024 * 1024,
      });
      assert.strictEqual(res.exit.code, 0);
      assert.ok((decodeText(res.chunks)).includes("v"));
    });

    it("注册 A 命令 mock 后 run 未命中的 B 命令仍走受管进程路径", async () => {
      const driver = new FakeProcessDriver();
      // 受管路径由 Fake 驱动确定性驱动：派生后立即以退出码 0 结束并关闭输出
      driver.onSpawn = (handle) => {
        driver.emitOutput(handle.id, "stdout", "managed-path");
        driver.emitExit(handle.id, 0);
        driver.emitOutputClosed(handle.id, "natural");
      };
      const proc = new MockProcessExecutor({ driver });
      proc.register("known-cmd", { ok: true, stdout: "mocked" });

      // 已注册 mock 但 B 命令未命中：应落入受管进程路径而非 exec 抛「未命中」
      const result = await proc.run({
        spec: { executable: "unknown-b", args: ["--flag"], io: { mode: "pipe" } },
        timeoutMs: 5000,
        maxOutputBytes: 1024 * 1024,
      });

      // 受管路径返回结构化退出信封，而非抛出未命中异常
      assert.notStrictEqual(result, undefined);
      assert.notStrictEqual(result.exit, undefined);
      assert.strictEqual(result.exit.code, 0);
      assert.strictEqual(Array.isArray(result.chunks), true);
      assert.ok((decodeText(result.chunks)).includes("managed-path"));

      // 已注册的 A 命令 mock 命中时仍正常返回模拟输出
      const mocked = await proc.run({
        spec: { executable: "known-cmd", args: [], io: { mode: "pipe" } },
        timeoutMs: 5000,
        maxOutputBytes: 1024 * 1024,
      });
      assert.ok((decodeText(mocked.chunks)).includes("mocked"));
    });

    it("带延时控制执行完毕后妥善注销 AbortSignal 监听器", async () => {
      const proc = new MockProcessExecutor();
      proc.register("delayed-cmd", { delayMs: 10, exitCode: 0 });

      const controller = new AbortController();
      let listenerCount = 0;
      const originalAdd = controller.signal.addEventListener.bind(controller.signal);
      const originalRemove = controller.signal.removeEventListener.bind(controller.signal);

      controller.signal.addEventListener = (type: any, listener: any, opts: any) => {
        if (type === "abort") listenerCount++;
        return originalAdd(type, listener, opts);
      };
      controller.signal.removeEventListener = (type: any, listener: any, opts?: any) => {
        if (type === "abort") listenerCount--;
        return originalRemove(type, listener, opts);
      };

      const res = await proc.run(
        { spec: { executable: "delayed-cmd", args: [], io: { mode: "pipe" } }, timeoutMs: 5000, maxOutputBytes: 1024 },
        { signal: controller.signal }
      );
      assert.strictEqual(res.exit.code, 0);
      assert.strictEqual(listenerCount, 0);
    });

    it("注入 FakeClock 后 delayMs 由时钟驱动，不占用真实时间", async () => {
      const clock = new FakeClock({ startMonotonic: 0 });
      const proc = new MockProcessExecutor({ clock });
      proc.register("frozen-cmd", { delayMs: 60000, exitCode: 0, stdout: "after-delay" });

      let settled = false;
      const runPromise = proc.run({
        spec: { executable: "frozen-cmd", args: [], io: { mode: "pipe" } },
        timeoutMs: 120000,
        maxOutputBytes: 1024,
      }).then((res) => {
        settled = true;
        return res;
      });

      // 未推进时钟前命令保持挂起，验证延时完全由 FakeClock 驱动
      await Promise.resolve();
      await Promise.resolve();
      assert.strictEqual(settled, false);

      // 一次性推进起过延时窗口，命令立即完成，全程未占用真实时间
      const advanced = clock.advance(60000);
      const res = await runPromise;
      await advanced;

      assert.strictEqual(res.exit.code, 0);
      assert.strictEqual(decodeText(res.chunks), "after-delay");
      assert.strictEqual(settled, true);
    });

    it("未注入时钟时 delayMs 回退真实 setTimeout 语义保持可用", async () => {
      const proc = new MockProcessExecutor();
      proc.register("real-delay-cmd", { delayMs: 20, exitCode: 0 });

      const startedAt = Date.now();
      const res = await proc.run({
        spec: { executable: "real-delay-cmd", args: [], io: { mode: "pipe" } },
        timeoutMs: 5000,
        maxOutputBytes: 1024,
      });
      assert.strictEqual(res.exit.code, 0);
      // 真实回退路径至少等待了设定的延时
      assert.ok((Date.now() - startedAt) >= 15);
    });
  });

  describe("MemoryStateStore", () => {
    it("根命名空间读取严格限定空命名空间，不做跨命名空间隐式回扫", async () => {
      const shared = new Map<string, any>();
      const rootStore = new MemoryStateStore(shared, "");
      const scopedStore = rootStore.scope("cache");

      await scopedStore.set("token", "scoped-value");

      // 根命名空间直接读取：严格限定空命名空间，不隐式回扫 cache 命名空间
      assert.strictEqual(await rootStore.get<string>("token"), undefined);

      // 根命名空间自身写入的同 key 条目可精确命中
      await rootStore.set("token", "root-value");
      assert.strictEqual(await rootStore.get<string>("token"), "root-value");
    });

    it("跨命名空间同名 key 互不可见，不再抛出歧义异常", async () => {
      const shared = new Map<string, any>();
      const rootStore = new MemoryStateStore(shared, "");

      await rootStore.scope("ns-alpha").set("dup", "alpha");
      await rootStore.scope("ns-beta").set("dup", "beta");

      // 根命名空间读取严格限定空命名空间，各作用域条目互不可见
      assert.strictEqual(await rootStore.get("dup"), undefined);
      assert.strictEqual(await rootStore.scope("ns-alpha").get("dup"), "alpha");
      assert.strictEqual(await rootStore.scope("ns-beta").get("dup"), "beta");
    });

    it("命名空间内过期条目失效后返回 undefined", async () => {
      const clock = new FakeClock({ now: "2026-01-01T00:00:00.000Z" });
      const shared = new Map<string, any>();
      const rootStore = new MemoryStateStore(shared, "", clock);

      await rootStore.scope("ttl-ns").set("ephemeral", "gone-soon", 5);

      // 未过期时作用域内可命中
      assert.strictEqual(await rootStore.scope("ttl-ns").get("ephemeral"), "gone-soon");

      // 推进 6 秒后条目过期，返回 undefined
      await clock.advance(6000);
      assert.strictEqual(await rootStore.scope("ttl-ns").get("ephemeral"), undefined);
      assert.strictEqual(await rootStore.get("ephemeral"), undefined);

      // 全无命中时返回 undefined
      assert.strictEqual(await rootStore.get("never-exists"), undefined);
    });

    it("TTL 为 0 或负数时按契约表示永久有效", async () => {
      const clock = new FakeClock({ now: "2026-01-01T00:00:00.000Z" });
      const store = new MemoryStateStore(new Map<string, any>(), "", clock);

      // SDK 契约：不传或小于等于 0 表示永久有效，立即读取不应过期丢失
      await store.set("zero-ttl", "kept-zero", 0);
      await store.set("negative-ttl", "kept-negative", -5);

      assert.strictEqual(await store.get<string>("zero-ttl"), "kept-zero");
      assert.strictEqual(await store.get<string>("negative-ttl"), "kept-negative");

      // 推进时间后仍永久有效
      await clock.advance(60_000);
      assert.strictEqual(await store.get<string>("zero-ttl"), "kept-zero");
      assert.strictEqual(await store.get<string>("negative-ttl"), "kept-negative");
    });

    it("非根命名空间保持严格隔离", async () => {
      const shared = new Map<string, any>();
      const rootStore = new MemoryStateStore(shared, "");

      await rootStore.scope("ns-a").set("key", "from-a");

      // ns-b 命名空间读取不应看到 ns-a 的条目
      assert.strictEqual(await rootStore.scope("ns-b").get("key"), undefined);
      // 根命名空间同样不做隐式回扫
      assert.strictEqual(await rootStore.get("key"), undefined);
    });
  });

  describe("MemoryStorage", () => {
    it("具备完整的配置存取与删除契约", () => {
      const storage = new MemoryStorage({ packageId: "unit-pkg" });
      storage.setConfig("API_URL", "https://api.internal");
      assert.strictEqual(storage.getConfig<string>("API_URL"), "https://api.internal");
      assert.deepStrictEqual(storage.listConfig(), { API_URL: "https://api.internal" });

      assert.strictEqual(storage.deleteConfig("API_URL"), true);
      assert.strictEqual(storage.getConfig("API_URL"), undefined);
    });

    it("支持状态命名空间隔离与过期失效", async () => {
      const clock = new FakeClock({ now: "2026-01-01T00:00:00.000Z" });
      const storage = new MemoryStorage({ packageId: "unit-pkg", clock });

      await storage.setState("cache", "token", "abc123xyz", 10);
      assert.strictEqual(await storage.getState<string>("cache", "token"), "abc123xyz");

      const keysBefore = await storage.listStateKeys("cache");
      assert.ok((keysBefore).includes("token"));

      // 推进 5 秒，尚未过期
      await clock.advance(5000);
      assert.strictEqual(await storage.getState<string>("cache", "token"), "abc123xyz");

      // 再次推进 6 秒（总计 11 秒），已超过 10 秒 TTL
      await clock.advance(6000);
      assert.strictEqual(await storage.getState("cache", "token"), undefined);
      assert.deepStrictEqual(await storage.listStateKeys("cache"), []);
    });

    it("记录运行历史并符合终态契约", () => {
      const storage = new MemoryStorage({ packageId: "unit-pkg" });
      storage.createRun({
        id: "run-101",
        rootRunId: "run-101",
        packageId: "unit-pkg",
        packageInstanceId: "unit-pkg",
        actionId: "demo.echo",
        generationId: "1",
        ownerId: "local",
        status: "running",
        startedAt: new Date().toISOString(),
      });

      const initial = storage.getRun("run-101");
      assert.strictEqual(initial?.status, "running");

      storage.updateRun("run-101", "success", { result: "ok" });
      const finished = storage.getRun("run-101");
      assert.strictEqual(finished?.status, "success");
      assert.deepStrictEqual(finished?.output, { result: "ok" });

      const runs = storage.listRuns({ actionId: "demo.echo" });
      assert.strictEqual(runs.length, 1);
    });
  });

  describe("createTestRuntime 核心生命周期", () => {
    it("正常运行 Action 并完成 Schema 校验", async () => {
      const sumAction = defineAction({
        run(input: { x: number; y: number }) {
          return { total: input.x + input.y };
        },
      });

      const runtime = createTestRuntime({
        projectConfig: {
          id: "test-pkg",
          name: "Test Package",
          actions: {
            "calc.sum": {
              entry: "",
              inputSchema: {
                type: "object",
                properties: {
                  x: { type: "number" },
                  y: { type: "number" },
                },
                required: ["x", "y"],
              },
              outputSchema: {
                type: "object",
                properties: {
                  total: { type: "number" },
                },
                required: ["total"],
              },
            },
          },
        },
        actions: { "calc.sum": sumAction },
      });

      // 验证 run 方法直接返回解包后的业务结果
      const direct = await runtime.run(sumAction, { x: 15, y: 25 });
      assert.deepStrictEqual(direct, { total: 40 });

      // 验证 execute 方法返回完整信封结构
      const envelope = await runtime.execute(sumAction, { x: 1, y: 2 });
      assert.strictEqual(envelope.ok, true);
      if (envelope.ok) {
        assert.deepStrictEqual(envelope.data, { total: 3 });
        assert.notStrictEqual(envelope.runId, undefined);
      }

      // 验证事件总线记录
      const events = runtime.events.getEvents();
      assert.ok((events.length) > 0);
      assert.strictEqual(events.some((e) => e.type === "finish"), true);
    });

    it("输入参数校验失败与输出结果校验失败抛出规范异常", async () => {
      const strictAction = defineAction({
        run() {
          // 故意返回错误输出以测试输出校验
          return { count: "not-a-number" as unknown as number };
        },
      });

      const runtime = createTestRuntime({
        projectConfig: {
          id: "test-pkg",
          name: "Test Package",
          actions: {
            "check.strict": {
              entry: "",
              inputSchema: {
                type: "object",
                properties: {
                  requiredKey: { type: "string" },
                },
                required: ["requiredKey"],
              },
              outputSchema: {
                type: "object",
                properties: {
                  count: { type: "number" },
                },
                required: ["count"],
              },
            },
          },
        },
        actions: { "check.strict": strictAction },
      });

      // 输入校验失败
      const inputFailEnvelope = await runtime.execute(strictAction, { invalidKey: 123 } as any);
      assert.strictEqual(inputFailEnvelope.ok, false);
      assert.strictEqual((inputFailEnvelope as any).error.code, "INPUT_VALIDATION_FAILED");

      try {
        await runtime.run(strictAction, { invalidKey: 123 } as any);
        assert.fail("不应到达此分支");
      } catch (err: any) {
        assert.strictEqual(err instanceof ActionRuntimeError, true);
        assert.strictEqual(err.code, "INPUT_VALIDATION_FAILED");
      }

      // 输出校验失败
      const outputFailEnvelope = await runtime.execute(strictAction, { requiredKey: "ok" });
      assert.strictEqual(outputFailEnvelope.ok, false);
      assert.strictEqual((outputFailEnvelope as any).error.code, "OUTPUT_VALIDATION_FAILED");

      try {
        await runtime.run(strictAction, { requiredKey: "ok" });
        assert.fail("不应到达此分支");
      } catch (err: any) {
        assert.strictEqual(err instanceof ActionRuntimeError, true);
        assert.strictEqual(err.code, "OUTPUT_VALIDATION_FAILED");
      }
    });

    it("配置与状态读写及 TTL 过期联动", async () => {
      const clock = new FakeClock({ now: "2026-01-01T00:00:00.000Z" });
      const runtime = createTestRuntime({
        clock,
        config: {
          DEFAULT_URL: "https://origin.internal",
        },
      });

      // 调试配置接口
      assert.strictEqual(runtime.config.get<string>("DEFAULT_URL"), "https://origin.internal");
      runtime.config.set("CUSTOM_KEY", "custom_val");
      assert.strictEqual(runtime.config.get<string>("CUSTOM_KEY"), "custom_val");
      assert.strictEqual(runtime.config.has("CUSTOM_KEY"), true);

      const stateAction = defineAction({
        async run(_input, ctx) {
          const cfg = ctx.config.get<string>("CUSTOM_KEY");
          await ctx.state.set("session", { active: true, cfg }, 5);
          return { stored: true };
        },
      });

      await runtime.run(stateAction, {});

      // 验证 Action 写入的状态
      const stateVal = await runtime.state.get<{ active: boolean; cfg: string }>("session");
      assert.deepStrictEqual(stateVal, { active: true, cfg: "custom_val" });

      // 通过模拟时钟推进 6 秒，使 5 秒 TTL 的状态失效
      await runtime.clock.advance(6000);

      const expiredVal = await runtime.state.get("session");
      assert.strictEqual(expiredVal, undefined);
    });

    it("Action 嵌套互调与环路死锁检测", async () => {
      const runtime = createTestRuntime();

      const leafAction = defineAction({
        run(input: { val: number }) {
          return { doubled: input.val * 2 };
        },
      });

      const parentAction = defineAction({
        async run(input: { val: number }, ctx) {
          const res = await ctx.actions.invoke<{ val: number }, { doubled: number }>("chain.leaf", { val: input.val });
          return { final: res.doubled + 1 };
        },
      });

      runtime.registerAction("chain.leaf", leafAction);
      runtime.registerAction("chain.parent", parentAction);

      // 正常嵌套互调
      const result = await runtime.run<{ val: number }, { final: number }>(parentAction, { val: 10 });
      assert.deepStrictEqual(result, { final: 21 });

      // 环路死锁检测 A -> B -> A
      const loopA: ActionDefinition = defineAction({
        async run(_input: unknown, ctx): Promise<unknown> {
          return ctx.actions.invoke("loop.b", {});
        },
      });

      const loopB: ActionDefinition = defineAction({
        async run(_input: unknown, ctx): Promise<unknown> {
          return ctx.actions.invoke("loop.a", {});
        },
      });

      runtime.registerAction("loop.a", loopA);
      runtime.registerAction("loop.b", loopB);

      const loopRes = await runtime.execute(loopA, {});
      assert.strictEqual(loopRes.ok, false);
      if (!loopRes.ok) {
        assert.strictEqual(loopRes.error.code, "ACTION_CALL_CYCLE");
        assert.ok((loopRes.error.message).includes("loop.a"));
      }
    });

    it("超时控制与信号取消", async () => {
      const runtime = createTestRuntime();

      const hangingAction = defineAction({
        async run(_input, ctx) {
          return new Promise((resolve, reject) => {
            const timer = setTimeout(() => resolve({ done: true }), 1000);
            ctx.signal.addEventListener("abort", () => {
              clearTimeout(timer);
              reject(new Error("aborted"));
            });
          });
        },
      });

      // 超时控制
      const timeoutRes = await runtime.execute(hangingAction, {}, { timeoutMs: 50 });
      assert.strictEqual(timeoutRes.ok, false);
      assert.strictEqual((timeoutRes as any).error.code, "ACTION_TIMEOUT");

      // 外部 AbortSignal 取消
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort("manual abort"), 30);
      try {
        const cancelRes = await runtime.execute(hangingAction, {}, { signal: controller.signal });
        assert.strictEqual(cancelRes.ok, false);
        assert.strictEqual((cancelRes as any).error.code, "ACTION_CANCELLED");
      } finally {
        clearTimeout(timer);
      }
    });

    it("模拟外部命令执行", async () => {
      const runtime = createTestRuntime();

      runtime.process.register("docker ps", {
        stdout: "CONTAINER ID   IMAGE     COMMAND\n123abc456   nginx     nginx -g",
      });

      const cliAction = defineAction({
        async run(_input, ctx) {
          const res = await ctx.process.run({
            spec: { executable: "docker", args: ["ps"], io: { mode: "pipe" } },
            timeoutMs: 5000,
            maxOutputBytes: 1024 * 1024,
          });
          const stdout = decodeText(res.chunks);
          return {
            stdout,
            hasNginx: stdout.includes("nginx"),
          };
        },
      });

      const out = await runtime.run<unknown, { stdout: string; hasNginx: boolean }>(cliAction, {});
      assert.strictEqual(out.hasNginx, true);
      assert.ok((out.stdout).includes("123abc456"));

      assert.strictEqual(runtime.process.hasCalled("docker"), true);
      assert.deepStrictEqual(runtime.process.getLastCall()?.args, ["ps"]);
    });

    it("支持测试捕获 ctx.log 输出日志", async () => {
      const runtime = createTestRuntime();

      const loggingAction = defineAction({
        async run(_input, ctx) {
          ctx.log.info("Process started", { step: 1 });
          ctx.log.warn("High memory notice");
          ctx.log.error("Recoverable issue", { code: 500 });
          return { success: true };
        },
      });

      const res = await runtime.run<unknown, { success: boolean }>(loggingAction, {});
      assert.strictEqual(res.success, true);

      assert.strictEqual(runtime.logger.logs.length, 3);
      assert.deepStrictEqual(runtime.logger.logs[0], {
        level: "info",
        message: "Process started",
        data: { step: 1 },
      });
      assert.deepStrictEqual(runtime.logger.logs[1], {
        level: "warn",
        message: "High memory notice",
        data: undefined,
      });
      assert.deepStrictEqual(runtime.logger.logs[2], {
        level: "error",
        message: "Recoverable issue",
        data: { code: 500 },
      });
    });

    it("验证 @actiondock/testing 的 createTestRuntime 独立运行与动作执行", async () => {
      const { createTestRuntime: createTestingRuntime, createTestPlatform } = await import("../src");

      const testAction = defineAction({
        run(input: { a: number; b: number }) {
          return { sum: input.a + input.b };
        },
      });

      // testing 生产运行时执行
      const testingRuntime = createTestingRuntime({
        projectConfig: {
          id: "test-pkg",
          name: "Test Package",
          actions: {
            "calc.add": {
              entry: "",
              inputSchema: {
                type: "object",
                properties: { a: { type: "number" }, b: { type: "number" } },
                required: ["a", "b"],
              },
            },
          },
        },
        actions: { "calc.add": testAction },
      });
      const testingOut = await testingRuntime.run<{ a: number; b: number }, { sum: number }>(testAction, { a: 10, b: 20 });
      assert.deepStrictEqual(testingOut, { sum: 30 });

      // 显式结合 createTestPlatform 执行
      const platform = createTestPlatform();
      const platformRuntime = createTestingRuntime({
        platform,
        projectConfig: {
          id: "test-pkg",
          name: "Test Package",
          actions: {
            "calc.add": {
              entry: "",
              inputSchema: {
                type: "object",
                properties: { a: { type: "number" }, b: { type: "number" } },
                required: ["a", "b"],
              },
            },
          },
        },
        actions: { "calc.add": testAction },
      });
      const platformOut = await platformRuntime.run<{ a: number; b: number }, { sum: number }>(testAction, { a: 15, b: 25 });
      assert.deepStrictEqual(platformOut, { sum: 40 });

      // 对齐的 config 与状态管理
      assert.strictEqual(testingRuntime.config.get("non_existent", "default"), "default");
      testingRuntime.config.set("newKey", "val2");
      assert.strictEqual(testingRuntime.config.get<string>("newKey"), "val2");
      assert.strictEqual(testingRuntime.config.delete("newKey"), true);
      assert.strictEqual(testingRuntime.config.has("newKey"), false);

      // 对齐的 execute 错误校验
      const execFail = await testingRuntime.execute(testAction, { a: "invalid" as any, b: 20 });
      assert.strictEqual(execFail.ok, false);
      assert.strictEqual((execFail as any).error?.code, "INPUT_VALIDATION_FAILED");
    });
  });
});
