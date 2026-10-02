import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { decodeText, defineAction } from "@actiondock/sdk";
import { createNodePlatform } from "../src";
import { createInvocationContext } from "../src/execution/types";
import { SqliteRuntimeStorage } from "../src/storage/sqlite";
import { SystemClock } from "../src/storage/clock";
import { createPackageIdentity } from "../src/runtime/identity";
import { DefaultExecutionService } from "../src/execution/service";
import { NodeFileSystem } from "../src/platform/node-fs";
import { NodeHttpServer } from "../src/server/http-server";
import { NodeModuleLoader } from "../src/platform/module-loader";
import { NodeSqliteDriver } from "../src/storage/sqlite-driver";

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

      assert.strictEqual(platform.name, "node");
      assert.ok(platform.clock instanceof SystemClock);
      assert.ok(platform.files instanceof NodeFileSystem);
      assert.notStrictEqual(platform.process, undefined);
      assert.strictEqual(typeof platform.process.run, "function");
      assert.strictEqual(typeof platform.process.start, "function");
      assert.notStrictEqual(platform.storage, undefined);
      assert.strictEqual(typeof platform.storage.createStorage, "function");
      assert.strictEqual(typeof platform.storage.createGlobalStorage, "function");
    });

    it("时钟驱动正常工作并提供时间服务", async () => {
      const platform = createNodePlatform();
      const before = Date.now();
      const now = platform.clock.now();
      const after = Date.now();

      assert.ok((now.getTime()) >= before);
      assert.ok((now.getTime()) <= after);

      const mono1 = platform.clock.monotonic();
      await platform.clock.sleep(10);
      const mono2 = platform.clock.monotonic();
      assert.ok((mono2) > mono1);
    });

    it("文件系统驱动基于 NodeFileSystem 正常读写并受沙箱约束", async () => {
      const platform = createNodePlatform({ rootDir: tempDir });
      const testFile = join(tempDir, "sample.txt");

      await platform.files.writeFile(testFile, "ActionDock Node Platform");
      assert.strictEqual(await platform.files.exists(testFile), true);

      const content = await platform.files.readFile(testFile);
      assert.strictEqual(content, "ActionDock Node Platform");

      const stat = await platform.files.stat(testFile);
      assert.strictEqual(stat.isFile(), true);
      assert.strictEqual(stat.isDirectory(), false);

      const outsidePath = join(tempDir, "..", "outside-escape.txt");
      await assert.rejects(platform.files.writeFile(outsidePath, "escape"));
    });

    it("进程执行驱动能够基于 ProcessManager 与 NodeProcessDriver 执行命令并捕获输出", async () => {
      const platform = createNodePlatform();
      const result = await platform.process.run({
        spec: {
          executable: "node",
          args: ["-e", "console.log('hello from node')"],
          io: { mode: "pipe" },
        },
        timeoutMs: 5000,
        maxOutputBytes: 1024 * 1024,
      });

      assert.strictEqual(result.exit.code, 0);
      const text = decodeText(result.chunks);
      assert.strictEqual(text.trim(), "hello from node");
    });

    it("模块加载驱动能够基于 NodeModuleLoader 正常解析带扩展名模块并拒绝无扩展名", async () => {
      const platform = createNodePlatform({ rootDir: tempDir });
      const fooFile = join(tempDir, "foo.ts");
      await platform.files.writeFile(fooFile, "export const val = 42;");
      const resolved = platform.modules.resolve?.("./foo.ts", join(tempDir, "index.ts"));
      assert.strictEqual(resolved, fooFile);
      assert.throws(() => platform.modules.resolve?.("./foo", join(tempDir, "index.ts")));
    });
  });

  describe("存储工厂与驱动支持", () => {
    it("基于 NodeSqliteDriver 创建内存数据库并读写配置与状态", async () => {
      const platform = createNodePlatform();
      const storage = platform.storage.createStorage("test-pkg", { inMemory: true });

      assert.ok(storage instanceof SqliteRuntimeStorage);
      assert.strictEqual(storage.isOpen, true);

      storage.setConfig("SERVER_PORT", 8080);
      assert.strictEqual(storage.getConfig<number>("SERVER_PORT"), 8080);

      storage.setState("test-run", "progress", { step: 1 });
      assert.deepStrictEqual(await storage.getState<any>("test-run", "progress"), { step: 1 });

      await storage.close();
    });

    it("支持自定义 dataDir 与 customHome 路径配置", async () => {
      const dataDir = join(tempDir, "custom-data");
      const platform = createNodePlatform({ dataDir, customHome: tempDir });

      const storage = platform.storage.createStorage("scoped-pkg");
      assert.strictEqual(storage.isOpen, true);
      storage.setConfig("KEY", "VALUE");
      assert.strictEqual(storage.getConfig<string>("KEY"), "VALUE");
      await storage.close();

      const globalStorage = platform.storage.createGlobalStorage();
      assert.strictEqual(globalStorage.isOpen, true);
      globalStorage.setConfig("GLOBAL_KEY", "GLOBAL_VAL");
      assert.strictEqual(globalStorage.getConfig<string>("GLOBAL_KEY"), "GLOBAL_VAL");
      await globalStorage.close();
    });

    it("支持自定义 driverFactory 参数覆盖默认驱动生成", async () => {
      let customFactoryCalled = false;
      const platform = createNodePlatform({
        driverFactory: (dbPath: string) => {
          customFactoryCalled = true;
          return new NodeSqliteDriver(dbPath);
        },
      });

      const storage = platform.storage.createStorage("pkg-driver-test", { inMemory: true });
      assert.strictEqual(customFactoryCalled, true);
      assert.strictEqual(storage.isOpen, true);
      await storage.close();
    });

    it("默认使用 NodeSqliteDriver 同步存储驱动", async () => {
      const platform = createNodePlatform();
      const storage = platform.storage.createStorage("worker-default-test", { inMemory: true });
      assert.ok(storage instanceof SqliteRuntimeStorage);
      assert.ok((storage as any).driver instanceof NodeSqliteDriver);
      await storage.close();
    });
  });

  describe("网络服务启动", () => {
    it("基于 NodeHttpServer 启动 HTTP 服务并响应请求", async () => {
      const server = new NodeHttpServer({
        port: 0,
        host: "127.0.0.1",
        fetch: async () => new Response(JSON.stringify({ status: "ok" }), {
          headers: { "Content-Type": "application/json" },
        }),
      });
      await server.listen(0, "127.0.0.1");

      assert.ok((server.port) > 0);

      const res = await fetch(`http://127.0.0.1:${server.port}/`);
      assert.strictEqual(res.status, 200);
      const json = await res.json();
      assert.deepStrictEqual(json, { status: "ok" });

      await server.stop();
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

      const identity = createPackageIdentity({ id: "node-test-package" });
      const service = new DefaultExecutionService({
        identity,
        clock: platform.clock,
        process: platform.process,
        storage: platform.storage.createStorage("node-test-package"),
      });

      service.registerAction("echo-action", testAction);

      const ticket = await service.start("echo-action", {}, createInvocationContext({ package: identity }));
      const result = await ticket.result!;

      assert.strictEqual(result.ok, true);
      if (result.ok) {
        assert.strictEqual((result.data as any).msg, "node-platform-success");
      }

      await service.close();
    });
  });
});
