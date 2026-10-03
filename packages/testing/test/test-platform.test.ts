import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createActionDock,
} from "@actiondock/core";
import type {
  RuntimePlatform,
} from "@actiondock/core/package";
import { decodeText, defineAction } from "@actiondock/sdk";
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

      assert.strictEqual(platform.name, "test");
      assert.ok(platform.clock instanceof FakeClock);
      assert.notStrictEqual(platform.modules, undefined);
      assert.strictEqual(typeof platform.modules.load, "function");
      assert.ok(platform.process instanceof MockProcessExecutor);
      assert.ok(platform.eventSink instanceof TestEventSink);
      assert.notStrictEqual(platform.storage, undefined);
      assert.strictEqual(typeof platform.storage.createStorage, "function");
      assert.strictEqual(typeof platform.storage.createGlobalStorage, "function");

      // 验证赋值给通用 RuntimePlatform 接口完全兼容
      const genericPlatform: RuntimePlatform = platform;
      assert.strictEqual(genericPlatform.name, "test");
    });

    it("支持通过 FakeClock 确定性快进时间", async () => {
      const platform = createTestPlatform();
      const initialTime = platform.clock.now().getTime();

      await platform.clock.advance(5000);
      assert.strictEqual(platform.clock.now().getTime(), initialTime + 5000);
      assert.ok((platform.clock.monotonic()) >= 5000);
    });

    it("支持通过 MockProcessExecutor 预设并拦截进程执行", async () => {
      const platform = createTestPlatform();
      platform.process.register("git status", { stdout: "On branch main\nnothing to commit" });

      const res = await platform.process.run({
        spec: { executable: "git", args: ["status"], io: { mode: "pipe" } },
        timeoutMs: 1000,
        maxOutputBytes: 1024,
      });
      assert.strictEqual(res.exit.code, 0);
      assert.ok((decodeText(res.chunks)).includes("On branch main"));
    });
  });

  describe("确定性纯内存存储隔离", () => {
    it("基于 MemoryStorage 实现同包复用与跨包隔离", async () => {
      const platform = createTestPlatform();

      const storageA1 = platform.storage.createStorage("package-a");
      const storageA2 = platform.storage.createStorage("package-a");
      const storageB = platform.storage.createStorage("package-b");

      assert.strictEqual(storageA1, storageA2);
      assert.notStrictEqual(storageA1, storageB);

      storageA1.setConfig("APP_KEY", "VAL_A");
      assert.strictEqual(storageA2.getConfig("APP_KEY") as any, "VAL_A");
      assert.strictEqual(storageB.getConfig("APP_KEY"), undefined);

      storageA1.setState("run-1", "flag", true);
      assert.strictEqual((await storageA2.getState("run-1", "flag")) as any, true);
      assert.strictEqual(await storageB.getState("run-1", "flag"), undefined);

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

      assert.strictEqual(platform.storage.createStorage("any-pkg"), customStorage);
      assert.strictEqual(platform.storage.createGlobalStorage(), customGlobal);

      customStorage.close();
      customGlobal.close();
    });
  });

  describe("内核执行服务平台集成", () => {
    it("注入至 ActionDockService 并跑通完整 Action 执行链路", async () => {
      const platform = createTestPlatform();
      platform.process.register("ad-cli whoami", { stdout: "agent-user" });

      const testAction = defineAction({
        run: async (_input, ctx) => {
          const procRes = await ctx.process.run({
            spec: { executable: "ad-cli", args: ["whoami"], io: { mode: "pipe" } },
            timeoutMs: 5000,
            maxOutputBytes: 1024 * 1024,
          });
          const text = decodeText(procRes.chunks).trim();
          await ctx.state.set("user", text);
          return {
            user: text,
            runId: ctx.run.id,
          };
        },
      });

      const service = await createActionDock({
        platform,
        packages: [
          {
            projectConfig: {
              id: "test-pkg",
              name: "test-pkg",
              version: "1.0.0",
              actions: {
                "test-echo": {
                  entry: "",
                  description: "echo action",
                },
              },
            },
            actions: {
              "test-echo": testAction,
            },
          },
        ],
        autoLoadCurrentProject: false,
        scanLinkedPackages: false,
      });

      const ticket = await service.execution.start("test-pkg/test-echo", {});
      const result: any = await ticket.result!;

      assert.notStrictEqual(result, undefined);
      assert.strictEqual(result.ok, true);
      assert.strictEqual((result.data as any).user, "agent-user");

      // 验证事件接收器记录了执行事件
      if (platform.eventSink instanceof TestEventSink) {
        const events = platform.eventSink.getEvents(ticket.runId);
        assert.ok((events.length) > 0);
        assert.strictEqual(events.some((e) => e.type === "finish"), true);
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
          const res = await ctx.process.run({
            spec: { executable: "test-cmd", args: [], io: { mode: "pipe" } },
            timeoutMs: 5000,
            maxOutputBytes: 1024 * 1024,
          });
          return { out: decodeText(res.chunks) };
        },
      });

      const data = await runtime.run(action, {});
      assert.strictEqual((data as any).out, "output-42");
    });
  });
});
