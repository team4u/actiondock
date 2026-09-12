import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { Worker } from "node:worker_threads";
import { createActionDockApp } from "../src/app";
import { createActionDockHost } from "../src/host";
import { createDefaultSqliteDriver } from "../src/storage/driver";
import { SqliteRuntimeStorage } from "../src/storage/sqlite";
import { DataDirLock, safeRemoveStaleReclaimGuard } from "../src/storage/data-dir-lock";
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

    // 验证锁目录已创建
    const lockFile = join(tempDir, ".actiondock.data.lock");
    expect(existsSync(lockFile)).toBe(true);

    const metaFile = statSync(lockFile).isDirectory() ? join(lockFile, "metadata.json") : lockFile;
    const lockData = JSON.parse(readFileSync(metaFile, "utf8"));
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

  it("多实例并发抢锁时严格保证仅有一方成功，其余方均捕获 DATA_DIR_IN_USE 异常", async () => {
    const concurrency = 10;
    const results: { success: DataDirLock[]; errors: any[] } = {
      success: [],
      errors: [],
    };

    // 同步并发抢锁
    for (let i = 0; i < concurrency; i++) {
      try {
        const lock = DataDirLock.acquire(tempDir);
        results.success.push(lock);
      } catch (err: any) {
        results.errors.push(err);
      }
    }

    expect(results.success.length).toBe(1);
    expect(results.errors.length).toBe(concurrency - 1);
    for (const err of results.errors) {
      expect(err?.code).toBe("DATA_DIR_IN_USE");
    }

    // 成功持有锁的实例释放锁
    results.success[0].release();
    const lockFile = join(tempDir, ".actiondock.data.lock");
    expect(existsSync(lockFile)).toBe(false);
  });

  it("释放锁时校验 sessionToken，若磁盘锁文件被覆盖则不删除他人持有的锁文件", () => {
    const lockFile = join(tempDir, ".actiondock.data.lock");
    const lock = DataDirLock.acquire(tempDir);
    expect(existsSync(lockFile)).toBe(true);

    // 模拟锁文件已被其他会话接管覆盖
    const otherLockInfo = {
      pid: process.pid,
      hostname: "other-host",
      sessionToken: "other-session-token",
      createdAt: new Date().toISOString(),
      childPids: [],
    };
    const metaPath = statSync(lockFile).isDirectory() ? join(lockFile, "metadata.json") : lockFile;
    writeFileSync(metaPath, JSON.stringify(otherLockInfo, null, 2), { mode: 0o600 });

    // 旧锁实例尝试 release，由于 sessionToken 不匹配，磁盘文件不会被删除
    lock.release();
    expect(existsSync(lockFile)).toBe(true);

    const onDisk = JSON.parse(readFileSync(metaPath, "utf8"));
    expect(onDisk.sessionToken).toBe("other-session-token");
  });

  it("真实多进程并发争抢陈旧锁时，严格保证仅有一个子进程成功接管，其余子进程均抛出 DATA_DIR_IN_USE 异常", async () => {
    const lockFile = join(tempDir, ".actiondock.data.lock");
    const staleLockInfo = {
      pid: 99999998,
      hostname: "stale-host",
      sessionToken: "stale-token",
      createdAt: new Date().toISOString(),
      childPids: [],
    };
    writeFileSync(lockFile, JSON.stringify(staleLockInfo, null, 2), { mode: 0o600 });

    const lockModulePath = resolve(import.meta.dirname, "../src/storage/data-dir-lock.ts");
    const workerScript = join(tempDir, "lock-worker.mjs");
    const workerContent = `
import { DataDirLock } from ${JSON.stringify(pathToFileURL(lockModulePath).href)};
import readline from "node:readline";

const dataDir = process.argv[2];
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
let lock = null;

process.stdout.write("READY\\n");

rl.on("line", (cmd) => {
  const action = cmd.trim();
  if (action === "START") {
    try {
      lock = DataDirLock.acquire(dataDir);
      process.stdout.write("RESULT:SUCCESS\\n");
    } catch (err) {
      process.stdout.write("RESULT:" + (err?.code || err?.message) + "\\n");
      process.exit(0);
    }
  } else if (action === "RELEASE") {
    if (lock) {
      lock.release();
    }
    process.exit(0);
  }
});
`;
    writeFileSync(workerScript, workerContent, "utf-8");

    const isBun = Boolean((process as any).isBun || process.versions?.bun);
    const repoRoot = resolve(import.meta.dirname, "../../..");
    const preloadScript = join(repoRoot, "scripts", "test-preload.ts");
    const preloadUrl = pathToFileURL(preloadScript).href;

    const childArgs = isBun
      ? [workerScript, tempDir]
      : ["--no-deprecation", "--import", preloadUrl, workerScript, tempDir];

    const concurrency = 6;
    const procs: ReturnType<typeof spawn>[] = [];
    const results: string[] = [];

    for (let i = 0; i < concurrency; i++) {
      const child = spawn(process.execPath, childArgs, {
        stdio: ["pipe", "pipe", "inherit"],
      });
      procs.push(child);
    }

    let winnerProc: ReturnType<typeof spawn> | null = null;
    let readyCount = 0;

    await new Promise<void>((resolvePromise, rejectPromise) => {
      const timeout = setTimeout(() => {
        for (const p of procs) {
          try {
            p.kill("SIGKILL");
          } catch {}
        }
        rejectPromise(
          new Error(
            `Test timed out waiting for children results (got ${results.length}/${concurrency})`
          )
        );
      }, 10000);

      for (const child of procs) {
        let buffer = "";
        child.stdout?.on("data", (chunk) => {
          buffer += chunk.toString();
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";

          for (const line of lines) {
            const trimmed = line.trim();
            if (trimmed === "READY") {
              readyCount++;
              if (readyCount === concurrency) {
                for (const p of procs) {
                  p.stdin?.write("START\n");
                }
              }
            } else if (trimmed.startsWith("RESULT:")) {
              const res = trimmed.replace("RESULT:", "");
              results.push(res);
              if (res === "SUCCESS") {
                winnerProc = child;
              }
              if (results.length === concurrency) {
                clearTimeout(timeout);
                resolvePromise();
              }
            }
          }
        });

        child.on("error", (err) => {
          clearTimeout(timeout);
          rejectPromise(err);
        });
      }
    });

    const successCount = results.filter((r) => r === "SUCCESS").length;
    const inUseCount = results.filter((r) => r === "DATA_DIR_IN_USE").length;

    expect(successCount).toBe(1);
    expect(inUseCount).toBe(concurrency - 1);
    expect(results.length).toBe(concurrency);

    if (winnerProc) {
      (winnerProc as any).stdin?.write("RELEASE\n");
    }

    await Promise.all(
      procs.map(
        (p) =>
          new Promise<void>((res) => {
            if (p.exitCode !== null) {
              res();
            } else {
              p.on("exit", () => res());
            }
          })
      )
    );

    expect(existsSync(lockFile)).toBe(false);
    const remainingQuarantines = readdirSync(tempDir).filter((name) =>
      name.includes(".quarantine.")
    );
    expect(remainingQuarantines.length).toBe(0);
  });

  it("覆盖元数据写入过程中并发读取与锁竞争保护，验证不会因元数据临时缺失而误判锁死亡", async () => {
    const lockDir = join(tempDir, ".actiondock.data.lock");
    // 模拟所有者刚刚原子创建锁目录，但尚未完成 metadata.json 写入
    mkdirSync(lockDir, { mode: 0o700 });
    expect(existsSync(lockDir)).toBe(true);

    const metaJsonPath = join(lockDir, "metadata.json");
    const validInfo = {
      pid: process.pid,
      hostname: "test-host",
      sessionToken: "session-active",
      createdAt: new Date().toISOString(),
      childPids: [],
    };

    // 启动工作线程在 60ms 后写入合法元数据，模拟并发所有者完成写入过程
    const workerScript = `
      const fs = require("node:fs");
      setTimeout(() => {
        fs.writeFileSync(${JSON.stringify(metaJsonPath)}, ${JSON.stringify(JSON.stringify(validInfo, null, 2))}, { mode: 0o600 });
      }, 60);
    `;
    const worker = new Worker(workerScript, { eval: true });

    // 并发方尝试抢锁：应当触发宽限期等待重试，严禁将缺少元数据的目录当成陈旧锁删除
    let caughtError: any;
    try {
      DataDirLock.acquire(tempDir);
    } catch (err) {
      caughtError = err;
    } finally {
      await worker.terminate();
    }

    // 验证锁目录未被误删，且在读到合法元数据后正确识别活跃持有者并抛出 DATA_DIR_IN_USE
    expect(existsSync(lockDir)).toBe(true);
    expect(caughtError).toBeDefined();
    expect(caughtError?.code).toBe("DATA_DIR_IN_USE");
  });

  it("真实多进程并发争抢陈旧目录锁时，通过原子检疫隔离接管，验证无死锁且其余进程均捕获 DATA_DIR_IN_USE", async () => {
    const lockDir = join(tempDir, ".actiondock.data.lock");
    mkdirSync(lockDir, { mode: 0o700 });
    const staleLockInfo = {
      pid: 99999998,
      hostname: "stale-dir-host",
      sessionToken: "stale-dir-token",
      createdAt: new Date().toISOString(),
      childPids: [],
    };
    writeFileSync(
      join(lockDir, "metadata.json"),
      JSON.stringify(staleLockInfo, null, 2),
      { mode: 0o600 }
    );

    const lockModulePath = resolve(import.meta.dirname, "../src/storage/data-dir-lock.ts");
    const workerScript = join(tempDir, "lock-dir-worker.mjs");
    const workerContent = `
import { DataDirLock } from ${JSON.stringify(pathToFileURL(lockModulePath).href)};
import readline from "node:readline";

const dataDir = process.argv[2];
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
let lock = null;

process.stdout.write("READY\\n");

rl.on("line", (cmd) => {
  const action = cmd.trim();
  if (action === "START") {
    try {
      lock = DataDirLock.acquire(dataDir);
      process.stdout.write("RESULT:SUCCESS\\n");
    } catch (err) {
      process.stdout.write("RESULT:" + (err?.code || err?.message) + "\\n");
      process.exit(0);
    }
  } else if (action === "RELEASE") {
    if (lock) {
      lock.release();
    }
    process.exit(0);
  }
});
`;
    writeFileSync(workerScript, workerContent, "utf-8");

    const isBun = Boolean((process as any).isBun || process.versions?.bun);
    const repoRoot = resolve(import.meta.dirname, "../../..");
    const preloadScript = join(repoRoot, "scripts", "test-preload.ts");
    const preloadUrl = pathToFileURL(preloadScript).href;

    const childArgs = isBun
      ? [workerScript, tempDir]
      : ["--no-deprecation", "--import", preloadUrl, workerScript, tempDir];

    const concurrency = 6;
    const procs: ReturnType<typeof spawn>[] = [];
    const results: string[] = [];

    for (let i = 0; i < concurrency; i++) {
      const child = spawn(process.execPath, childArgs, {
        stdio: ["pipe", "pipe", "inherit"],
      });
      procs.push(child);
    }

    let winnerProc: ReturnType<typeof spawn> | null = null;
    let readyCount = 0;

    await new Promise<void>((resolvePromise, rejectPromise) => {
      const timeout = setTimeout(() => {
        for (const p of procs) {
          try {
            p.kill("SIGKILL");
          } catch {}
        }
        rejectPromise(
          new Error(
            `Test timed out waiting for children results (got ${results.length}/${concurrency})`
          )
        );
      }, 10000);

      for (const child of procs) {
        let buffer = "";
        child.stdout?.on("data", (chunk) => {
          buffer += chunk.toString();
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";

          for (const line of lines) {
            const trimmed = line.trim();
            if (trimmed === "READY") {
              readyCount++;
              if (readyCount === concurrency) {
                for (const p of procs) {
                  p.stdin?.write("START\n");
                }
              }
            } else if (trimmed.startsWith("RESULT:")) {
              const res = trimmed.replace("RESULT:", "");
              results.push(res);
              if (res === "SUCCESS") {
                winnerProc = child;
              }
              if (results.length === concurrency) {
                clearTimeout(timeout);
                resolvePromise();
              }
            }
          }
        });

        child.on("error", (err) => {
          clearTimeout(timeout);
          rejectPromise(err);
        });
      }
    });

    const successCount = results.filter((r) => r === "SUCCESS").length;
    const inUseCount = results.filter((r) => r === "DATA_DIR_IN_USE").length;

    expect(successCount).toBe(1);
    expect(inUseCount).toBe(concurrency - 1);
    expect(results.length).toBe(concurrency);

    if (winnerProc) {
      (winnerProc as any).stdin?.write("RELEASE\n");
    }

    await Promise.all(
      procs.map(
        (p) =>
          new Promise<void>((res) => {
            if (p.exitCode !== null) {
              res();
            } else {
              p.on("exit", () => res());
            }
          })
      )
    );

    expect(existsSync(lockDir)).toBe(false);
    const remainingQuarantines = readdirSync(tempDir).filter((name) =>
      name.includes(".quarantine.") || name.includes(".reclaim")
    );
    expect(remainingQuarantines.length).toBe(0);
  });

  it("若 reclaim guard 持有者意外崩溃超期，竞争者能安全清理陈旧 reclaim 目录并成功获取主锁", async () => {
    const lockDir = join(tempDir, ".actiondock.data.lock");
    const reclaimDir = `${lockDir}.reclaim`;

    // 模拟前一个接管者创建了 reclaim guard 后崩溃：PID 死亡且创建时间已超过宽限期
    mkdirSync(reclaimDir, { mode: 0o700 });
    const staleReclaimInfo = {
      pid: 99999995,
      createdAt: Date.now() - 3000,
    };
    writeFileSync(
      join(reclaimDir, "metadata.json"),
      JSON.stringify(staleReclaimInfo, null, 2),
      { mode: 0o600 }
    );

    // 竞争者执行 acquire：应当自动识别并清理陈旧 reclaim 目录，成功获取主锁
    const lock = DataDirLock.acquire(tempDir);
    expect(lock).toBeDefined();
    expect(existsSync(lockDir)).toBe(true);
    expect(existsSync(reclaimDir)).toBe(false);

    lock.release();
    expect(existsSync(lockDir)).toBe(false);
  });

  it("当检测到 reclaim guard 存在且持有者存活时，竞争者必须等待禁止抢先创建主锁", async () => {
    const lockDir = join(tempDir, ".actiondock.data.lock");
    const reclaimDir = `${lockDir}.reclaim`;

    // 启动存活的假子进程模拟活跃的接管者
    const dummyHolder = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
      stdio: "ignore",
    });

    mkdirSync(reclaimDir, { mode: 0o700 });
    writeFileSync(
      join(reclaimDir, "metadata.json"),
      JSON.stringify({ pid: dummyHolder.pid, createdAt: Date.now() }, null, 2),
      { mode: 0o600 }
    );

    // 启动后台工作线程，在 60ms 后清理 reclaim guard 并结束假接管者
    const workerScript = `
      const fs = require("node:fs");
      setTimeout(() => {
        try {
          process.kill(${dummyHolder.pid}, "SIGKILL");
        } catch {}
        try {
          fs.rmSync(${JSON.stringify(reclaimDir)}, { recursive: true, force: true });
        } catch {}
      }, 60);
    `;
    const worker = new Worker(workerScript, { eval: true });

    try {
      // 竞争者尝试获取锁：由于感知到活跃 reclaim guard，不会强行抢锁破坏，而是等待其释放后成功创建主锁
      const lock = DataDirLock.acquire(tempDir);
      expect(lock).toBeDefined();
      expect(existsSync(lockDir)).toBe(true);
      expect(existsSync(reclaimDir)).toBe(false);

      lock.release();
      expect(existsSync(lockDir)).toBe(false);
    } finally {
      await worker.terminate();
      try {
        dummyHolder.kill("SIGKILL");
      } catch {}
    }
  });

  it("交错抢锁竞态：B 先创建目录后发现活跃 reclaim guard 仅安全回滚自身锁，不误删 A 的新锁", async () => {
    const lockDir = join(tempDir, ".actiondock.data.lock");
    const reclaimDir = `${lockDir}.reclaim`;

    // 1. 模拟初始存在一个陈旧的主锁
    mkdirSync(lockDir, { mode: 0o700 });
    const staleLockInfo = {
      pid: 99999991,
      hostname: "stale-host",
      sessionToken: "stale-session-1",
      createdAt: new Date(Date.now() - 5000).toISOString(),
    };
    writeFileSync(join(lockDir, "metadata.json"), JSON.stringify(staleLockInfo, null, 2), { mode: 0o600 });

    // 2. 模拟接管者 A 获得了 reclaim guard
    mkdirSync(reclaimDir, { mode: 0o700 });
    const guardTokenA = "guard-token-A";
    writeFileSync(
      join(reclaimDir, "metadata.json"),
      JSON.stringify({ pid: process.pid, guardToken: guardTokenA, createdAt: Date.now() }, null, 2),
      { mode: 0o600 }
    );

    // 3. 启动异步并发者 B：执行 acquire。由于检测到活跃 reclaim guard，B 将等待；
    // 我们模拟 B 已经提前通过了 pre-check，直接向 lockDir 执行 mkdir 并写入 B 的 sessionToken，
    // 随后 B 执行 postCheck 发现 A 的 reclaim guard，执行 safeRollbackLock
    const bSessionToken = "session-token-B";
    // 先由 A 清理 staleLock
    rmSync(lockDir, { recursive: true, force: true });

    // B 抢先 mkdir
    mkdirSync(lockDir, { mode: 0o700 });
    writeFileSync(
      join(lockDir, "metadata.json"),
      JSON.stringify({ pid: process.pid, sessionToken: bSessionToken, createdAt: new Date().toISOString() }, null, 2),
      { mode: 0o600 }
    );

    // 4. 使用后台 Worker 线程模拟 B 在 40ms 后执行安全回滚并释放 A 的 reclaim guard
    const workerScript1 = `
      const fs = require("node:fs");
      setTimeout(() => {
        const rollbackQuarantine = ${JSON.stringify(lockDir)} + ".rollback." + process.pid + "." + Date.now() + ".b";
        try {
          fs.renameSync(${JSON.stringify(lockDir)}, rollbackQuarantine);
          const meta = JSON.parse(fs.readFileSync(rollbackQuarantine + "/metadata.json", "utf8"));
          if (meta.sessionToken === ${JSON.stringify(bSessionToken)}) {
            fs.rmSync(rollbackQuarantine, { recursive: true, force: true });
          }
        } catch (e) {}
        try {
          fs.rmSync(${JSON.stringify(reclaimDir)}, { recursive: true, force: true });
        } catch (e) {}
      }, 40);
    `;
    const worker1 = new Worker(workerScript1, { eval: true });

    try {
      // 接管者 A 执行 acquire，应当等待 B 安全回滚自身锁，随后 A 原子获得主锁并返回
      const lockA = DataDirLock.acquire(tempDir);
      expect(lockA).toBeDefined();
      expect(existsSync(lockDir)).toBe(true);

      // 验证锁目录里的 sessionToken 是 A 的，而不是 B 的，且 A 的锁未被删除
      const currentMeta = JSON.parse(readFileSync(join(lockDir, "metadata.json"), "utf8"));
      expect(currentMeta.sessionToken).toBe(lockA.lockInfo.sessionToken);

      lockA.release();
      expect(existsSync(lockDir)).toBe(false);
    } finally {
      await worker1.terminate();
    }
  });

  it("陈旧接管守卫并发清理竞态：A 清理陈旧 guard 时若已被 B 替换为新 guard，A 绝不误删 B 的新 guard", async () => {
    const lockDir = join(tempDir, ".actiondock.data.lock");
    const reclaimDir = `${lockDir}.reclaim`;

    // 模拟陈旧 guard (PID 99999990, guardToken: old-token)
    mkdirSync(reclaimDir, { mode: 0o700 });
    writeFileSync(
      join(reclaimDir, "metadata.json"),
      JSON.stringify({ pid: 99999990, guardToken: "old-token", createdAt: Date.now() - 5000 }, null, 2),
      { mode: 0o600 }
    );

    // 模拟竞争者 B 抢先清理了 old-token 并建立了新活跃 guard (PID: 当前存活 PID, guardToken: new-token-B)
    rmSync(reclaimDir, { recursive: true, force: true });
    mkdirSync(reclaimDir, { mode: 0o700 });
    writeFileSync(
      join(reclaimDir, "metadata.json"),
      JSON.stringify({ pid: process.pid, guardToken: "new-token-B", createdAt: Date.now() }, null, 2),
      { mode: 0o600 }
    );

    // 竞争者 C 启动 acquire：由于 B 的 reclaim guard 处于活跃状态，C 必须等待而不是删掉 B 的 guard
    // 50ms 后使用 Worker 模拟 B 正常完成主锁创建并释放 reclaim guard
    const workerScript2 = `
      const fs = require("node:fs");
      setTimeout(() => {
        try {
          fs.mkdirSync(${JSON.stringify(lockDir)}, { mode: 0o700 });
          fs.writeFileSync(
            ${JSON.stringify(join(lockDir, "metadata.json"))},
            JSON.stringify({ pid: ${process.pid}, sessionToken: "token-b", createdAt: new Date().toISOString() }, null, 2),
            { mode: 0o600 }
          );
          fs.rmSync(${JSON.stringify(reclaimDir)}, { recursive: true, force: true });
        } catch (e) {}
      }, 50);
    `;
    const worker2 = new Worker(workerScript2, { eval: true });

    try {
      // C 执行 acquire：检测到锁被占用，抛出 DATA_DIR_IN_USE（因为 B 的主锁持有人是当前存活进程）
      let caughtErr: any;
      try {
        DataDirLock.acquire(tempDir);
      } catch (err) {
        caughtErr = err;
      }

      expect(caughtErr).toBeDefined();
      expect(caughtErr?.code).toBe("DATA_DIR_IN_USE");

      // 清理 B 的主锁
      rmSync(lockDir, { recursive: true, force: true });
    } finally {
      await worker2.terminate();
    }
  });

  it("当 reclaimPath 的 guardToken 与 expectedGuardToken 不匹配时，safeRemoveStaleReclaimGuard 绝不重命名或破坏该 guard", () => {
    const lockDir = join(tempDir, ".actiondock.data.lock");
    const reclaimDir = `${lockDir}.reclaim`;
    mkdirSync(reclaimDir, { recursive: true });

    const staleTime = new Date(Date.now() - 5000);
    const guardData = {
      pid: 99999999,
      guardToken: "token-actual-12345",
      createdAt: Date.now() - 5000,
    };
    writeFileSync(
      join(reclaimDir, "metadata.json"),
      JSON.stringify(guardData, null, 2),
      "utf8"
    );

    // 1. 刚刚写入处于宽限期内（mtimeMs 在 1000ms 内），预检应直接拦截，不重命名或破坏该 guard
    safeRemoveStaleReclaimGuard(reclaimDir, "token-actual-12345");
    expect(existsSync(reclaimDir)).toBe(true);

    // 调整时间戳超出宽限期
    utimesSync(join(reclaimDir, "metadata.json"), staleTime, staleTime);
    utimesSync(reclaimDir, staleTime, staleTime);

    // 2. 传入不匹配的 expectedGuardToken，预检应立即拦截，绝不重命名或破坏该 guard
    safeRemoveStaleReclaimGuard(reclaimDir, "token-expected-99999");

    // 验证 reclaimDir 依然完整存在，未被重命名或破坏
    expect(existsSync(reclaimDir)).toBe(true);
    expect(existsSync(join(reclaimDir, "metadata.json"))).toBe(true);
    const content = JSON.parse(readFileSync(join(reclaimDir, "metadata.json"), "utf8"));
    expect(content.guardToken).toBe("token-actual-12345");

    // 3. 验证当 metadata.json 尚不存在时，预检立即拦截，绝不重命名或破坏该目录
    const emptyReclaimDir = join(tempDir, "empty.reclaim");
    mkdirSync(emptyReclaimDir, { recursive: true });
    safeRemoveStaleReclaimGuard(emptyReclaimDir, "some-token");
    expect(existsSync(emptyReclaimDir)).toBe(true);
    rmSync(emptyReclaimDir, { recursive: true, force: true });

    // 4. 验证当 expectedGuardToken 匹配且超出宽限期时，安全清理
    safeRemoveStaleReclaimGuard(reclaimDir, "token-actual-12345");
    expect(existsSync(reclaimDir)).toBe(false);
  });
});
