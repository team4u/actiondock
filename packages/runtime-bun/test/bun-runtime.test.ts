import { describe, expect, test } from "bun:test";
import {
  BunHttpServer,
  BunProcessExecutor,
  BunSqliteDriver,
  createBunSqliteDriver,
  startBunHttpServer,
} from "../src";

describe("BunSqliteDriver", () => {
  test("基础读写操作与多种参数传递方式", () => {
    const driver = new BunSqliteDriver(":memory:");
    expect(driver.closed).toBe(false);
    expect(driver.database).toBeDefined();

    driver.exec(`
      CREATE TABLE users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        age INTEGER NOT NULL
      )
    `);

    // 1. 展开位置参数
    const insertStmt = driver.prepare("INSERT INTO users (name, age) VALUES (?, ?)");
    const res1 = insertStmt.run("alice", 20);
    expect(res1.changes).toBe(1);
    expect(Number(res1.lastInsertRowid)).toBe(1);

    // 2. 数组位置参数
    const res2 = insertStmt.run(["bob", 25]);
    expect(res2.changes).toBe(1);
    expect(Number(res2.lastInsertRowid)).toBe(2);

    // 3. 命名对象参数
    const insertNamedStmt = driver.prepare(
      "INSERT INTO users (name, age) VALUES ($name, $age)"
    );
    const res3 = insertNamedStmt.run({ $name: "charlie", $age: 30 });
    expect(res3.changes).toBe(1);
    expect(Number(res3.lastInsertRowid)).toBe(3);

    // 4. get 查询单条记录
    const selectOneStmt = driver.prepare("SELECT * FROM users WHERE name = ?");
    const user1 = selectOneStmt.get<{ id: number; name: string; age: number }>("alice");
    expect(user1).toBeDefined();
    expect(user1?.name).toBe("alice");
    expect(user1?.age).toBe(20);

    // get 数组参数查询
    const user2 = selectOneStmt.get<{ id: number; name: string; age: number }>(["bob"]);
    expect(user2).toBeDefined();
    expect(user2?.name).toBe("bob");

    // 5. all 查询多条记录
    const selectAllStmt = driver.prepare("SELECT * FROM users ORDER BY id ASC");
    const allUsers = selectAllStmt.all<{ id: number; name: string; age: number }>();
    expect(allUsers.length).toBe(3);
    expect(allUsers[0].name).toBe("alice");
    expect(allUsers[1].name).toBe("bob");
    expect(allUsers[2].name).toBe("charlie");

    // 带条件的 all 查询
    const selectAgeStmt = driver.prepare("SELECT * FROM users WHERE age >= ? ORDER BY age ASC");
    const olderUsers = selectAgeStmt.all<{ name: string }>(25);
    expect(olderUsers.length).toBe(2);
    expect(olderUsers[0].name).toBe("bob");
    expect(olderUsers[1].name).toBe("charlie");

    driver.close();
    expect(driver.closed).toBe(true);
  });

  test("事务提交、异常回滚与异步事务拦截", () => {
    const driver = createBunSqliteDriver(":memory:");
    driver.exec("CREATE TABLE items (id INTEGER PRIMARY KEY, value TEXT)");

    // 1. 成功提交的同步事务
    const txResult = driver.transaction(() => {
      driver.prepare("INSERT INTO items (id, value) VALUES (?, ?)").run(1, "item-1");
      driver.prepare("INSERT INTO items (id, value) VALUES (?, ?)").run(2, "item-2");
      return "committed";
    });
    expect(txResult).toBe("committed");

    const countStmt = driver.prepare("SELECT COUNT(*) as count FROM items");
    expect(countStmt.get<{ count: number }>()?.count).toBe(2);

    // 2. 发生异常自动回滚的事务
    expect(() => {
      driver.transaction(() => {
        driver.prepare("INSERT INTO items (id, value) VALUES (?, ?)").run(3, "item-3");
        throw new Error("Business validation failure");
      });
    }).toThrow("Business validation failure");

    // 验证回滚后数据未写入
    expect(countStmt.get<{ count: number }>()?.count).toBe(2);
    const item3 = driver.prepare("SELECT * FROM items WHERE id = ?").get(3);
    expect(item3).toBeUndefined();

    // 3. 异步事务拦截
    expect(() => {
      driver.transaction((() => {
        return Promise.resolve("async-result");
      }) as any);
    }).toThrow("Async transactions are not allowed in SQLite");

    driver.close();
  });

  test("连接关闭与防重复关闭保护", () => {
    const driver = new BunSqliteDriver(":memory:");
    driver.exec("CREATE TABLE dummy (val TEXT)");

    driver.close();
    expect(driver.closed).toBe(true);

    // 重复关闭应安全无异常
    expect(() => driver.close()).not.toThrow();

    // 已关闭后执行操作应抛出异常
    expect(() => driver.exec("SELECT 1")).toThrow("Database is closed");
    expect(() => driver.prepare("SELECT 1")).toThrow("Database is closed");
    expect(() => driver.transaction(() => 1)).toThrow("Database is closed");
  });
});

describe("BunProcessExecutor", () => {
  const executor = new BunProcessExecutor();

  test("标准外部命令执行与输出捕获", async () => {
    const res = await executor.exec("echo", ["hello-bun-executor"]);
    expect(res.ok).toBe(true);
    expect(res.exitCode).toBe(0);
    expect(res.stdout).toBe("hello-bun-executor");
    expect(res.stderr).toBe("");
    expect(res.timedOut).toBe(false);
    expect(res.cancelled).toBe(false);
    expect(res.durationMs).toBeGreaterThanOrEqual(0);
  });

  test("标准输入数据透传", async () => {
    const res = await executor.exec("cat", [], {
      input: "test stdin payload",
    });
    expect(res.ok).toBe(true);
    expect(res.stdout).toBe("test stdin payload");
  });

  test("非零退出码捕获与 throwOnError 选项", async () => {
    const res = await executor.exec("bash", ["-c", "echo 'something went wrong' >&2; exit 42"]);
    expect(res.ok).toBe(false);
    expect(res.exitCode).toBe(42);
    expect(res.stderr).toBe("something went wrong");

    await expect(
      executor.exec("bash", ["-c", "echo 'fatal error' >&2; exit 1"], {
        throwOnError: true,
      })
    ).rejects.toThrow("fatal error");
  });

  test("不存在的执行文件错误处理", async () => {
    const res = await executor.exec("command_not_found_random_12345");
    expect(res.ok).toBe(false);
    expect(res.exitCode).toBeNull();
    expect(res.error?.code).toBe("PROCESS_SPAWN_ERROR");

    await expect(
      executor.exec("command_not_found_random_12345", [], { throwOnError: true })
    ).rejects.toThrow();
  });

  test("命令执行超时终止", async () => {
    const res = await executor.exec("sleep", ["2"], {
      timeoutMs: 100,
    });
    expect(res.ok).toBe(false);
    expect(res.timedOut).toBe(true);
  });

  test("使用 AbortSignal 主动取消命令执行", async () => {
    const ac = new AbortController();
    setTimeout(() => ac.abort(), 100);

    const res = await executor.exec("sleep", ["2"], {
      signal: ac.signal,
    });
    expect(res.ok).toBe(false);
    expect(res.cancelled).toBe(true);

    // 预先已中断的 signal
    const alreadyAborted = new AbortController();
    alreadyAborted.abort();
    const res2 = await executor.exec("sleep", ["1"], {
      signal: alreadyAborted.signal,
    });
    expect(res2.ok).toBe(false);
    expect(res2.cancelled).toBe(true);
  });

  test("输出内容超限截断与进程终止", async () => {
    const res = await executor.exec(
      "bash",
      ["-c", "while true; do echo 'flood-data-stream'; done"],
      {
        maxOutputBytes: 2048,
      }
    );
    expect(res.ok).toBe(false);
    expect(res.error?.code).toBe("PROCESS_OUTPUT_LIMIT");
  });

  test("后台脱离进程启动 spawnDetached", async () => {
    // 1. 无 probe 模式
    const res = await executor.spawnDetached({
      command: "sleep",
      args: ["1"],
    });
    expect(res.ok).toBe(true);
    expect(typeof res.pid).toBe("number");
    expect(res.ready).toBe(true);

    // 2. 带 probe 探测成功
    let probeCount = 0;
    const probeRes = await executor.spawnDetached({
      command: "echo",
      args: ["detached-service"],
      probe: () => {
        probeCount++;
        return true;
      },
      probeIntervalMs: 50,
      probeTimeoutMs: 1000,
    });
    expect(probeRes.ok).toBe(true);
    expect(probeRes.ready).toBe(true);
    expect(probeCount).toBeGreaterThanOrEqual(1);

    // 3. probe 探测超时
    const timeoutRes = await executor.spawnDetached({
      command: "sleep",
      args: ["1"],
      probe: () => false,
      probeIntervalMs: 50,
      probeTimeoutMs: 150,
    });
    expect(timeoutRes.ok).toBe(false);
    expect(timeoutRes.ready).toBe(false);
    expect(timeoutRes.error?.code).toBe("PROCESS_PROBE_TIMEOUT");

    // 4. probe 取消
    const cancelAc = new AbortController();
    setTimeout(() => cancelAc.abort(), 60);
    const cancelRes = await executor.spawnDetached({
      command: "sleep",
      args: ["1"],
      probe: () => false,
      probeIntervalMs: 50,
      probeTimeoutMs: 1000,
      signal: cancelAc.signal,
    });
    expect(cancelRes.ok).toBe(false);
    expect(cancelRes.ready).toBe(false);
    expect(cancelRes.error?.code).toBe("PROCESS_CANCELLED");

    // 5. 命令不存在抛出异常捕获
    const failRes = await executor.spawnDetached({
      command: "non_existent_detached_binary_12345",
    });
    expect(failRes.ok).toBe(false);
    expect(failRes.error?.code).toBe("PROCESS_DETACHED_FAILED");
  });
});

describe("BunHttpServer", () => {
  test("基础请求响应处理与动态更新处理器", async () => {
    const server = new BunHttpServer({
      port: 0,
      fetch: async (req) => {
        const url = new URL(req.url);
        if (url.pathname === "/api/greet") {
          return new Response(JSON.stringify({ greeting: "hello bun server" }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }
        if (url.pathname === "/api/echo" && req.method === "POST") {
          const body = await req.json();
          return new Response(JSON.stringify({ received: body }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }
        return new Response("Not Found", { status: 404 });
      },
    });

    expect(server.isRunning).toBe(false);
    server.start();
    expect(server.isRunning).toBe(true);
    expect(server.port).toBeGreaterThan(0);
    expect(server.host).toBe("127.0.0.1");
    expect(server.url).toContain(`:${server.port}`);

    // 测试 GET 请求
    const getRes = await fetch(`${server.url}/api/greet`);
    expect(getRes.status).toBe(200);
    const getData = (await getRes.json()) as any;
    expect(getData.greeting).toBe("hello bun server");

    // 测试 POST JSON 请求
    const postRes = await fetch(`${server.url}/api/echo`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: "ping" }),
    });
    expect(postRes.status).toBe(200);
    const postData = (await postRes.json()) as any;
    expect(postData.received.message).toBe("ping");

    // 测试 404
    const notFoundRes = await fetch(`${server.url}/undefined-path`);
    expect(notFoundRes.status).toBe(404);

    // 动态更换 handler
    server.setHandler(() => new Response("new handler response", { status: 200 }));
    const updatedRes = await fetch(`${server.url}/any-path`);
    expect(await updatedRes.text()).toBe("new handler response");

    // 停止服务
    server.stop();
    expect(server.isRunning).toBe(false);
  });

  test("快捷工厂方法与别名生命周期管理", async () => {
    const server = startBunHttpServer({
      port: 0,
      handler: () => new Response("started automatically"),
    });

    expect(server.isRunning).toBe(true);
    const res = await fetch(server.url);
    expect(await res.text()).toBe("started automatically");

    // 使用 close 别名方法停止
    server.close();
    expect(server.isRunning).toBe(false);

    // 使用 listen 别名方法重新启动
    server.listen();
    expect(server.isRunning).toBe(true);
    const resAfterRestart = await fetch(server.url);
    expect(await resAfterRestart.text()).toBe("started automatically");

    server.stop();
  });
});
