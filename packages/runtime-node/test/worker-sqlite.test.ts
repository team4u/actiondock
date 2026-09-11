import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WorkerSqliteDriver } from "../src/worker-sqlite-driver";

describe("WorkerSqliteDriver 工作线程驱动测试", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "ad-worker-test-"));
  });

  afterEach(() => {
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // 忽略临时目录清理异常
    }
  });

  it("基础数据库增删改查与事务操作均在工作线程正常执行", async () => {
    const dbPath = join(tempDir, "worker-basic.db");
    const driver = new WorkerSqliteDriver(dbPath);

    expect(driver.isOpen).toBe(true);
    expect(driver.isExited).toBe(false);

    await driver.exec(`
      CREATE TABLE test_items (
        id TEXT PRIMARY KEY,
        val TEXT NOT NULL
      );
    `);

    // 写入数据
    const insertRes = await driver.run(
      "INSERT INTO test_items (id, val) VALUES (?, ?)",
      "item-1",
      "hello-worker"
    );
    expect(insertRes.changes).toBe(1);

    // prepare 查询
    const stmt = driver.prepare("SELECT * FROM test_items WHERE id = ?");
    const row = await stmt.get<{ id: string; val: string }>("item-1");
    expect(row).toBeDefined();
    expect(row?.val).toBe("hello-worker");

    // 全量列表查询
    const listStmt = driver.prepare("SELECT * FROM test_items");
    const allRows = await listStmt.all<{ id: string; val: string }>();
    expect(allRows.length).toBe(1);

    // 事务批量执行
    await driver.transaction([
      { sql: "INSERT INTO test_items (id, val) VALUES (?, ?)", params: ["item-2", "val-2"] },
      { sql: "INSERT INTO test_items (id, val) VALUES (?, ?)", params: ["item-3", "val-3"] },
    ]);

    const total = await driver.all("SELECT * FROM test_items");
    expect(total.length).toBe(3);

    await driver.close();
    expect(driver.isOpen).toBe(false);
  });

  it("主事件循环延迟探针：工作线程执行大量 SQLite 操作时不阻塞主事件循环", async () => {
    const dbPath = join(tempDir, "worker-latency.db");
    const driver = new WorkerSqliteDriver(dbPath);

    await driver.exec(`
      CREATE TABLE latency_test (
        id INTEGER PRIMARY KEY,
        payload TEXT NOT NULL
      );
    `);

    // 启动主事件循环延迟探针（每 5 毫秒检测一次主线程执行延迟）
    let maxDelayMs = 0;
    let lastTick = performance.now();
    const timer = setInterval(() => {
      const now = performance.now();
      const elapsed = now - lastTick;
      const delay = Math.max(0, elapsed - 5);
      if (delay > maxDelayMs) {
        maxDelayMs = delay;
      }
      lastTick = now;
    }, 5);

    // 主线程向工作线程并发派发大量 SQLite 写入操作
    const writeCount = 100;
    const writePromises: Promise<any>[] = [];
    for (let i = 0; i < writeCount; i++) {
      writePromises.push(
        driver.run(
          "INSERT INTO latency_test (id, payload) VALUES (?, ?)",
          i,
          `payload-data-${i}`.repeat(10)
        )
      );
    }

    await Promise.all(writePromises);
    clearInterval(timer);

    const countRes = await driver.get<{ count: number }>("SELECT count(*) as count FROM latency_test");
    expect(countRes?.count).toBe(writeCount);

    // 验证主事件循环最大排队延迟受控，证明同步操作未在主事件循环直接阻塞执行
    expect(maxDelayMs).toBeLessThan(80);

    await driver.close();
  });

  it("工作线程异常退出处理：未决请求报错 STORAGE_WORKER_EXITED 且后续请求直接拒绝", async () => {
    const dbPath = join(tempDir, "worker-crash.db");
    const driver = new WorkerSqliteDriver(dbPath);

    await driver.exec(`
      CREATE TABLE crash_test (
        id INTEGER PRIMARY KEY,
        val TEXT
      );
    `);

    // 触发工作线程异常崩溃退出，并同时提交在途请求
    driver.crashForTest();
    const pendingInsert1 = driver.run("INSERT INTO crash_test (id, val) VALUES (?, ?)", 1, "val-1");
    const pendingInsert2 = driver.run("INSERT INTO crash_test (id, val) VALUES (?, ?)", 2, "val-2");

    const results = await Promise.allSettled([pendingInsert1, pendingInsert2]);
    for (const res of results) {
      expect(res.status).toBe("rejected");
      if (res.status === "rejected") {
        expect(res.reason?.code).toBe("STORAGE_WORKER_EXITED");
      }
    }

    // 验证驱动处于已退出与不可用状态
    expect(driver.isExited).toBe(true);
    expect(driver.isOpen).toBe(false);

    // 后续新请求直接被拒绝，抛出 STORAGE_WORKER_EXITED 错误
    await expect(driver.exec("SELECT 1")).rejects.toThrow(/STORAGE_WORKER_EXITED/);
    await expect(driver.run("INSERT INTO crash_test (id, val) VALUES (?, ?)", 99, "x")).rejects.toThrow(
      /STORAGE_WORKER_EXITED/
    );
    await expect(driver.get("SELECT * FROM crash_test")).rejects.toThrow(/STORAGE_WORKER_EXITED/);

    await driver.close();
  });

  it("正常关闭工作线程驱动：妥善结算未决请求并拒绝关闭后的新请求", async () => {
    const dbPath = join(tempDir, "worker-close.db");
    const driver = new WorkerSqliteDriver(dbPath);

    await driver.exec("CREATE TABLE items (id INT, val TEXT)");

    // 并发提交请求并立即调用 close
    const p1 = driver.run("INSERT INTO items VALUES (?, ?)", 1, "a");
    const closePromise = driver.close();
    const pPostClose = driver.run("INSERT INTO items VALUES (?, ?)", 2, "b");
    const postCloseAssertion = expect(pPostClose).rejects.toThrow(/Database connection is closed/);

    await closePromise;
    expect(driver.isOpen).toBe(false);

    // 验证关闭前已派发的请求与关闭后拒绝的请求
    await p1.catch(() => {});
    await postCloseAssertion;

    // 关闭后发起的新请求必须被拒绝
    await expect(driver.exec("SELECT 1")).rejects.toThrow(/Database connection is closed/);

    // 重复调用 close 不应抛出异常
    await expect(driver.close()).resolves.toBeUndefined();
  });
});

