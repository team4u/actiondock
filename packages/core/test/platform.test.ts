import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { decodeText, encodeBytes, type ActionContext, type ProcessAPI, type ProcessResult } from "@actiondock/sdk";
import { ActionRunner } from "../src/runtime/runner";
import { createNodePlatform } from "../src";
import { createInvocationContext } from "../src/execution/types";
import {
  SqliteRuntimeStorage,
  type Clock,
  type ModuleLoader,
  type ProcessExecutor,
  type RuntimePlatform,
} from "../src/package";
import { createPackageIdentity } from "../src/runtime/identity";
import { DefaultExecutionService } from "../src/execution/service";
import { NodeFileSystem } from "../src/platform/node-fs";

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

  describe("NodeFileSystem 文件系统实现", () => {
    it("支持基础文件读写、元数据读取与目录枚举", async () => {
      const fs = new NodeFileSystem({ rootDir: tempDir });

      const filePath = join(tempDir, "hello.txt");
      expect(await fs.exists(filePath)).toBe(false);

      await fs.writeFile(filePath, "Hello ActionDock!");
      expect(await fs.exists(filePath)).toBe(true);

      const content = await fs.readFile(filePath);
      expect(content).toBe("Hello ActionDock!");

      const stat = await fs.stat(filePath);
      expect(stat.isFile()).toBe(true);
      expect(stat.isDirectory()).toBe(false);
      expect(stat.size).toBe(17);

      const subDir = join(tempDir, "sub-dir");
      await fs.mkdir(subDir);
      expect(await fs.exists(subDir)).toBe(true);

      const dirStat = await fs.stat(subDir);
      expect(dirStat.isDirectory()).toBe(true);

      const entries = await fs.readdir(tempDir);
      expect(entries).toContain("hello.txt");
      expect(entries).toContain("sub-dir");
    });

    it("支持文件与目录拷贝及删除", async () => {
      const fs = new NodeFileSystem({ rootDir: tempDir });
      const srcFile = join(tempDir, "source.txt");
      const destFile = join(tempDir, "dest.txt");

      await fs.writeFile(srcFile, "Source Content");
      await fs.copy(srcFile, destFile);

      expect(await fs.exists(destFile)).toBe(true);
      expect(await fs.readFile(destFile)).toBe("Source Content");

      await fs.rm(srcFile);
      expect(await fs.exists(srcFile)).toBe(false);
      expect(await fs.exists(destFile)).toBe(true);
    });

    it("当配置 rootDir 沙箱时严格拦截越界路径逃逸与空字节路径", async () => {
      const sandboxDir = join(tempDir, "sandbox");
      const fs = new NodeFileSystem({ rootDir: sandboxDir });
      await fs.mkdir(sandboxDir);

      const outsideFile = join(tempDir, "outside.txt");
      await expect(fs.writeFile(outsideFile, "hacked")).rejects.toThrow(/escapes boundary/);
      await expect(fs.readFile(outsideFile)).rejects.toThrow(/escapes boundary/);

      await expect(fs.readFile("test\0bad.txt")).rejects.toThrow(/null byte/);
    });
  });

  describe("createNodePlatform 平台组装与显式注入测试", () => {
    it("具备标准 RuntimePlatform 属性契约并默认使用 Node 原生驱动", () => {
      const platform = createNodePlatform({ name: "test" });
      expect(platform.name).toBe("test");
      expect(platform.clock).toBeDefined();
      expect(platform.clock.now()).toBeInstanceOf(Date);
      expect(platform.files).toBeDefined();
      expect(platform.modules).toBeDefined();
      expect(platform.process).toBeDefined();
      expect(platform.storage).toBeDefined();
    });

    it("默认具备可用 NodeProcessDriver 进程能力", async () => {
      const platform = createNodePlatform({ name: "test" });

      const runInput = {
        spec: { executable: "echo", args: ["platform-ok"], io: { mode: "pipe" as const } },
        timeoutMs: 5000,
        maxOutputBytes: 1024,
      };

      const res = await platform.process.run(runInput);
      expect(res.exit.code).toBe(0);
      expect(decodeText(res.chunks)).toContain("platform-ok");
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
      expect(startRes.process.id).toBeDefined();
      expect(startRes.process.state).toBe("running");
    });

    it("支持显式注入自定义时钟 clock", () => {
      const fakeDate = new Date("2026-01-01T00:00:00.000Z");
      const customClock: Clock = {
        now: () => fakeDate,
        monotonic: () => 12345,
        sleep: async () => {},
      };

      const platform = createNodePlatform({ clock: customClock });
      expect(platform.clock.now()).toEqual(fakeDate);
      expect(platform.clock.monotonic()).toBe(12345);
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
      expect(executedCommand).toBe("echo test");
      expect(decodeText(res.chunks)).toBe("custom output");
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
      expect(loadedSpecifier).toBe("virtual:module");
      expect(mod.customModule).toBe(true);
    });

    it("storage 工厂正确创建独立 SQLite 存储实例", async () => {
      const platform = createNodePlatform();
      const storage = platform.storage.createStorage("test-pkg", { inMemory: true });
      expect(storage).toBeDefined();
      expect(storage.isOpen).toBe(true);

      storage.setConfig("FOO", "BAR");
      expect(storage.getConfig<string>("FOO")).toBe("BAR");
      await storage.close();

      const globalStorage = platform.storage.createGlobalStorage({ inMemory: true });
      expect(globalStorage).toBeDefined();
      expect(globalStorage.isOpen).toBe(true);
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
        files: new NodeFileSystem(),
        modules: {
          load: async <T = any>() => ({}) as unknown as T,
        },
        process: customProcess,
        storage: {
          createStorage: (pkgId) =>
            new SqliteRuntimeStorage({ packageId: pkgId, dbPath: ":memory:" }),
          createGlobalStorage: () =>
            new SqliteRuntimeStorage({ packageId: "__global__", dbPath: ":memory:" }),
        },
      };

      const runner = new ActionRunner({
        identity: createPackageIdentity({ id: "test-pkg" }),
        platform: testPlatform,
        storage: testPlatform.storage.createStorage("test-pkg"),
      });

      expect(runner.getStorage()).toBeDefined();

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
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.data).toEqual({ pong: true });
      }
      expect(processCalled).toBe(true);

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
        files: new NodeFileSystem(),
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
        platform: testPlatform,
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
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data).toEqual({ stdout: "platform-process" });
      }

      const record = await service.get(result.runId);
      expect(record).toBeDefined();
      expect(record?.startedAt).toBe(fixedDate.toISOString());

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
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.data).toEqual({ text: "hello" });
      }

      const rec = await service.get(res.runId);
      expect(rec?.startedAt).toBe(new Date("2025-01-01T00:00:00Z").toISOString());

      await service.close();
      legacyStorage.close();
    });
  });
});
