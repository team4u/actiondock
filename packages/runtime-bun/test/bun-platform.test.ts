import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DefaultExecutionService,
  DefaultModuleLoader,
  NodeFileSystem,
  SqliteRuntimeStorage,
  SystemClock,
} from "@actiondock/core";
import { defineAction } from "@actiondock/sdk";
import {
  BunHttpServer,
  BunProcessExecutor,
  BunSqliteDriver,
  createBunPlatform,
} from "../src";

describe("createBunPlatform 平台工厂测试", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "ad-bun-platform-test-"));
  });

  afterEach(() => {
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // 忽略清理异常
    }
  });

  describe("组件组装与契约校验", () => {
    it("具备标准 Bun 运行时平台属性契约", () => {
      const platform = createBunPlatform({ rootDir: tempDir });

      expect(platform.name).toBe("bun");
      expect(platform.clock).toBeInstanceOf(SystemClock);
      expect(platform.files).toBeInstanceOf(NodeFileSystem);
      expect(platform.modules).toBeInstanceOf(DefaultModuleLoader);
      expect(platform.process).toBeInstanceOf(BunProcessExecutor);
      expect(platform.storage).toBeDefined();
      expect(typeof platform.storage.createStorage).toBe("function");
      expect(typeof platform.storage.createGlobalStorage).toBe("function");
      expect(platform.http).toBeDefined();
      expect(typeof platform.http?.launchHttpServer).toBe("function");
    });

    it("时钟驱动正常工作并提供时间服务", async () => {
      const platform = createBunPlatform();
      const before = Date.now();
      const now = platform.clock.now();
      const after = Date.now();

      expect(now.getTime()).toBeGreaterThanOrEqual(before);
      expect(now.getTime()).toBeLessThanOrEqual(after);

      const mono1 = platform.clock.monotonic();
      await platform.clock.sleep(10);
      const mono2 = platform.clock.monotonic();
      expect(mono2).toBeGreaterThan(mono1);
    });

    it("文件系统驱动基于 NodeFileSystem 正常读写并受沙箱约束", async () => {
      const platform = createBunPlatform({ rootDir: tempDir });
      const testFile = join(tempDir, "bun-sample.txt");

      await platform.files.writeFile(testFile, "ActionDock Bun Platform");
      expect(await platform.files.exists(testFile)).toBe(true);

      const content = await platform.files.readFile(testFile);
      expect(content).toBe("ActionDock Bun Platform");

      const stat = await platform.files.stat(testFile);
      expect(stat.isFile()).toBe(true);
      expect(stat.isDirectory()).toBe(false);

      const outsidePath = join(tempDir, "..", "outside-bun-escape.txt");
      await expect(platform.files.writeFile(outsidePath, "escape")).rejects.toThrow();
    });

    it("进程执行驱动能够基于 BunProcessExecutor 执行命令并捕获输出", async () => {
      const platform = createBunPlatform();
      const result = await platform.process.exec("echo", ["hello from bun process"]);

      expect(result.ok).toBe(true);
      expect(result.exitCode).toBe(0);
      expect(result.stdout.trim()).toBe("hello from bun process");
    });
  });

  describe("存储工厂与驱动支持", () => {
    it("基于 BunSqliteDriver 创建内存数据库并读写配置与状态", async () => {
      const platform = createBunPlatform();
      const storage = platform.storage.createStorage("test-pkg", { inMemory: true });

      expect(storage).toBeInstanceOf(SqliteRuntimeStorage);
      expect(storage.isOpen).toBe(true);

      storage.setConfig("DB_FLAG", "ACTIVE");
      expect(storage.getConfig<string>("DB_FLAG")).toBe("ACTIVE");

      storage.setState("run-123", "key", { done: true });
      expect(await storage.getState<any>("run-123", "key")).toEqual({ done: true });

      storage.close();
    });

    it("支持自定义 dataDir 与 customHome 路径配置", () => {
      const dataDir = join(tempDir, "bun-custom-data");
      const platform = createBunPlatform({ dataDir, customHome: tempDir });

      const storage = platform.storage.createStorage("bun-scoped-pkg");
      expect(storage.isOpen).toBe(true);
      storage.setConfig("TEST_KEY", "TEST_VAL");
      expect(storage.getConfig("TEST_KEY") as any).toBe("TEST_VAL");
      storage.close();

      const globalStorage = platform.storage.createGlobalStorage();
      expect(globalStorage.isOpen).toBe(true);
      globalStorage.setConfig("GLOBAL_BUN_KEY", "VAL");
      expect(globalStorage.getConfig("GLOBAL_BUN_KEY") as any).toBe("VAL");
      globalStorage.close();
    });

    it("支持自定义 driverFactory 参数覆盖默认驱动生成", () => {
      let customFactoryCalled = false;
      const platform = createBunPlatform({
        driverFactory: (dbPath: string) => {
          customFactoryCalled = true;
          return new BunSqliteDriver(dbPath);
        },
      });

      const storage = platform.storage.createStorage("bun-driver-pkg", { inMemory: true });
      expect(customFactoryCalled).toBe(true);
      expect(storage.isOpen).toBe(true);
      storage.close();
    });
  });

  describe("网络服务启动工厂", () => {
    it("基于 BunHttpServer 启动 HTTP 服务并响应请求", async () => {
      const platform = createBunPlatform();
      const serverInstance = await platform.http?.launchHttpServer({
        port: 0,
        host: "127.0.0.1",
        fetch: async () => new Response(JSON.stringify({ bun: "ready" }), {
          headers: { "Content-Type": "application/json" },
        }),
      });

      expect(serverInstance).toBeDefined();
      expect(serverInstance.port).toBeGreaterThan(0);

      const res = await fetch(`http://127.0.0.1:${serverInstance.port}/`);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json).toEqual({ bun: "ready" });

      await serverInstance.stop();
    });
  });

  describe("内核执行服务平台集成", () => {
    it("注入至 DefaultExecutionService 并成功驱动 Action 执行", async () => {
      const platform = createBunPlatform({
        dataDir: join(tempDir, "bun-exec-data"),
        customHome: tempDir,
      });
      const testAction = defineAction({
        id: "bun-action",
        description: "Bun 平台测试动作",
        run: async (_input, ctx) => {
          await ctx.state.set("bun_executed", true);
          return {
            msg: "bun-platform-success",
            time: Date.now(),
          };
        },
      });

      const service = new DefaultExecutionService({
        packageId: "bun-test-package",
        platform,
      });

      service.registerAction(testAction);

      const ticket = await service.start("bun-action", {});
      const result: any = await ticket.result!;

      expect(result).toBeDefined();
      expect(result.ok).toBe(true);
      expect((result.data as any).msg).toBe("bun-platform-success");

      await service.close();
    });
  });
});
