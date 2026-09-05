import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { join } from "node:path";
import {
  createRequestListener,
  createWebRequest,
  ExecaProcessExecutor,
  NodeHttpServer,
  NodeSqliteDriver,
  sendWebResponse,
  TsxModuleLoader,
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

  it("支持 spawnDetached 启动与就绪探测", async () => {
    // 1. 无探测器启动
    const detachedRes = await executor.spawnDetached({
      command: "sleep",
      args: ["0.2"],
    });
    expect(detachedRes.ok).toBe(true);
    expect(detachedRes.ready).toBe(true);
    expect(detachedRes.pid).toBeDefined();

    // 2. 具备就绪探测器并成功通过
    let probeCalls = 0;
    const probedRes = await executor.spawnDetached({
      command: "sleep",
      args: ["0.5"],
      probeIntervalMs: 50,
      probeTimeoutMs: 1000,
      probe: () => {
        probeCalls++;
        return probeCalls >= 2;
      },
    });
    expect(probedRes.ok).toBe(true);
    expect(probedRes.ready).toBe(true);

    // 3. 探测器超时
    const timeoutRes = await executor.spawnDetached({
      command: "sleep",
      args: ["0.5"],
      probeIntervalMs: 50,
      probeTimeoutMs: 150,
      probe: () => false,
    });
    expect(timeoutRes.ok).toBe(false);
    expect(timeoutRes.ready).toBe(false);
    expect(timeoutRes.error?.code).toBe("PROCESS_PROBE_TIMEOUT");
  });
});

describe("TsxModuleLoader 单元测试", () => {
  const testDir = join(process.cwd(), "tmp", "test-loader-" + Date.now());

  beforeAll(() => {
    mkdirSync(testDir, { recursive: true });
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
      export default {
        render(label: string) {
          return "<" + tag + ">" + label + "</" + tag + ">";
        }
      };
      `
    );
    writeFileSync(
      join(testDir, "module.mts"),
      `
      export const magicNumber: number = 42;
      export default { magicNumber };
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
    const loader = new TsxModuleLoader();
    const filePath = join(testDir, "service.ts");

    const mod = await loader.load(filePath);
    expect(mod.serviceName).toBe("auth-service");

    const calculate = await loader.loadDefault<(...args: number[]) => number>(filePath);
    expect(typeof calculate).toBe("function");
    expect(calculate(10, 20)).toBe(30);
  });

  it("支持加载 .tsx 源码模块", async () => {
    const loader = new TsxModuleLoader();
    const filePath = join(testDir, "component.tsx");

    const mod = await loader.load(filePath);
    expect(mod.tag).toBe("button");

    const comp = await loader.loadDefault<{ render: (label: string) => string }>(filePath);
    expect(comp.render("Submit")).toBe("<button>Submit</button>");
  });

  it("支持加载 .mts 源码模块", async () => {
    const loader = new TsxModuleLoader();
    const filePath = join(testDir, "module.mts");

    const mod = await loader.load(filePath);
    expect(mod.magicNumber).toBe(42);

    const def = await loader.loadDefault<{ magicNumber: number }>(filePath);
    expect(def.magicNumber).toBe(42);
  });

  it("支持相对路径解析与后缀自动补齐", async () => {
    const loader = new TsxModuleLoader();
    const resolved = loader.resolve("./service", join(testDir, "dummy.js"));
    expect(resolved.endsWith("service.ts")).toBe(true);

    const mod = await loader.load("./service", join(testDir, "dummy.js"));
    expect(mod.serviceName).toBe("auth-service");
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
});
