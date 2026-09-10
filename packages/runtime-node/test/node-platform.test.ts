import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DefaultExecutionService,
  NodeFileSystem,
  SqliteRuntimeStorage,
  SystemClock,
} from "@actiondock/core";
import { defineAction } from "@actiondock/sdk";
import {
  createNodePlatform,
  ExecaProcessExecutor,
  NodeHttpServer,
  NodeSqliteDriver,
  TsxModuleLoader,
} from "../src";

describe("createNodePlatform 平台工厂测试", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "ad-node-platform-test-"));
  });

  afterEach(() => {
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // 忽略清理异常
    }
  });

  describe("组件组装与契约校验", () => {
    it("具备标准 Node 运行时平台属性契约", () => {
      const platform = createNodePlatform({ rootDir: tempDir });

      expect(platform.name).toBe("node");
      expect(platform.clock).toBeInstanceOf(SystemClock);
      expect(platform.files).toBeInstanceOf(NodeFileSystem);
      expect(platform.modules).toBeInstanceOf(TsxModuleLoader);
      expect(platform.process).toBeInstanceOf(ExecaProcessExecutor);
      expect(platform.storage).toBeDefined();
      expect(typeof platform.storage.createStorage).toBe("function");
      expect(typeof platform.storage.createGlobalStorage).toBe("function");
      expect(platform.http).toBeDefined();
      expect(typeof platform.http?.launchHttpServer).toBe("function");
    });

    it("时钟驱动正常工作并提供时间服务", async () => {
      const platform = createNodePlatform();
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
      const platform = createNodePlatform({ rootDir: tempDir });
      const testFile = join(tempDir, "sample.txt");

      await platform.files.writeFile(testFile, "ActionDock Node Platform");
      expect(await platform.files.exists(testFile)).toBe(true);

      const content = await platform.files.readFile(testFile);
      expect(content).toBe("ActionDock Node Platform");

      const stat = await platform.files.stat(testFile);
      expect(stat.isFile()).toBe(true);
      expect(stat.isDirectory()).toBe(false);

      const outsidePath = join(tempDir, "..", "outside-escape.txt");
      await expect(platform.files.writeFile(outsidePath, "escape")).rejects.toThrow();
    });

    it("进程执行驱动能够基于 ExecaProcessExecutor 执行命令并捕获输出", async () => {
      const platform = createNodePlatform();
      const result = await platform.process.exec("node", ["-e", "console.log('hello from node')"]);

      expect(result.ok).toBe(true);
      expect(result.exitCode).toBe(0);
      expect(result.stdout.trim()).toBe("hello from node");
    });

    it("模块加载驱动能够基于 NodeModuleLoader 正常解析带扩展名模块并拒绝无扩展名", async () => {
      const platform = createNodePlatform({ rootDir: tempDir });
      const fooFile = join(tempDir, "foo.ts");
      await platform.files.writeFile(fooFile, "export const val = 42;");
      const resolved = platform.modules.resolve?.("./foo.ts", join(tempDir, "index.ts"));
      expect(resolved).toBe(fooFile);
      expect(() => platform.modules.resolve?.("./foo", join(tempDir, "index.ts"))).toThrow();
    });
  });

  describe("存储工厂与驱动支持", () => {
    it("基于 NodeSqliteDriver 创建内存数据库并读写配置与状态", async () => {
      const platform = createNodePlatform();
      const storage = platform.storage.createStorage("test-pkg", { inMemory: true });

      expect(storage).toBeInstanceOf(SqliteRuntimeStorage);
      expect(storage.isOpen).toBe(true);

      storage.setConfig("SERVER_PORT", 8080);
      expect(storage.getConfig<number>("SERVER_PORT")).toBe(8080);

      storage.setState("test-run", "progress", { step: 1 });
      expect(await storage.getState<any>("test-run", "progress")).toEqual({ step: 1 });

      storage.close();
    });

    it("支持自定义 dataDir 与 customHome 路径配置", () => {
      const dataDir = join(tempDir, "custom-data");
      const platform = createNodePlatform({ dataDir, customHome: tempDir });

      const storage = platform.storage.createStorage("scoped-pkg");
      expect(storage.isOpen).toBe(true);
      storage.setConfig("KEY", "VALUE");
      expect(storage.getConfig<string>("KEY")).toBe("VALUE");
      storage.close();

      const globalStorage = platform.storage.createGlobalStorage();
      expect(globalStorage.isOpen).toBe(true);
      globalStorage.setConfig("GLOBAL_KEY", "GLOBAL_VAL");
      expect(globalStorage.getConfig<string>("GLOBAL_KEY")).toBe("GLOBAL_VAL");
      globalStorage.close();
    });

    it("支持自定义 driverFactory 参数覆盖默认驱动生成", () => {
      let customFactoryCalled = false;
      const platform = createNodePlatform({
        driverFactory: (dbPath: string) => {
          customFactoryCalled = true;
          return new NodeSqliteDriver(dbPath);
        },
      });

      const storage = platform.storage.createStorage("pkg-driver-test", { inMemory: true });
      expect(customFactoryCalled).toBe(true);
      expect(storage.isOpen).toBe(true);
      storage.close();
    });
  });

  describe("网络服务启动工厂", () => {
    it("基于 NodeHttpServer 启动 HTTP 服务并响应请求", async () => {
      const platform = createNodePlatform();
      const serverInstance = await platform.http?.launchHttpServer({
        port: 0,
        host: "127.0.0.1",
        fetch: async () => new Response(JSON.stringify({ status: "ok" }), {
          headers: { "Content-Type": "application/json" },
        }),
      });

      expect(serverInstance).toBeDefined();
      expect(serverInstance.port).toBeGreaterThan(0);

      const res = await fetch(`http://127.0.0.1:${serverInstance.port}/`);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json).toEqual({ status: "ok" });

      await serverInstance.stop();
    });
  });

  describe("内核执行服务平台集成", () => {
    it("注入至 DefaultExecutionService 并成功驱动 Action 执行", async () => {
      const platform = createNodePlatform({
        dataDir: join(tempDir, "node-exec-data"),
        customHome: tempDir,
      });
      const testAction = defineAction({
        run: async (_input, ctx) => {
          await ctx.state.set("executed", true);
          return {
            msg: "node-platform-success",
            time: Date.now(),
          };
        },
      });

      const service = new DefaultExecutionService({
        packageId: "node-test-package",
        platform,
      });

      service.registerAction("echo-action", testAction);

      const ticket = await service.start("echo-action", {});
      const result = await ticket.result!;

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect((result.data as any).msg).toBe("node-platform-success");
      }

      await service.close();
    });
  });
});
