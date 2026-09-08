import { describe, expect, it } from "bun:test";
import { defineAction, type ActionDefinition } from "@actiondock/sdk";
import {
  ActionRuntimeError,
  createTestRuntime,
  FakeClock,
  MemoryStorage,
  MockProcessExecutor,
} from "../src";

describe("@actiondock/testing", () => {
  describe("FakeClock", () => {
    it("支持读取基准时间与单调时间", () => {
      const fixedTime = new Date("2026-01-01T00:00:00.000Z");
      const clock = new FakeClock({ now: fixedTime, startMonotonic: 100 });

      expect(clock.now().toISOString()).toBe("2026-01-01T00:00:00.000Z");
      expect(clock.monotonic()).toBe(100);
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

      expect(clock.pendingCount).toBe(2);

      await clock.advance(50);
      expect(clock.monotonic()).toBe(50);
      expect(triggered1).toBe(false);
      expect(triggered2).toBe(false);

      await clock.advance(60);
      expect(clock.monotonic()).toBe(110);
      expect(triggered1).toBe(true);
      expect(triggered2).toBe(false);

      await clock.advance(100);
      expect(clock.monotonic()).toBe(210);
      expect(triggered2).toBe(true);
      expect(clock.pendingCount).toBe(0);
    });

    it("推进负数时间时抛出异常", async () => {
      const clock = new FakeClock();
      expect(clock.advance(-10)).rejects.toThrow("Cannot advance clock by negative time");
    });
  });

  describe("MockProcessExecutor", () => {
    it("支持注册匹配规则并记录执行历史", async () => {
      const proc = new MockProcessExecutor();
      proc.register("git status", {
        ok: true,
        exitCode: 0,
        stdout: "On branch master\nnothing to commit",
      });

      const res = await proc.exec("git", ["status"]);
      expect(res.ok).toBe(true);
      expect(res.exitCode).toBe(0);
      expect(res.stdout).toBe("On branch master\nnothing to commit");

      expect(proc.calls.length).toBe(1);
      expect(proc.hasCalled("git")).toBe(true);
      expect(proc.getLastCall()?.args).toEqual(["status"]);
    });

    it("支持模拟超时与信号取消", async () => {
      const proc = new MockProcessExecutor();
      proc.register("long-task", {
        timedOut: true,
      });
      proc.register("cancel-task", {
        cancelled: true,
      });

      const timeoutRes = await proc.exec("long-task");
      expect(timeoutRes.ok).toBe(false);
      expect(timeoutRes.timedOut).toBe(true);
      expect(timeoutRes.error?.code).toBe("PROCESS_TIMEOUT");

      const cancelRes = await proc.exec("cancel-task");
      expect(cancelRes.ok).toBe(false);
      expect(cancelRes.cancelled).toBe(true);
      expect(cancelRes.error?.code).toBe("PROCESS_CANCELLED");
    });

    it("支持启动后台脱离进程与就绪状态探测", async () => {
      const proc = new MockProcessExecutor();
      let probeCount = 0;

      const res = await proc.spawnDetached({
        command: "redis-server",
        probe: async () => {
          probeCount++;
          return probeCount >= 1;
        },
      });

      expect(res.ok).toBe(true);
      expect(res.ready).toBe(true);
      expect(res.pid).toBeDefined();
      expect(proc.detachedCalls.length).toBe(1);
    });
  });

  describe("MemoryStorage", () => {
    it("具备完整的配置存取与删除契约", () => {
      const storage = new MemoryStorage({ packageId: "unit-pkg" });
      storage.setConfig("API_URL", "https://api.internal");
      expect(storage.getConfig<string>("API_URL")).toBe("https://api.internal");
      expect(storage.listConfig()).toEqual({ API_URL: "https://api.internal" });

      expect(storage.deleteConfig("API_URL")).toBe(true);
      expect(storage.getConfig("API_URL")).toBeUndefined();
    });

    it("支持状态命名空间隔离与过期失效", async () => {
      const clock = new FakeClock({ now: "2026-01-01T00:00:00.000Z" });
      const storage = new MemoryStorage({ packageId: "unit-pkg", clock });

      await storage.setState("cache", "token", "abc123xyz", 10);
      expect(await storage.getState<string>("cache", "token")).toBe("abc123xyz");

      const keysBefore = await storage.listStateKeys("cache");
      expect(keysBefore).toContain("token");

      // 推进 5 秒，尚未过期
      await clock.advance(5000);
      expect(await storage.getState<string>("cache", "token")).toBe("abc123xyz");

      // 再次推进 6 秒（总计 11 秒），已超过 10 秒 TTL
      await clock.advance(6000);
      expect(await storage.getState("cache", "token")).toBeUndefined();
      expect(await storage.listStateKeys("cache")).toEqual([]);
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
      expect(initial?.status).toBe("running");

      storage.updateRun("run-101", "success", { result: "ok" });
      const finished = storage.getRun("run-101");
      expect(finished?.status).toBe("success");
      expect(finished?.output).toEqual({ result: "ok" });

      const runs = storage.listRuns({ actionId: "demo.echo" });
      expect(runs.length).toBe(1);
    });
  });

  describe("createTestRuntime 核心生命周期", () => {
    it("正常运行 Action 并完成 Schema 校验", async () => {
      const runtime = createTestRuntime();

      const sumAction = defineAction({
        id: "calc.sum",
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
        run(input: { x: number; y: number }) {
          return { total: input.x + input.y };
        },
      });

      // 验证 run 方法直接返回解包后的业务结果
      const direct = await runtime.run(sumAction, { x: 15, y: 25 });
      expect(direct).toEqual({ total: 40 });

      // 验证 execute 方法返回完整信封结构
      const envelope = await runtime.execute(sumAction, { x: 1, y: 2 });
      expect(envelope.ok).toBe(true);
      if (envelope.ok) {
        expect(envelope.data).toEqual({ total: 3 });
        expect(envelope.runId).toBeDefined();
      }

      // 验证事件总线记录
      const events = runtime.events.getEvents();
      expect(events.length).toBeGreaterThan(0);
      expect(events.some((e) => e.type === "finish")).toBe(true);
    });

    it("输入参数校验失败与输出结果校验失败抛出规范异常", async () => {
      const runtime = createTestRuntime();

      const strictAction = defineAction({
        id: "check.strict",
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
        run() {
          // 故意返回错误输出以测试输出校验
          return { count: "not-a-number" as unknown as number };
        },
      });

      // 1. 输入校验失败
      const inputFailEnvelope = await runtime.execute(strictAction, { invalidKey: 123 } as any);
      expect(inputFailEnvelope.ok).toBe(false);
      if (!inputFailEnvelope.ok) {
        expect(inputFailEnvelope.error.code).toBe("INPUT_VALIDATION_FAILED");
      }

      try {
        await runtime.run(strictAction, { invalidKey: 123 } as any);
        expect(true).toBe(false);
      } catch (err: any) {
        expect(err instanceof ActionRuntimeError).toBe(true);
        expect(err.code).toBe("INPUT_VALIDATION_FAILED");
      }

      // 2. 输出校验失败
      const outputFailEnvelope = await runtime.execute(strictAction, { requiredKey: "ok" });
      expect(outputFailEnvelope.ok).toBe(false);
      if (!outputFailEnvelope.ok) {
        expect(outputFailEnvelope.error.code).toBe("OUTPUT_VALIDATION_FAILED");
      }

      try {
        await runtime.run(strictAction, { requiredKey: "ok" });
        expect(true).toBe(false);
      } catch (err: any) {
        expect(err instanceof ActionRuntimeError).toBe(true);
        expect(err.code).toBe("OUTPUT_VALIDATION_FAILED");
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
      expect(runtime.config.get<string>("DEFAULT_URL")).toBe("https://origin.internal");
      runtime.config.set("CUSTOM_KEY", "custom_val");
      expect(runtime.config.get<string>("CUSTOM_KEY")).toBe("custom_val");
      expect(runtime.config.has("CUSTOM_KEY")).toBe(true);

      const stateAction = defineAction({
        id: "state.manipulator",
        async run(_input, ctx) {
          const cfg = ctx.config.get<string>("CUSTOM_KEY");
          await ctx.state.set("session", { active: true, cfg }, 5);
          return { stored: true };
        },
      });

      await runtime.run(stateAction, {});

      // 验证 Action 写入的状态
      const stateVal = await runtime.state.get<{ active: boolean; cfg: string }>("session");
      expect(stateVal).toEqual({ active: true, cfg: "custom_val" });

      // 通过模拟时钟推进 6 秒，使 5 秒 TTL 的状态失效
      await runtime.clock.advance(6000);

      const expiredVal = await runtime.state.get("session");
      expect(expiredVal).toBeUndefined();
    });

    it("Action 嵌套互调与环路死锁检测", async () => {
      const runtime = createTestRuntime();

      const leafAction = defineAction({
        id: "chain.leaf",
        run(input: { val: number }) {
          return { doubled: input.val * 2 };
        },
      });

      const parentAction = defineAction({
        id: "chain.parent",
        async run(input: { val: number }, ctx) {
          const res = await ctx.actions.invoke(leafAction, { val: input.val });
          return { final: res.doubled + 1 };
        },
      });

      runtime.registerAction(leafAction);
      runtime.registerAction(parentAction);

      // 正常嵌套互调
      const result = await runtime.run(parentAction, { val: 10 });
      expect(result).toEqual({ final: 21 });

      // 环路死锁检测 A -> B -> A
      const loopA: ActionDefinition = defineAction({
        id: "loop.a",
        async run(_input: unknown, ctx): Promise<unknown> {
          return ctx.actions.invoke(loopB, {});
        },
      });

      const loopB: ActionDefinition = defineAction({
        id: "loop.b",
        async run(_input: unknown, ctx): Promise<unknown> {
          return ctx.actions.invoke(loopA, {});
        },
      });

      runtime.registerAction(loopA);
      runtime.registerAction(loopB);

      const loopRes = await runtime.execute(loopA, {});
      expect(loopRes.ok).toBe(false);
      if (!loopRes.ok) {
        expect(loopRes.error.code).toBe("ACTION_CYCLE_DETECTED");
        expect(loopRes.error.message).toContain("loop.a");
      }
    });

    it("超时控制与信号取消", async () => {
      const runtime = createTestRuntime();

      const hangingAction = defineAction({
        id: "async.hang",
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

      // 1. 超时控制
      const timeoutRes = await runtime.execute(hangingAction, {}, { timeoutMs: 50 });
      expect(timeoutRes.ok).toBe(false);
      if (!timeoutRes.ok) {
        expect(timeoutRes.error.code).toBe("ACTION_TIMEOUT");
      }

      // 2. 外部 AbortSignal 取消
      const controller = new AbortController();
      setTimeout(() => controller.abort("manual abort"), 30);

      const cancelRes = await runtime.execute(hangingAction, {}, { signal: controller.signal });
      expect(cancelRes.ok).toBe(false);
      if (!cancelRes.ok) {
        expect(cancelRes.error.code).toBe("ACTION_CANCELLED");
      }
    });

    it("模拟外部命令执行", async () => {
      const runtime = createTestRuntime();

      runtime.process.register("docker ps", {
        stdout: "CONTAINER ID   IMAGE     COMMAND\n123abc456   nginx     nginx -g",
      });

      const cliAction = defineAction({
        id: "cli.inspect",
        async run(_input, ctx) {
          const res = await ctx.process.exec("docker", ["ps"]);
          return {
            stdout: res.stdout,
            hasNginx: res.stdout.includes("nginx"),
          };
        },
      });

      const out = await runtime.run(cliAction, {});
      expect(out.hasNginx).toBe(true);
      expect(out.stdout).toContain("123abc456");

      expect(runtime.process.hasCalled("docker")).toBe(true);
      expect(runtime.process.getLastCall()?.args).toEqual(["ps"]);
    });
  });
});
