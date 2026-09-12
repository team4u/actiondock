import { afterAll, beforeAll, describe, expect, it } from "bun:test";
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
import {
  createRequestListener,
  ExecaProcessExecutor,
  killProcessGroup,
  NodeHttpServer,
  NodeModuleLoader,
  NodeProcessExecutor,
  NodeSqliteDriver,
  unwrapDefaultExport,
} from "../src";

describe("NodeSqliteDriver 单元测试", () => {
  it("支持基础增删改查，正确处理展开参数与数组参数", () => {
    const driver = new NodeSqliteDriver(":memory:");
    expect(driver.isOpen).toBe(true);

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
    expect(res1.changes).toBe(1);

    // 数组参数
    const res2 = insertStmt.run([2, "Bob", 25]);
    expect(res2.changes).toBe(1);

    const getStmt = driver.prepare("SELECT * FROM users WHERE id = ?");
    const user1 = getStmt.get<{ id: number; name: string; age: number }>(1);
    expect(user1).toBeDefined();
    expect(user1?.name).toBe("Alice");
    expect(user1?.age).toBe(30);

    const user2 = getStmt.get<{ id: number; name: string; age: number }>([2]);
    expect(user2).toBeDefined();
    expect(user2?.name).toBe("Bob");

    const allStmt = driver.prepare("SELECT * FROM users ORDER BY id ASC");
    const allUsers = allStmt.all<{ id: number; name: string; age: number }>();
    expect(allUsers.length).toBe(2);
    expect(allUsers[0].name).toBe("Alice");
    expect(allUsers[1].name).toBe("Bob");

    // 更新
    const updateStmt = driver.prepare("UPDATE users SET age = ? WHERE id = ?");
    const updateRes = updateStmt.run([31, 1]);
    expect(updateRes.changes).toBe(1);
    expect(getStmt.get<{ age: number }>(1)?.age).toBe(31);

    // 删除
    const deleteStmt = driver.prepare("DELETE FROM users WHERE id = ?");
    const deleteRes = deleteStmt.run(2);
    expect(deleteRes.changes).toBe(1);
    expect(getStmt.get(2)).toBeUndefined();

    driver.close();
    expect(driver.isOpen).toBe(false);
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
    expect(list.length).toBe(2);

    driver.close();
  });

  it("发生异常时事务能够安全自动回滚", () => {
    const driver = new NodeSqliteDriver(":memory:");
    driver.exec("CREATE TABLE logs (id INTEGER PRIMARY KEY, msg TEXT)");

    const insert = driver.prepare("INSERT INTO logs (id, msg) VALUES (?, ?)");
    insert.run(1, "init");

    expect(() => {
      driver.transaction(() => {
        insert.run(2, "transient");
        throw new Error("Trigger rollback");
      });
    }).toThrow("Trigger rollback");

    const list = driver.prepare("SELECT * FROM logs").all();
    expect(list.length).toBe(1);

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
      expect(err.message).toContain("Async transactions are not allowed in SQLite");
    }

    expect(errorThrown).toBe(true);

    const list = driver.prepare("SELECT * FROM records").all();
    expect(list.length).toBe(0);

    driver.close();
  });

  it("妥善管理关闭状态与防止无效调用", () => {
    const driver = new NodeSqliteDriver(":memory:");
    driver.close();
    expect(driver.isOpen).toBe(false);

    // 重复关闭不应报错
    expect(() => driver.close()).not.toThrow();

    // 关闭后调用应当拒绝
    expect(() => driver.exec("SELECT 1")).toThrow("Database connection is closed");
    expect(() => driver.prepare("SELECT 1")).toThrow("Database connection is closed");
    expect(() => driver.transaction(() => {})).toThrow("Database connection is closed");
  });
});

describe("ExecaProcessExecutor 单元测试", () => {
  const executor = new ExecaProcessExecutor();

  it("支持基础命令执行与参数传递", async () => {
    const res = await executor.exec("echo", ["hello", "actiondock"]);
    expect(res.ok).toBe(true);
    expect(res.exitCode).toBe(0);
    expect(res.stdout).toBe("hello actiondock");
    expect(res.timedOut).toBe(false);
    expect(res.cancelled).toBe(false);
    expect(res.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("支持自定义环境变量传递", async () => {
    const res = await executor.exec("sh", ["-c", "echo $CUSTOM_ACTIONDOCK_VAR"], {
      env: { CUSTOM_ACTIONDOCK_VAR: "actiondock_env_ok" },
    });
    expect(res.ok).toBe(true);
    expect(res.stdout).toBe("actiondock_env_ok");
  });

  it("支持标准输入管道传递", async () => {
    const res = await executor.exec("cat", [], {
      input: "stream payload",
    });
    expect(res.ok).toBe(true);
    expect(res.stdout).toBe("stream payload");
    expect(new TextDecoder().decode(res.raw)).toBe("stream payload");
  });

  it("支持执行超时控制并安全终止进程", async () => {
    const res = await executor.exec("sleep", ["2"], {
      timeoutMs: 100,
    });
    expect(res.ok).toBe(false);
    expect(res.timedOut).toBe(true);
    expect(res.error?.code).toBe("PROCESS_TIMEOUT");
  });

  it("支持通过 AbortSignal 取消进程执行", async () => {
    const ac = new AbortController();
    setTimeout(() => ac.abort(), 60);

    const res = await executor.exec("sleep", ["2"], {
      signal: ac.signal,
    });
    expect(res.ok).toBe(false);
    expect(res.cancelled).toBe(true);
    expect(res.error?.code).toBe("PROCESS_CANCELLED");
  });

  it("支持大输出容量截断并安全终止进程", async () => {
    const res = await executor.exec(
      "node",
      ["-e", "console.log('X'.repeat(5000))"],
      {
        maxOutputBytes: 100,
      }
    );
    expect(res.ok).toBe(false);
    expect(res.error?.code).toBe("PROCESS_OUTPUT_LIMIT");
  });

  it("支持 throwOnError 配置控制异常抛出", async () => {
    const failureRes = await executor.exec("sh", ["-c", "exit 42"], {
      throwOnError: false,
    });
    expect(failureRes.ok).toBe(false);
    expect(failureRes.exitCode).toBe(42);

    await expect(
      executor.exec("sh", ["-c", "exit 42"], {
        throwOnError: true,
      })
    ).rejects.toThrow();
  });

  it("取消执行时递归清理进程组与子孙进程", async () => {
    const pidFile = join(
      tmpdir(),
      `sub-cancel-${Date.now()}-${Math.random().toString(36).slice(2)}.pid`
    );
    const ac = new AbortController();

    const execPromise = executor.exec(
      "node",
      [
        "-e",
        `
        const { spawn } = require("child_process");
        const fs = require("fs");
        const c = spawn("sleep", ["30"]);
        fs.writeFileSync(process.argv[1], String(c.pid));
        setInterval(() => {}, 1000);
      `,
        pidFile,
      ],
      { signal: ac.signal }
    );

    while (!existsSync(pidFile)) {
      await new Promise((r) => setTimeout(r, 10));
    }
    const subPid = parseInt(readFileSync(pidFile, "utf8").trim(), 10);
    ac.abort();

    const res = await execPromise;
    expect(res.ok).toBe(false);
    expect(res.cancelled).toBe(true);

    await new Promise((r) => setTimeout(r, 50));
    let isAlive = true;
    try {
      process.kill(subPid, 0);
    } catch {
      isAlive = false;
    }
    expect(isAlive).toBe(false);
    try {
      unlinkSync(pidFile);
    } catch {
      // 忽略清理文件异常
    }
  });

  it("超时退出时递归清理进程组与子孙进程", async () => {
    const pidFile = join(
      tmpdir(),
      `sub-timeout-${Date.now()}-${Math.random().toString(36).slice(2)}.pid`
    );

    const execPromise = executor.exec(
      "node",
      [
        "-e",
        `
        const { spawn } = require("child_process");
        const fs = require("fs");
        const c = spawn("sleep", ["30"]);
        fs.writeFileSync(process.argv[1], String(c.pid));
        setInterval(() => {}, 1000);
      `,
        pidFile,
      ],
      { timeoutMs: 150 }
    );

    while (!existsSync(pidFile)) {
      await new Promise((r) => setTimeout(r, 10));
    }
    const subPid = parseInt(readFileSync(pidFile, "utf8").trim(), 10);

    const res = await execPromise;
    expect(res.ok).toBe(false);
    expect(res.timedOut).toBe(true);

    await new Promise((r) => setTimeout(r, 50));
    let isAlive = true;
    try {
      process.kill(subPid, 0);
    } catch {
      isAlive = false;
    }
    expect(isAlive).toBe(false);
    try {
      unlinkSync(pidFile);
    } catch {
      // 忽略清理文件异常
    }
  });

  it("输出溢出时递归清理进程组与子孙进程", async () => {
    const pidFile = join(
      tmpdir(),
      `sub-limit-${Date.now()}-${Math.random().toString(36).slice(2)}.pid`
    );

    const execPromise = executor.exec(
      "node",
      [
        "-e",
        `
        const { spawn } = require("child_process");
        const fs = require("fs");
        const c = spawn("sleep", ["30"]);
        fs.writeFileSync(process.argv[1], String(c.pid));
        setInterval(() => {
          process.stdout.write("X".repeat(1024));
        }, 10);
      `,
        pidFile,
      ],
      { maxOutputBytes: 100 }
    );

    while (!existsSync(pidFile)) {
      await new Promise((r) => setTimeout(r, 10));
    }
    const subPid = parseInt(readFileSync(pidFile, "utf8").trim(), 10);

    const res = await execPromise;
    expect(res.ok).toBe(false);
    expect(res.error?.code).toBe("PROCESS_OUTPUT_LIMIT");

    await new Promise((r) => setTimeout(r, 50));
    let isAlive = true;
    try {
      process.kill(subPid, 0);
    } catch {
      isAlive = false;
    }
    expect(isAlive).toBe(false);
    try {
      unlinkSync(pidFile);
    } catch {
      // 忽略清理文件异常
    }
  });

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
      expect(spawnedCommands.length).toBe(1);
      expect(spawnedCommands[0].command).toBe("taskkill");
      expect(spawnedCommands[0].args).toEqual(["/pid", "99999", "/T", "/F"]);
      expect(killedSignals.length).toBe(0);

      // taskkill 成功完成（exit 0）
      closeCallback?.(0);
      await killPromise;
      // taskkill 已成功销毁整棵进程树，process.kill 不应被调用
      expect(killedSignals.length).toBe(0);
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
      expect(killedSignals.length).toBe(0);
      errorCallback?.();
      await errPromise;
      expect(killedSignals.length).toBe(1);
      expect(killedSignals[0]).toEqual({ pid: 77777, signal: "SIGTERM" });

      // 2. taskkill 退出码非 0 时回退至 process.kill
      killedSignals.length = 0;
      const nonZeroPromise = killProcessGroup(66666, "SIGKILL", mockSpawn);
      expect(killedSignals.length).toBe(0);
      closeCallback?.(1);
      await nonZeroPromise;
      expect(killedSignals.length).toBe(1);
      expect(killedSignals[0]).toEqual({ pid: 66666, signal: "SIGKILL" });

      // 3. spawn 抛出同步异常时直接回退至 process.kill
      killedSignals.length = 0;
      const throwingSpawn = (() => {
        throw new Error("spawn failed");
      }) as unknown as typeof cp.spawn;
      await killProcessGroup(55555, "SIGTERM", throwingSpawn);
      expect(killedSignals.length).toBe(1);
      expect(killedSignals[0]).toEqual({ pid: 55555, signal: "SIGTERM" });
    } finally {
      Object.defineProperty(process, "platform", { value: origPlatform, configurable: true });
      process.kill = origKill;
    }
  });

  it("父进程关闭后 Promise 立即解析，且进程树兜底清理定时器独立执行不被取消", async () => {
    // 实例化短兜底周期（60ms）的执行器
    const customExecutor = new NodeProcessExecutor(60);

    let sigkillCalled = false;
    let sigtermCalled = false;
    const origKill = process.kill;
    process.kill = ((pid: number, sig?: string | number) => {
      if (sig === "SIGTERM") sigtermCalled = true;
      if (sig === "SIGKILL") sigkillCalled = true;
      return origKill(pid, sig as any);
    }) as any;

    try {
      const ac = new AbortController();
      setTimeout(() => ac.abort(), 20);

      const startTime = Date.now();
      const res = await customExecutor.exec(
        process.execPath,
        ["-e", "setTimeout(() => {}, 2000)"],
        { signal: ac.signal }
      );
      const duration = Date.now() - startTime;

      // 验证 Promise 立即解析（远小于兜底超时与总 sleep 时间）
      expect(res.cancelled).toBe(true);
      expect(duration).toBeLessThan(1000);
      if (process.platform !== "win32") {
        expect(sigtermCalled).toBe(true);
      }

      // 在 Promise 解析完成瞬间，兜底宽限期尚未结束，SIGKILL 尚未触发
      // 等待宽限期结束（60ms 后）
      await new Promise((r) => setTimeout(r, 80));

      // 验证兜底清理并未因父进程 close 或 Promise settled 而被清除，成功触发 SIGKILL
      if (process.platform !== "win32") {
        expect(sigkillCalled).toBe(true);
      }
    } finally {
      process.kill = origKill;
    }
  });
});

describe("NodeModuleLoader 与 TsxModuleLoader 单元测试", () => {
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
    expect(mod.serviceName).toBe("auth-service");

    const calculate = await loader.loadDefault<(...args: number[]) => number>(filePath);
    expect(typeof calculate).toBe("function");
    expect(calculate(10, 20)).toBe(30);
  });

  it("严格拒绝不受支持的 .tsx 扩展名", async () => {
    const loader = new NodeModuleLoader();
    const filePath = join(testDir, "component.tsx");

    await expect(loader.load(filePath)).rejects.toThrow("unsupported extension '.tsx'");
  });

  it("严格拒绝不受支持的 .cjs 扩展名", async () => {
    const loader = new NodeModuleLoader();
    const filePath = join(testDir, "legacy.cjs");

    await expect(loader.load(filePath)).rejects.toThrow("unsupported extension '.cjs'");
  });

  it("支持加载 .mts 源码模块", async () => {
    const loader = new NodeModuleLoader();
    const filePath = join(testDir, "module.mts");

    const mod = await loader.load(filePath);
    expect(mod.magicNumber).toBe(42);

    const def = await loader.loadDefault<{ magicNumber: number }>(filePath);
    expect(def.magicNumber).toBe(42);
  });

  it("支持显式相对路径解析与加载，并严格拒绝无扩展名解析", async () => {
    const loader = new NodeModuleLoader();

    // 显式扩展名解析成功
    const resolved = loader.resolve("./service.ts", join(testDir, "dummy.js"));
    expect(resolved.endsWith("service.ts")).toBe(true);

    const mod = await loader.load("./service.ts", join(testDir, "dummy.js"));
    expect(mod.serviceName).toBe("auth-service");

    // 无扩展名解析严格拒绝
    expect(() => loader.resolve("./service", join(testDir, "dummy.js"))).toThrow(
      "missing file extension"
    );
  });

  it("解包辅助函数 unwrapDefaultExport 支持多层嵌套与 action 属性回退", () => {
    expect(unwrapDefaultExport(null)).toBeNull();
    expect(unwrapDefaultExport<string>({ default: "val" })).toBe("val");
    expect(unwrapDefaultExport<string>({ default: { default: "nested" } })).toBe("nested");
    expect(unwrapDefaultExport<any>({ action: { id: "test-act" } })).toEqual({ id: "test-act" });
  });
});

describe("NodeHttpServer 单元测试", () => {
  it("正确将 IncomingMessage 转化为 Web Request 并通过 sendWebResponse 流式回写", async () => {
    let capturedMethod = "";
    let capturedPath = "";
    let capturedHeader = "";
    let capturedBody = "";

    const server = createServer(
      createRequestListener(async (req) => {
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

    expect(res.status).toBe(201);
    expect(res.headers.get("x-response-sign")).toBe("actiondock-ok");
    const json = await res.json();
    expect(json).toEqual({ echo: "hello web request" });

    expect(capturedMethod).toBe("POST");
    expect(capturedPath).toBe("/api/v1/test");
    expect(capturedHeader).toBe("header-value-42");
    expect(capturedBody).toBe("hello web request");

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
    expect(reader).toBeDefined();

    const chunks: string[] = [];
    while (true) {
      const { done, value } = await reader!.read();
      if (done) break;
      chunks.push(new TextDecoder().decode(value));
    }

    const fullText = chunks.join("");
    expect(fullText).toBe("part-1;part-2;part-3;");

    await testServer.close();
    expect(testServer.isListening).toBe(false);
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
    expect(errRes.status).toBe(500);
    const errJson = await errRes.json();
    expect(errJson.ok).toBe(false);
    expect(errJson.error.code).toBe("SERVER_ERROR");
    expect(errJson.error.message).toContain("Deliberate failure");

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
    expect(handled).toBe(false);
    expect(statusCode).toBe(400);
    const json = JSON.parse(responseBody);
    expect(json.ok).toBe(false);
    expect(json.error.code).toBe("BAD_REQUEST");
  });

  it("客户端在服务端响应完成前断开时（!res.writableFinished），createWebRequest 正确触发 abort", async () => {
    let aborted = false;
    let signalTriggered = false;

    const server = createServer(
      createRequestListener(async (req) => {
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

    expect(aborted).toBe(true);
    expect(signalTriggered).toBe(true);

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
      expect(server.url).toMatch(/^http:\/\/\[::1\]:\d+$/);
      expect(() => new URL(server.url)).not.toThrow();
    } finally {
      await server.close();
    }
  });
});
