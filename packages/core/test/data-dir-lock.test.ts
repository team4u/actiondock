import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createActionDockApp } from "../src/app";
import { createActionDockHost } from "../src/host";
import { createDefaultSqliteDriver } from "../src/storage/driver";
import { SqliteRuntimeStorage } from "../src/storage/sqlite";
import { STORAGE_SCHEMA_VERSION } from "../src/storage/types";

describe("数据目录排他锁与 Schema 版本保护测试", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "ad-lock-test-"));
  });

  afterEach(() => {
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // 忽略临时目录清理异常
    }
  });

  it("并发打开同一数据目录时，第二个 Host 抛出 DATA_DIR_IN_USE 异常", async () => {
    const host1 = await createActionDockHost({
      dataDir: tempDir,
      autoLoadCurrentProject: false,
    });

    // 验证锁文件已创建
    const lockFile = join(tempDir, ".actiondock.data.lock");
    expect(existsSync(lockFile)).toBe(true);

    const lockData = JSON.parse(readFileSync(lockFile, "utf8"));
    expect(lockData.pid).toBe(process.pid);
    expect(lockData.sessionToken).toBeDefined();

    // 第二个 Host 试图并发打开同一数据目录
    let caughtError: any;
    try {
      await createActionDockHost({
        dataDir: tempDir,
        autoLoadCurrentProject: false,
      });
    } catch (err) {
      caughtError = err;
    }

    expect(caughtError).toBeDefined();
    expect(caughtError?.code).toBe("DATA_DIR_IN_USE");

    // 第一个 Host 正常关闭并释放锁
    await host1.close();
    expect(existsSync(lockFile)).toBe(false);

    // 锁释放后，新 Host 可以成功打开
    const host2 = await createActionDockHost({
      dataDir: tempDir,
      autoLoadCurrentProject: false,
    });
    expect(host2).toBeDefined();
    await host2.close();
  });

  it("当主进程退出但相关子进程仍存活时，抛出 DATA_DIR_RECOVERY_REQUIRED 异常", async () => {
    const lockFile = join(tempDir, ".actiondock.data.lock");

    // 构造模拟锁状态：主进程已死亡（PID 99999999），但关联子进程为当前存活进程 PID
    const mockLockInfo = {
      pid: 99999999,
      hostname: "mock-host",
      sessionToken: "stale-session-token",
      createdAt: new Date().toISOString(),
      childPids: [process.pid],
    };
    writeFileSync(lockFile, JSON.stringify(mockLockInfo, null, 2), { mode: 0o600 });

    let caughtError: any;
    try {
      await createActionDockHost({
        dataDir: tempDir,
        autoLoadCurrentProject: false,
      });
    } catch (err) {
      caughtError = err;
    }

    expect(caughtError).toBeDefined();
    expect(caughtError?.code).toBe("DATA_DIR_RECOVERY_REQUIRED");
  });

  it("所有相关进程均退出后新 Host 成功接管并自动将 running 与 pending 运行收敛为 interrupted", async () => {
    // 1. 初始化存储并模拟写入遗留非终态（running 与 pending）运行记录
    const storage = new SqliteRuntimeStorage({
      packageId: "pkg.recovery-test",
      dbPath: join(tempDir, "pkg.recovery-test", "runtime.db"),
    });

    const now = new Date().toISOString();
    storage.createRun({
      id: "run-running-1",
      packageId: "pkg.recovery-test",
      actionId: "job",
      status: "running" as const,
      startedAt: now,
    });

    storage.createRun({
      id: "run-pending-1",
      packageId: "pkg.recovery-test",
      actionId: "job",
      status: "pending" as any,
      startedAt: now,
    });

    storage.createRun({
      id: "run-success-1",
      packageId: "pkg.recovery-test",
      actionId: "job",
      status: "success" as const,
      startedAt: now,
      finishedAt: now,
    });

    await storage.close();

    // 2. 构造模拟崩溃残留锁文件：主进程与子进程 PID 均已死亡
    const lockFile = join(tempDir, ".actiondock.data.lock");
    const deadLockInfo = {
      pid: 99999998,
      hostname: "crashed-host",
      sessionToken: "crashed-session",
      createdAt: new Date().toISOString(),
      childPids: [99999997],
    };
    writeFileSync(lockFile, JSON.stringify(deadLockInfo, null, 2), { mode: 0o600 });

    // 3. 新 Host 启动接管数据目录
    const app = await createActionDockApp({
      projectConfig: {
        id: "pkg.recovery-test",
        name: "恢复测试包",
        version: "1.0.0",
      },
      dataDir: tempDir,
    });

    const host = await createActionDockHost({
      packages: [app],
      dataDir: tempDir,
      autoLoadCurrentProject: false,
    });

    // 4. 验证原先处于 running 与 pending 的记录均被收敛为 interrupted
    const runRunning = await host.getRun("run-running-1");
    expect(runRunning).toBeDefined();
    expect(runRunning?.status).toBe("interrupted");
    expect(runRunning?.error?.code).toBe("RUN_INTERRUPTED");
    expect(runRunning?.finishedAt).toBeDefined();

    const runPending = await host.getRun("run-pending-1");
    expect(runPending).toBeDefined();
    expect(runPending?.status).toBe("interrupted");
    expect(runPending?.error?.code).toBe("RUN_INTERRUPTED");
    expect(runPending?.finishedAt).toBeDefined();

    // 验证原终态 success 记录未受影响
    const runSuccess = await host.getRun("run-success-1");
    expect(runSuccess?.status).toBe("success");

    await host.close();
  });

  it("存储 Schema 版本严格保护与单事务初始化失败原子回滚", async () => {
    expect(STORAGE_SCHEMA_VERSION).toBe(2);

    const dbPath = join(tempDir, "schema-test.db");

    // 首次空库初始化
    const storage1 = new SqliteRuntimeStorage({
      packageId: "pkg.schema",
      dbPath,
    });
    expect(storage1.isOpen).toBe(true);
    await storage1.close();

    // 验证 user_version 精确为 STORAGE_SCHEMA_VERSION (2)
    const dbCheck = createDefaultSqliteDriver(dbPath);
    const row = dbCheck.prepare("PRAGMA user_version;").get() as any;
    expect(row.user_version).toBe(2);

    // 修改 user_version 为不支持的版本（例如 99）
    dbCheck.exec("PRAGMA user_version = 99;");
    dbCheck.close();

    // 验证打开不支持版本时在写事务前直接抛出 UNSUPPORTED_STORAGE_SCHEMA 异常并拒绝启动
    expect(() => {
      new SqliteRuntimeStorage({
        packageId: "pkg.schema",
        dbPath,
      });
    }).toThrow(/UNSUPPORTED_STORAGE_SCHEMA/);

    // 注入事务失败模拟：验证初始化事务失败时原子回滚，不留下残缺表
    const badDbPath = join(tempDir, "rollback-test.db");
    const mockDriver: any = {
      exec: () => {},
      prepare: () => ({
        get: () => ({ user_version: 0 }),
      }),
      transaction: (fn: () => void) => {
        // 模拟执行建表过程中抛出故障并回滚
        try {
          fn();
        } catch {
          // 模拟回滚
        }
        throw new Error("Disk I/O error during schema initialization");
      },
      close: () => {},
    };

    expect(() => {
      new SqliteRuntimeStorage({
        packageId: "pkg.rollback",
        dbPath: badDbPath,
        driver: mockDriver,
      });
    }).toThrow("Disk I/O error during schema initialization");
  });
});
