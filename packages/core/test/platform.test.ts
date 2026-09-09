import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ActionContext, ProcessAPI, ProcessResult } from "@actiondock/sdk";
import {
  ActionRunner,
  createDefaultPlatform,
  DefaultExecutionService,
  NodeFileSystem,
  SqliteRuntimeStorage,
  type Clock,
  type ModuleLoader,
  type ProcessExecutor,
  type RuntimePlatform,
} from "../src";

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

  describe("createDefaultPlatform 平台组装与显式注入测试", () => {
    it("具备标准 RuntimePlatform 属性契约并默认使用 Node 原生驱动", () => {
      const platform = createDefaultPlatform({ name: "test" });
      expect(platform.name).toBe("test");
      expect(platform.clock).toBeDefined();
      expect(platform.clock.now()).toBeInstanceOf(Date);
      expect(platform.files).toBeDefined();
      expect(platform.modules).toBeDefined();
      expect(platform.process).toBeDefined();
      expect(platform.storage).toBeDefined();
      expect(platform.http).toBeDefined();
    });

    it("支持显式注入自定义时钟 clock", () => {
      const fakeDate = new Date("2026-01-01T00:00:00.000Z");
      const customClock: Clock = {
        now: () => fakeDate,
        monotonic: () => 12345,
        sleep: async () => {},
      };

      const platform = createDefaultPlatform({ clock: customClock });
      expect(platform.clock.now()).toEqual(fakeDate);
      expect(platform.clock.monotonic()).toBe(12345);
    });

    it("支持显式注入自定义进程执行器 process", async () => {
      let executedCommand = "";
      const customExecutor: ProcessExecutor = {
        async exec(command: string): Promise<ProcessResult> {
          executedCommand = command;
          return {
            ok: true,
            exitCode: 0,
            stdout: "custom output",
            stderr: "",
            durationMs: 1,
            timedOut: false,
            cancelled: false,
            raw: new Uint8Array(),
          };
        },
        async spawnDetached() {
          return { ok: true, durationMs: 0, ready: true };
        },
      };

      const platform = createDefaultPlatform({ process: customExecutor });
      const res = await platform.process.exec("echo test");
      expect(executedCommand).toBe("echo test");
      expect(res.stdout).toBe("custom output");
    });

    it("支持显式注入自定义模块加载器 modules", async () => {
      let loadedSpecifier = "";
      const customLoader: ModuleLoader = {
        async load<T = any>(specifier: string): Promise<T> {
          loadedSpecifier = specifier;
          return { customModule: true } as unknown as T;
        },
      };

      const platform = createDefaultPlatform({ modules: customLoader });
      const mod = await platform.modules.load<any>("virtual:module");
      expect(loadedSpecifier).toBe("virtual:module");
      expect(mod.customModule).toBe(true);
    });

    it("支持显式注入自定义 HTTP 服务工厂 http", async () => {
      let launchedWithPort = 0;
      const customHttp = {
        async launchHttpServer(opts: any) {
          launchedWithPort = opts.port;
          return {
            port: opts.port,
            stop: () => {},
            ready: Promise.resolve(),
          };
        },
      };

      const platform = createDefaultPlatform({ http: customHttp });
      const server = await platform.http?.launchHttpServer({
        port: 9876,
        host: "127.0.0.1",
        fetch: async () => new Response("ok"),
      });

      expect(launchedWithPort).toBe(9876);
      expect(server.port).toBe(9876);
    });

    it("storage 工厂正确创建独立 SQLite 存储实例", () => {
      const platform = createDefaultPlatform();
      const storage = platform.storage.createStorage("test-pkg", { inMemory: true });
      expect(storage).toBeDefined();
      expect(storage.isOpen).toBe(true);

      storage.setConfig("FOO", "BAR");
      expect(storage.getConfig<string>("FOO")).toBe("BAR");
      storage.close();

      const globalStorage = platform.storage.createGlobalStorage({ inMemory: true });
      expect(globalStorage).toBeDefined();
      expect(globalStorage.isOpen).toBe(true);
      globalStorage.close();
    });
  });

  describe("ActionRunner 与 ExecutionService 平台集成与兼容性", () => {
    it("ActionRunner 支持仅传入 platform 创建并执行 Action", async () => {
      let processCalled = false;
      const customProcess: ProcessAPI = {
        async exec(): Promise<ProcessResult> {
          processCalled = true;
          return {
            ok: true,
            exitCode: 0,
            stdout: "ok",
            stderr: "",
            raw: new Uint8Array(),
            timedOut: false,
            cancelled: false,
            durationMs: 0,
          };
        },
        async spawnDetached() {
          return { ok: true, durationMs: 0, ready: true };
        },
      };

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
        packageId: "test-pkg",
        platform: testPlatform,
      });

      expect(runner.getStorage()).toBeDefined();

      runner.registerAction({
        id: "ping",
        run: async (_input: unknown, ctx: ActionContext) => {
          await ctx.process.exec("dummy");
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
          async exec(): Promise<ProcessResult> {
            return {
              ok: true,
              exitCode: 0,
              stdout: "platform-process",
              stderr: "",
              raw: new Uint8Array(),
              timedOut: false,
              cancelled: false,
              durationMs: 0,
            };
          },
          async spawnDetached() {
            return { ok: true, durationMs: 0, ready: true };
          },
        },
        storage: {
          createStorage: () => memoryStorage,
          createGlobalStorage: () =>
            new SqliteRuntimeStorage({ packageId: "__global__", dbPath: ":memory:" }),
        },
      };

      const service = new DefaultExecutionService({
        packageId: "exec-pkg",
        platform: testPlatform,
      });

      service.registerAction({
        id: "inspect",
        run: async (_input: unknown, ctx: ActionContext) => {
          const p = await ctx.process.exec("cmd");
          return { stdout: p.stdout };
        },
      });

      const result = await service.execute("inspect", {});
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

      const service = new DefaultExecutionService({
        packageId: "legacy-pkg",
        storage: legacyStorage,
        clock: legacyClock,
      });

      service.registerAction({
        id: "echo",
        run: async (input: any) => input,
      });

      const res = await service.execute("echo", { text: "hello" });
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
