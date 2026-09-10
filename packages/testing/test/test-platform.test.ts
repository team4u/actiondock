import { describe, expect, it } from "bun:test";
import {
  DefaultExecutionService,
  DefaultModuleLoader,
  NodeFileSystem,
  SqliteRuntimeStorage,
  type RuntimePlatform,
} from "@actiondock/core";
import { defineAction } from "@actiondock/sdk";
import {
  createTestPlatform,
  createTestRuntime,
  FakeClock,
  MemoryStorage,
  MockProcessExecutor,
  TestEventSink,
  type TestPlatform,
} from "../src";

describe("createTestPlatform 测试平台工厂测试", () => {
  describe("组件组装与契约校验", () => {
    it("具备标准 Test 运行时平台属性契约", () => {
      const platform: TestPlatform = createTestPlatform();

      expect(platform.name).toBe("test");
      expect(platform.clock).toBeInstanceOf(FakeClock);
      expect(platform.files).toBeInstanceOf(NodeFileSystem);
      expect(platform.modules).toBeInstanceOf(DefaultModuleLoader);
      expect(platform.process).toBeInstanceOf(MockProcessExecutor);
      expect(platform.eventSink).toBeInstanceOf(TestEventSink);
      expect(platform.storage).toBeDefined();
      expect(typeof platform.storage.createStorage).toBe("function");
      expect(typeof platform.storage.createGlobalStorage).toBe("function");

      // 验证赋值给通用 RuntimePlatform 接口完全兼容
      const genericPlatform: RuntimePlatform = platform;
      expect(genericPlatform.name).toBe("test");
    });

    it("支持通过 FakeClock 确定性快进时间", async () => {
      const platform = createTestPlatform();
      const initialTime = platform.clock.now().getTime();

      platform.clock.advance(5000);
      expect(platform.clock.now().getTime()).toBe(initialTime + 5000);
      expect(platform.clock.monotonic()).toBeGreaterThanOrEqual(5000);
    });

    it("支持通过 MockProcessExecutor 预设并拦截进程执行", async () => {
      const platform = createTestPlatform();
      platform.process.register("git status", { stdout: "On branch main\nnothing to commit" });

      const res = await platform.process.exec("git status");
      expect(res.ok).toBe(true);
      expect(res.stdout).toContain("On branch main");
    });
  });

  describe("确定性纯内存存储隔离", () => {
    it("基于 MemoryStorage 实现同包复用与跨包隔离", async () => {
      const platform = createTestPlatform();

      const storageA1 = platform.storage.createStorage("package-a");
      const storageA2 = platform.storage.createStorage("package-a");
      const storageB = platform.storage.createStorage("package-b");

      expect(storageA1).toBe(storageA2);
      expect(storageA1).not.toBe(storageB);

      storageA1.setConfig("APP_KEY", "VAL_A");
      expect(storageA2.getConfig("APP_KEY") as any).toBe("VAL_A");
      expect(storageB.getConfig("APP_KEY")).toBeUndefined();

      storageA1.setState("run-1", "flag", true);
      expect((await storageA2.getState("run-1", "flag")) as any).toBe(true);
      expect(await storageB.getState("run-1", "flag")).toBeUndefined();

      storageA1.close();
      storageB.close();
    });

    it("支持全局存储与外部自定义 storage/globalStorage 显式注入", () => {
      const customStorage = new MemoryStorage({ packageId: "custom-injected" });
      const customGlobal = new MemoryStorage({ packageId: "__global_injected__" });

      const platform = createTestPlatform({
        storage: customStorage,
        globalStorage: customGlobal,
      });

      expect(platform.storage.createStorage("any-pkg")).toBe(customStorage);
      expect(platform.storage.createGlobalStorage()).toBe(customGlobal);

      customStorage.close();
      customGlobal.close();
    });
  });

  describe("内核执行服务平台集成", () => {
    it("注入至 DefaultExecutionService 并跑通完整 Action 执行链路", async () => {
      const platform = createTestPlatform();
      platform.process.register("ad-cli whoami", { stdout: "agent-user" });

      const testAction = defineAction({
        run: async (_input, ctx) => {
          const procRes = await ctx.process.exec("ad-cli whoami");
          await ctx.state.set("user", procRes.stdout.trim());
          return {
            user: procRes.stdout.trim(),
            runId: ctx.run.id,
          };
        },
      });

      const service = new DefaultExecutionService({
        packageId: "test-pkg",
        platform,
        eventSink: platform.eventSink,
      });

      service.registerAction("test-echo", testAction);

      const ticket = await service.start("test-echo", {});
      const result: any = await ticket.result!;

      expect(result).toBeDefined();
      expect(result.ok).toBe(true);
      expect((result.data as any).user).toBe("agent-user");

      // 验证事件接收器记录了执行事件
      if (platform.eventSink instanceof TestEventSink) {
        const events = platform.eventSink.getEvents(ticket.runId);
        expect(events.length).toBeGreaterThan(0);
        expect(events.some((e) => e.type === "finish")).toBe(true);
      }

      await service.close();
    });

    it("支持与 createTestRuntime 无缝结合", async () => {
      const platform = createTestPlatform();
      platform.process.register("test-cmd", { stdout: "output-42" });

      const runtime = createTestRuntime({
        packageId: "test-runtime-pkg",
        platform,
      });

      const action = defineAction({
        run: async (_input, ctx) => {
          const res = await ctx.process.exec("test-cmd");
          return { out: res.stdout };
        },
      });

      const data = await runtime.run(action, {});
      expect((data as any).out).toBe("output-42");
    });
  });
});
