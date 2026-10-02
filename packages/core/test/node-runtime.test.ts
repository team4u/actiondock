import { afterAll, beforeAll, describe, it } from "node:test";
import assert from "node:assert/strict";
import type * as cp from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { createServer, request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NodeHttpServer } from "../src/server/http-server";
import { NodeModuleLoader, unwrapDefaultExport } from "../src/platform/module-loader";
import { NodeSqliteDriver } from "../src/storage/sqlite-driver";
import { createRequestListener } from "../src/server/http-server";
import { killProcessGroup } from "../src/process/process-driver";

describe("NodeSqliteDriver 单元测试", () => {
  it("支持基础增删改查，正确处理展开参数与数组参数", () => {
    const driver = new NodeSqliteDriver(":memory:");
    assert.strictEqual(driver.isOpen, true);

    driver.exec(`
      CREATE TABLE users (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        age INTEGER NOT NULL
      )
    `);

    const insertStmt = driver.prepare("INSERT INTO users (id, name, age) VALUES (?, ?, ?)");

    // 展开位置参数
    const res1 = insertStmt.run(1, "Alice", 30);
    assert.strictEqual(res1.changes, 1);

    // 数组参数
    const res2 = insertStmt.run([2, "Bob", 25]);
    assert.strictEqual(res2.changes, 1);

    const getStmt = driver.prepare("SELECT * FROM users WHERE id = ?");
    const user1 = getStmt.get<{ id: number; name: string; age: number }>(1);
    assert.notStrictEqual(user1, undefined);
    assert.strictEqual(user1?.name, "Alice");
    assert.strictEqual(user1?.age, 30);

    const user2 = getStmt.get<{ id: number; name: string; age: number }>([2]);
    assert.notStrictEqual(user2, undefined);
    assert.strictEqual(user2?.name, "Bob");

    const allStmt = driver.prepare("SELECT * FROM users ORDER BY id ASC");
    const allUsers = allStmt.all<{ id: number; name: string; age: number }>();
    assert.strictEqual(allUsers.length, 2);
    assert.strictEqual(allUsers[0].name, "Alice");
    assert.strictEqual(allUsers[1].name, "Bob");

    // 更新
    const updateStmt = driver.prepare("UPDATE users SET age = ? WHERE id = ?");
    const updateRes = updateStmt.run([31, 1]);
    assert.strictEqual(updateRes.changes, 1);
    assert.strictEqual(getStmt.get<{ age: number }>(1)?.age, 31);

    // 删除
    const deleteStmt = driver.prepare("DELETE FROM users WHERE id = ?");
    const deleteRes = deleteStmt.run(2);
    assert.strictEqual(deleteRes.changes, 1);
    assert.strictEqual(getStmt.get(2), undefined);

    driver.close();
    assert.strictEqual(driver.isOpen, false);
  });

  it("支持同步事务成功提交", () => {
    const driver = new NodeSqliteDriver(":memory:");
    driver.exec("CREATE TABLE items (id INTEGER PRIMARY KEY, title TEXT)");

    const insert = driver.prepare("INSERT INTO items (id, title) VALUES (?, ?)");

    driver.transaction(() => {
      insert.run(1, "Task A");
      insert.run(2, "Task B");
    });

    const list = driver.prepare("SELECT * FROM items").all<{ id: number; title: string }>();
    assert.strictEqual(list.length, 2);

    driver.close();
  });

  it("发生异常时事务能够安全自动回滚", () => {
    const driver = new NodeSqliteDriver(":memory:");
    driver.exec("CREATE TABLE logs (id INTEGER PRIMARY KEY, msg TEXT)");

    const insert = driver.prepare("INSERT INTO logs (id, msg) VALUES (?, ?)");
    insert.run(1, "init");

    assert.throws(() => {
      driver.transaction(() => {
        insert.run(2, "transient");
        throw new Error("Trigger rollback");
      });
    }, /Trigger rollback/);

    const list = driver.prepare("SELECT * FROM logs").all();
    assert.strictEqual(list.length, 1);

    driver.close();
  });

  it("严格拦截并抛出非法异步事务，执行自动回滚", async () => {
    const driver = new NodeSqliteDriver(":memory:");
    driver.exec("CREATE TABLE records (id INTEGER PRIMARY KEY, content TEXT)");

    const insert = driver.prepare("INSERT INTO records (id, content) VALUES (?, ?)");

    let errorThrown = false;
    try {
      driver.transaction((async () => {
        insert.run(1, "async content");
        await new Promise((r) => setTimeout(r, 10));
      }) as any);
    } catch (err: any) {
      errorThrown = true;
      assert.ok((err.message).includes("Async transactions are not allowed in SQLite"));
    }

    assert.strictEqual(errorThrown, true);

    const list = driver.prepare("SELECT * FROM records").all();
    assert.strictEqual(list.length, 0);

    driver.close();
  });

  it("妥善管理关闭状态与防止无效调用", () => {
    const driver = new NodeSqliteDriver(":memory:");
    driver.close();
    assert.strictEqual(driver.isOpen, false);

    // 重复关闭不应报错
    assert.doesNotThrow(() => driver.close());

    // 关闭后调用应当拒绝
    assert.throws(() => driver.exec("SELECT 1"), /Database connection is closed/);
    assert.throws(() => driver.prepare("SELECT 1"), /Database connection is closed/);
    assert.throws(() => driver.transaction(() => {}), /Database connection is closed/);
  });
});

describe("killProcessGroup 跨平台终止行为", () => {
  it("Windows 平台环境下调用 killProcessGroup 优先执行 taskkill 并在成功后不抢先执行 process.kill", async () => {
    const origPlatform = process.platform;
    const origKill = process.kill;
    try {
      Object.defineProperty(process, "platform", { value: "win32", configurable: true });

      const spawnedCommands: { command: string; args: string[] }[] = [];
      let closeCallback: ((code: number) => void) | undefined;
      const mockSpawn = ((cmd: string, args: string[]) => {
        spawnedCommands.push({ command: cmd, args });
        return {
          on: (event: string, cb: any) => {
            if (event === "close") closeCallback = cb;
          },
        } as any;
      }) as typeof cp.spawn;

      const killedSignals: { pid: number; signal: string }[] = [];
      process.kill = ((pid: number, sig?: string | number) => {
        killedSignals.push({ pid, signal: String(sig) });
        return true;
      }) as any;

      // 启动 killProcessGroup：必须触发 taskkill，且在 taskkill 完成前严禁执行 process.kill，避免子进程孤儿化
      const killPromise = killProcessGroup(99999, "SIGTERM", mockSpawn);
      assert.strictEqual(spawnedCommands.length, 1);
      assert.strictEqual(spawnedCommands[0].command, "taskkill");
      assert.deepStrictEqual(spawnedCommands[0].args, ["/pid", "99999", "/T", "/F"]);
      assert.strictEqual(killedSignals.length, 0);

      // taskkill 成功完成（exit 0）
      closeCallback?.(0);
      await killPromise;
      // taskkill 已成功销毁整棵进程树，process.kill 不应被调用
      assert.strictEqual(killedSignals.length, 0);
    } finally {
      Object.defineProperty(process, "platform", { value: origPlatform, configurable: true });
      process.kill = origKill;
    }
  });

  it("Windows 平台环境下 taskkill 失败或退出码异常时回退调用 process.kill", async () => {
    const origPlatform = process.platform;
    const origKill = process.kill;
    try {
      Object.defineProperty(process, "platform", { value: "win32", configurable: true });

      let errorCallback: (() => void) | undefined;
      let closeCallback: ((code: number) => void) | undefined;
      const mockSpawn = ((cmd: string, args: string[]) => {
        return {
          on: (event: string, cb: any) => {
            if (event === "error") errorCallback = cb;
            if (event === "close") closeCallback = cb;
          },
        } as any;
      }) as typeof cp.spawn;

      const killedSignals: { pid: number; signal: string }[] = [];
      process.kill = ((pid: number, sig?: string | number) => {
        killedSignals.push({ pid, signal: String(sig) });
        return true;
      }) as any;

      // 1. taskkill 触发 error 事件时回退至 process.kill
      const errPromise = killProcessGroup(77777, "SIGTERM", mockSpawn);
      assert.strictEqual(killedSignals.length, 0);
      errorCallback?.();
      await errPromise;
      assert.strictEqual(killedSignals.length, 1);
      assert.deepStrictEqual(killedSignals[0], { pid: 77777, signal: "SIGTERM" });

      // 2. taskkill 退出码非 0 时回退至 process.kill
      killedSignals.length = 0;
      const nonZeroPromise = killProcessGroup(66666, "SIGKILL", mockSpawn);
      assert.strictEqual(killedSignals.length, 0);
      closeCallback?.(1);
      await nonZeroPromise;
      assert.strictEqual(killedSignals.length, 1);
      assert.deepStrictEqual(killedSignals[0], { pid: 66666, signal: "SIGKILL" });

      // 3. spawn 抛出同步异常时直接回退至 process.kill
      killedSignals.length = 0;
      const throwingSpawn = (() => {
        throw new Error("spawn failed");
      }) as unknown as typeof cp.spawn;
      await killProcessGroup(55555, "SIGTERM", throwingSpawn);
      assert.strictEqual(killedSignals.length, 1);
      assert.deepStrictEqual(killedSignals[0], { pid: 55555, signal: "SIGTERM" });
    } finally {
      Object.defineProperty(process, "platform", { value: origPlatform, configurable: true });
      process.kill = origKill;
    }
  });

});

describe("NodeModuleLoader 单元测试", () => {
  // 夹具统一落在系统临时目录（mkdtemp 随机子目录），避免污染仓库工作区
  const testDir = mkdtempSync(join(tmpdir(), "test-loader-"));

  beforeAll(() => {
    // mkdtempSync 已在声明处创建目录，此处无需重复创建
    writeFileSync(
      join(testDir, "service.ts"),
      `
      export const serviceName = "auth-service";
      export default function calculate(a: number, b: number): number {
        return a + b;
      }
      `
    );
    writeFileSync(
      join(testDir, "component.tsx"),
      `
      export const tag = "button";
      export default { render() { return tag; } };
      `
    );
    writeFileSync(
      join(testDir, "module.mts"),
      `
      export const magicNumber: number = 42;
      export default { magicNumber };
      `
    );
    writeFileSync(
      join(testDir, "legacy.cjs"),
      `
      module.exports = { legacy: true };
      `
    );
  });

  afterAll(() => {
    try {
      rmSync(testDir, { recursive: true, force: true });
    } catch {
      // 忽略清理异常
    }
  });

  it("支持加载 .ts 源码模块并提取命名与默认导出", async () => {
    const loader = new NodeModuleLoader();
    const filePath = join(testDir, "service.ts");

    const mod = await loader.load(filePath);
    assert.strictEqual(mod.serviceName, "auth-service");

    const calculate = await loader.loadDefault<(...args: number[]) => number>(filePath);
    assert.strictEqual(typeof calculate, "function");
    assert.strictEqual(calculate(10, 20), 30);
  });

  it("严格拒绝不受支持的 .tsx 扩展名", async () => {
    const loader = new NodeModuleLoader();
    const filePath = join(testDir, "component.tsx");

    await assert.rejects(loader.load(filePath), /unsupported extension '\.tsx'/);
  });

  it("严格拒绝不受支持的 .cjs 扩展名", async () => {
    const loader = new NodeModuleLoader();
    const filePath = join(testDir, "legacy.cjs");

    await assert.rejects(loader.load(filePath), /unsupported extension '\.cjs'/);
  });

  it("支持加载 .mts 源码模块", async () => {
    const loader = new NodeModuleLoader();
    const filePath = join(testDir, "module.mts");

    const mod = await loader.load(filePath);
    assert.strictEqual(mod.magicNumber, 42);

    const def = await loader.loadDefault<{ magicNumber: number }>(filePath);
    assert.strictEqual(def.magicNumber, 42);
  });

  it("支持显式相对路径解析与加载，并严格拒绝无扩展名解析", async () => {
    const loader = new NodeModuleLoader();

    // 显式扩展名解析成功
    const resolved = loader.resolve("./service.ts", join(testDir, "dummy.js"));
    assert.strictEqual(resolved.endsWith("service.ts"), true);

    const mod = await loader.load("./service.ts", join(testDir, "dummy.js"));
    assert.strictEqual(mod.serviceName, "auth-service");

    // 无扩展名解析严格拒绝
    assert.throws(() => loader.resolve("./service", join(testDir, "dummy.js")), 
      /missing file extension/);
  });

  it("解包辅助函数 unwrapDefaultExport 支持多层嵌套与 action 属性回退", () => {
    assert.strictEqual(unwrapDefaultExport(null), null);
    assert.strictEqual(unwrapDefaultExport<string>({ default: "val" }), "val");
    assert.strictEqual(unwrapDefaultExport<string>({ default: { default: "nested" } }), "nested");
    assert.deepStrictEqual(unwrapDefaultExport<any>({ action: { id: "test-act" } }), { id: "test-act" });
  });
});

describe("NodeHttpServer 单元测试", () => {
  it("正确将 IncomingMessage 转化为 Web Request 并通过 sendWebResponse 流式回写", async () => {
    let capturedMethod = "";
    let capturedPath = "";
    let capturedHeader = "";
    let capturedBody = "";

    const server = createServer(
      createRequestListener(async (req: any) => {
        capturedMethod = req.method;
        const url = new URL(req.url);
        capturedPath = url.pathname;
        capturedHeader = req.headers.get("x-custom-test") || "";
        capturedBody = await req.text();

        return new Response(JSON.stringify({ echo: capturedBody }), {
          status: 201,
          headers: {
            "Content-Type": "application/json",
            "x-response-sign": "actiondock-ok",
          },
        });
      })
    );

    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as any).port;

    const res = await fetch(`http://127.0.0.1:${port}/api/v1/test`, {
      method: "POST",
      headers: {
        "x-custom-test": "header-value-42",
        "Content-Type": "text/plain",
      },
      body: "hello web request",
    });

    assert.strictEqual(res.status, 201);
    assert.strictEqual(res.headers.get("x-response-sign"), "actiondock-ok");
    const json = await res.json();
    assert.deepStrictEqual(json, { echo: "hello web request" });

    assert.strictEqual(capturedMethod, "POST");
    assert.strictEqual(capturedPath, "/api/v1/test");
    assert.strictEqual(capturedHeader, "header-value-42");
    assert.strictEqual(capturedBody, "hello web request");

    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("支持流式响应传输", async () => {
    const testServer = await NodeHttpServer.start(async () => {
      const stream = new ReadableStream({
        async start(controller) {
          controller.enqueue(new TextEncoder().encode("part-1;"));
          await new Promise((r) => setTimeout(r, 20));
          controller.enqueue(new TextEncoder().encode("part-2;"));
          await new Promise((r) => setTimeout(r, 20));
          controller.enqueue(new TextEncoder().encode("part-3;"));
          controller.close();
        },
      });

      return new Response(stream, {
        headers: {
          "Content-Type": "text/plain; charset=utf-8",
        },
      });
    });

    const res = await fetch(`${testServer.url}/stream`);
    const reader = res.body?.getReader();
    assert.notStrictEqual(reader, undefined);

    const chunks: string[] = [];
    while (true) {
      const { done, value } = await reader!.read();
      if (done) break;
      chunks.push(new TextDecoder().decode(value));
    }

    const fullText = chunks.join("");
    assert.strictEqual(fullText, "part-1;part-2;part-3;");

    await testServer.close();
    assert.strictEqual(testServer.isListening, false);
  });

  it("处理 404 与服务端异常回退", async () => {
    const testServer = await NodeHttpServer.start(async (req) => {
      const url = new URL(req.url);
      if (url.pathname === "/boom") {
        throw new Error("Deliberate failure");
      }
      return new Response("ok", { status: 200 });
    });

    const errRes = await fetch(`${testServer.url}/boom`);
    assert.strictEqual(errRes.status, 500);
    const errJson = await errRes.json();
    assert.strictEqual(errJson.ok, false);
    assert.strictEqual(errJson.error.code, "SERVER_ERROR");
    assert.ok((errJson.error.message).includes("Deliberate failure"));

    await testServer.close();
  });

  it("当 URL 或 Host 格式异常时优雅返回 400 状态码响应", async () => {
    let handled = false;
    const listener = createRequestListener(async () => {
      handled = true;
      return new Response("ok");
    });

    const mockReq: any = {
      socket: {},
      headers: { host: "[invalid-host" },
      url: "/test",
      method: "GET",
      on: () => {},
    };

    let statusCode = 0;
    let responseBody = "";
    let headersSent = false;
    const mockRes: any = {
      get headersSent() {
        return headersSent;
      },
      set statusCode(code: number) {
        statusCode = code;
      },
      setHeader: () => {},
      end: (data: string) => {
        headersSent = true;
        responseBody = data;
      },
      destroy: () => {},
    };

    listener(mockReq, mockRes);
    assert.strictEqual(handled, false);
    assert.strictEqual(statusCode, 400);
    const json = JSON.parse(responseBody);
    assert.strictEqual(json.ok, false);
    assert.strictEqual(json.error.code, "BAD_REQUEST");
  });

  it("客户端在服务端响应完成前断开时（!res.writableFinished），createWebRequest 正确触发 abort", async () => {
    let aborted = false;
    let signalTriggered = false;

    const server = createServer(
      createRequestListener(async (req: any) => {
        req.signal.addEventListener("abort", () => {
          aborted = true;
        });

        // 模拟长耗时异步处理
        for (let i = 0; i < 40; i++) {
          if (req.signal.aborted) {
            signalTriggered = true;
            break;
          }
          await new Promise((r) => setTimeout(r, 20));
        }

        return new Response("done");
      })
    );

    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as any).port;

    const clientReq = request({
      hostname: "127.0.0.1",
      port,
      path: "/test",
      method: "GET",
    });

    clientReq.on("error", () => {});
    clientReq.end();

    await new Promise((r) => setTimeout(r, 40));
    // 提前销毁客户端连接
    clientReq.destroy();

    for (let i = 0; i < 40; i++) {
      if (aborted && signalTriggered) break;
      await new Promise((r) => setTimeout(r, 20));
    }

    assert.strictEqual(aborted, true);
    assert.strictEqual(signalTriggered, true);

    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("NodeHttpServer 绑定 IPv6 地址时 url 属性正确包含中括号", async () => {
    const server = new NodeHttpServer({
      port: 0,
      host: "::1",
      fetch: async () => new Response("ok"),
    });

    await server.listen(0, "::1");
    try {
      assert.ok(/^http:\/\/\[::1\]:\d+$/.test(server.url));
      assert.doesNotThrow(() => new URL(server.url));
    } finally {
      await server.close();
    }
  });

  it("close 强制断开 keep-alive 空闲连接，关闭 Promise 必然 resolve", async () => {
    const server = new NodeHttpServer({
      port: 0,
      host: "127.0.0.1",
      fetch: async () => new Response("ok"),
    });

    const { port } = await server.listen(0, "127.0.0.1");

    // 建立 keep-alive 空闲连接：响应完成后连接保持打开等待复用
    const response = await fetch(`http://127.0.0.1:${port}/`, {
      headers: { connection: "keep-alive" },
    });
    assert.strictEqual(await response.text(), "ok");

    // 若未强制断连，server.close 会因空闲连接悬挂而不 resolve
    const timeoutSignal = AbortSignal.timeout(3000);
    const closePromise = server.close();
    const guard = new Promise<"timeout">((resolve) => {
      const t = setTimeout(() => resolve("timeout"), 3000);
      timeoutSignal.addEventListener("abort", () => {
        clearTimeout(t);
        resolve("timeout");
      });
    });

    const winner = await Promise.race([closePromise.then(() => "closed" as const), guard]);
    assert.strictEqual(winner, "closed");
    assert.strictEqual(server.isListening, false);
  });
});
