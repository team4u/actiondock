import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { decodeText, encodeBytes, type ActionContext, type ProcessAPI } from "@actiondock/sdk";
import { DefaultExecutionService as ActionRunner } from "../src/execution/service";
import {
  createNodePlatform,
} from "../src";
import {
  SqliteRuntimeStorage,
  type Clock,
  type ModuleLoader,
  type ProcessExecutor,
  type RuntimePlatform,
} from "../src/package";
import { createInvocationContext } from "../src/execution/types";
import { createPackageIdentity } from "../src/runtime/identity";
import { DefaultExecutionService } from "../src/execution/service";

describe("RuntimePlatform 契约与 DefaultPlatform 测试", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "ad-platform-test-"));
  });

  afterEach(() => {
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // 忽略清理异常
    }
  });

  describe("createNodePlatform 平台组装与显式注入测试", () => {
    it("具备标准 RuntimePlatform 属性契约并默认使用 Node 原生驱动", () => {
      const platform = createNodePlatform({ name: "test" });
      assert.strictEqual(platform.name, "test");
      assert.notStrictEqual(platform.clock, undefined);
      assert.ok(platform.clock.now() instanceof Date);
      assert.notStrictEqual(platform.modules, undefined);
      assert.notStrictEqual(platform.process, undefined);
      assert.notStrictEqual(platform.storage, undefined);
    });

    it("默认具备可用 NodeProcessDriver 进程能力", async () => {
      const platform = createNodePlatform({ name: "test" });

      const runInput = {
        spec: { executable: "echo", args: ["platform-ok"], io: { mode: "pipe" as const } },
        timeoutMs: 5000,
        maxOutputBytes: 1024,
      };

      const res = await platform.process.run(runInput);
      assert.strictEqual(res.exit.code, 0);
      assert.ok((decodeText(res.chunks)).includes("platform-ok"));
    });

    it("显式注入 MemoryProcessDriver 时平台提供可用受管进程能力", async () => {
      const { MemoryProcessDriver } = await import("../src/process/driver");
      const platform = createNodePlatform({
        name: "test",
        processDriver: new MemoryProcessDriver(),
      });

      const startRes = await platform.process.start({
        requestId: "req-memory-driver-start",
        spec: { executable: "echo", args: [], io: { mode: "pipe" } },
      });
      assert.notStrictEqual(startRes.process.id, undefined);
      assert.strictEqual(startRes.process.state, "running");
    });

    it("支持显式注入自定义时钟 clock", () => {
      const fakeDate = new Date("2026-01-01T00:00:00.000Z");
      const customClock: Clock = {
        now: () => fakeDate,
        monotonic: () => 12345,
        sleep: async () => {},
      };

      const platform = createNodePlatform({ clock: customClock });
      assert.deepStrictEqual(platform.clock.now(), fakeDate);
      assert.strictEqual(platform.clock.monotonic(), 12345);
    });

    it("支持显式注入自定义进程执行器 process", async () => {
      let executedCommand = "";
      const customExecutor = {
        async run(input: any) {
          executedCommand = input.spec.executable;
          return {
            exit: { code: 0, signal: null },
            chunks: [{ stream: "stdout" as const, data: encodeBytes("custom output") }],
            truncated: false,
          };
        },
      } as unknown as ProcessAPI;

      const platform = createNodePlatform({ process: customExecutor });
      const res = await platform.process.run({
        spec: { executable: "echo test", args: [], io: { mode: "pipe" } },
        timeoutMs: 5000,
        maxOutputBytes: 1024 * 1024,
      });
      assert.strictEqual(executedCommand, "echo test");
      assert.strictEqual(decodeText(res.chunks), "custom output");
    });

    it("支持显式注入自定义模块加载器 modules", async () => {
      let loadedSpecifier = "";
      const customLoader: ModuleLoader = {
        async load<T = any>(specifier: string): Promise<T> {
          loadedSpecifier = specifier;
          return { customModule: true } as unknown as T;
        },
      };

      const platform = createNodePlatform({ modules: customLoader });
      const mod = await platform.modules.load<any>("virtual:module");
      assert.strictEqual(loadedSpecifier, "virtual:module");
      assert.strictEqual(mod.customModule, true);
    });

    it("storage 工厂正确创建独立 SQLite 存储实例", async () => {
      const platform = createNodePlatform();
      const storage = platform.storage.createStorage("test-pkg", { inMemory: true });
      assert.notStrictEqual(storage, undefined);
      assert.strictEqual(storage.isOpen, true);

      storage.setConfig("FOO", "BAR");
      assert.strictEqual(storage.getConfig<string>("FOO"), "BAR");
      await storage.close();

      const globalStorage = platform.storage.createGlobalStorage({ inMemory: true });
      assert.notStrictEqual(globalStorage, undefined);
      assert.strictEqual(globalStorage.isOpen, true);
      await globalStorage.close();
    });
  });

  describe("ActionRunner 与 ExecutionService 平台集成与兼容性", () => {
    it("ActionRunner 支持仅传入 platform 创建并执行 Action", async () => {
      let processCalled = false;
      const customProcess = {
        async run() {
          processCalled = true;
          return {
            exit: { code: 0, signal: null },
            chunks: [{ stream: "stdout" as const, data: encodeBytes("ok") }],
            truncated: false,
          };
        },
      } as unknown as ProcessAPI;

      const testPlatform: RuntimePlatform = {
        name: "test",
        clock: {
          now: () => new Date("2026-06-01T12:00:00Z"),
          monotonic: () => 1000,
          sleep: async () => {},
        },
        modules: {
          load: async <T = any>() => ({}) as unknown as T,
        },
        process: customProcess,
        storage: {
          createStorage: (pkgId: any) =>
            new SqliteRuntimeStorage({ packageId: pkgId, dbPath: ":memory:" }),
          createGlobalStorage: () =>
            new SqliteRuntimeStorage({ packageId: "__global__", dbPath: ":memory:" }),
        },
      };

      const runner = new ActionRunner({
        identity: createPackageIdentity({ id: "test-pkg" }),
        clock: testPlatform.clock,
        process: testPlatform.process,
        storage: testPlatform.storage.createStorage("test-pkg"),
      });

      assert.notStrictEqual(runner.getStorage(), undefined);

      runner.registerAction({
        id: "ping",
        run: async (_input: unknown, ctx: ActionContext) => {
          await ctx.process.run({
            spec: { executable: "dummy", args: [], io: { mode: "pipe" } },
            timeoutMs: 5000,
            maxOutputBytes: 1024 * 1024,
          });
          return { pong: true };
        },
      });

      const res = await runner.execute("ping", {});
      assert.strictEqual(res.ok, true);
      if (res.ok) {
        assert.deepStrictEqual(res.data, { pong: true });
      }
      assert.strictEqual(processCalled, true);

      runner.getStorage().close();
    });

    it("DefaultExecutionService 支持传入 platform 并优先使用其环境组件", async () => {
      const fixedDate = new Date("2026-07-01T10:00:00Z");
      const memoryStorage = new SqliteRuntimeStorage({
        packageId: "exec-pkg",
        dbPath: ":memory:",
      });

      const testPlatform: RuntimePlatform = {
        name: "test",
        clock: {
          now: () => fixedDate,
          monotonic: () => 5000,
          sleep: async () => {},
        },
        modules: {
          load: async <T = any>() => ({}) as unknown as T,
        },
        process: {
          async run() {
            return {
              exit: { code: 0, signal: null },
              chunks: [{ stream: "stdout" as const, data: encodeBytes("platform-process") }],
              truncated: false,
            };
          },
        } as unknown as ProcessAPI,
        storage: {
          createStorage: () => memoryStorage,
          createGlobalStorage: () =>
            new SqliteRuntimeStorage({ packageId: "__global__", dbPath: ":memory:" }),
        },
      };

      const identity = createPackageIdentity({ id: "exec-pkg" });
      const service = new DefaultExecutionService({
        identity,
        clock: testPlatform.clock,
        process: testPlatform.process,
        storage: memoryStorage,
      });

      service.registerAction({
        id: "inspect",
        run: async (_input: unknown, ctx: ActionContext) => {
          const p = await ctx.process.run({
            spec: { executable: "cmd", args: [], io: { mode: "pipe" } },
            timeoutMs: 5000,
            maxOutputBytes: 1024 * 1024,
          });
          return { stdout: decodeText(p.chunks) };
        },
      });

      const result = await service.execute("inspect", {}, createInvocationContext({ package: identity }));
      assert.strictEqual(result.ok, true);
      if (result.ok) {
        assert.deepStrictEqual(result.data, { stdout: "platform-process" });
      }

      const record = await service.get(result.runId);
      assert.notStrictEqual(record, undefined);
      assert.strictEqual(record?.startedAt, fixedDate.toISOString());

      await service.close();
      memoryStorage.close();
    });

    it("未传入 platform 时完全回退至原有的 storage 与 clock 传参逻辑", async () => {
      const legacyStorage = new SqliteRuntimeStorage({
        packageId: "legacy-pkg",
        dbPath: ":memory:",
      });

      const legacyClock: Clock = {
        now: () => new Date("2025-01-01T00:00:00Z"),
        monotonic: () => 10,
        sleep: async () => {},
      };

      const identity = createPackageIdentity({ id: "legacy-pkg" });
      const service = new DefaultExecutionService({
        identity,
        storage: legacyStorage,
        clock: legacyClock,
      });

      service.registerAction({
        id: "echo",
        run: async (input: any) => input,
      });

      const res = await service.execute("echo", { text: "hello" }, createInvocationContext({ package: identity }));
      assert.strictEqual(res.ok, true);
      if (res.ok) {
        assert.deepStrictEqual(res.data, { text: "hello" });
      }

      const rec = await service.get(res.runId);
      assert.strictEqual(rec?.startedAt, new Date("2025-01-01T00:00:00Z").toISOString());

      await service.close();
      legacyStorage.close();
    });
  });
});
