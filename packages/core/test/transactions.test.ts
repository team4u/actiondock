import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { spawn } from "node:child_process";
import fs, { existsSync, mkdirSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  acquireProjectLock,
  beginTransaction,
  hasPendingTransactions,
  recoverPendingTransactions,
  safeRemoveStaleProjectReclaimGuard,
  safeRollbackProjectLock,
} from "../src/project/transactions";

describe("原子事务快照与崩溃恢复", () => {
  const tempDir = join(process.cwd(), ".tmp-tx-test-" + Date.now());

  beforeEach(() => {
    mkdirSync(tempDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("获取排他锁并阻止并发加锁", () => {
    const release1 = acquireProjectLock(tempDir);
    expect(existsSync(join(tempDir, ".actiondock", "project.lock"))).toBe(true);

    // 同一进程再次加锁检测活跃 PID 并抛出异常
    expect(() => acquireProjectLock(tempDir)).toThrow(/Project modification lock is held/);

    release1();
    expect(existsSync(join(tempDir, ".actiondock", "project.lock"))).toBe(false);

    // 释放后可再次加锁
    const release2 = acquireProjectLock(tempDir);
    release2();
  });

  it("正常提交事务并清理事务快照目录", async () => {
    writeFileSync(join(tempDir, "actiondock.json"), JSON.stringify({ id: "test", version: "1.0.0" }));

    const tx = await beginTransaction(tempDir, "test commit");
    expect(hasPendingTransactions(tempDir)).toBe(true);

    // 修改文件
    writeFileSync(join(tempDir, "actiondock.json"), JSON.stringify({ id: "test", version: "1.1.0" }));

    await tx.commit();
    expect(hasPendingTransactions(tempDir)).toBe(false);

    const after = JSON.parse(readFileSync(join(tempDir, "actiondock.json"), "utf-8"));
    expect(after.version).toBe("1.1.0");
  });

  it("事务回滚恢复旧快照并清理新生成的文件", async () => {
    writeFileSync(join(tempDir, "actiondock.json"), JSON.stringify({ id: "test", version: "1.0.0" }));

    const tx = await beginTransaction(tempDir, "test rollback");

    // 修改旧文件并新建文件
    writeFileSync(join(tempDir, "actiondock.json"), JSON.stringify({ id: "test", version: "2.0.0" }));
    writeFileSync(join(tempDir, "actiondock.lock.json"), JSON.stringify({ lockfileVersion: 1 }));

    // 回滚（单测中禁用外部网络安装 frozenInstall: false）
    await tx.rollback({ frozenInstall: false });

    const content = JSON.parse(readFileSync(join(tempDir, "actiondock.json"), "utf-8"));
    expect(content.version).toBe("1.0.0");
    // 新生成的文件应被清理删除
    expect(existsSync(join(tempDir, "actiondock.lock.json"))).toBe(false);
    expect(hasPendingTransactions(tempDir)).toBe(false);
  });

  it("模拟异常崩溃在下一次启动或修改前依据事务日志恢复快照", async () => {
    writeFileSync(join(tempDir, "actiondock.json"), JSON.stringify({ id: "test", version: "1.0.0" }));

    const tx = await beginTransaction(tempDir, "crash simulation");

    // 模拟破坏性修改
    writeFileSync(join(tempDir, "actiondock.json"), JSON.stringify({ id: "test", version: "damaged" }));

    // 模拟进程直接退出（释放排他锁但未执行 commit 或 rollback，留下 pending 状态）
    tx.releaseLock();
    expect(hasPendingTransactions(tempDir)).toBe(true);

    // 下次执行恢复
    const recovered = await recoverPendingTransactions(tempDir, { frozenInstall: false });
    expect(recovered.length).toBe(1);
    expect(hasPendingTransactions(tempDir)).toBe(false);

    const restored = JSON.parse(readFileSync(join(tempDir, "actiondock.json"), "utf-8"));
    expect(restored.version).toBe("1.0.0");
  });

  it("真实多进程并发争抢陈旧工程主锁时，严格保证仅有一个子进程成功接管，其余子进程均被拦截", async () => {
    const lockDir = join(tempDir, ".actiondock", "project.lock");
    mkdirSync(lockDir, { recursive: true });
    // 构造模拟崩溃残留锁文件：PID 99999998 已死亡且超出宽限期
    const staleLockInfo = {
      pid: 99999998,
      sessionToken: "crashed-project-token",
      createdAt: Date.now() - 20000,
    };
    writeFileSync(join(lockDir, "metadata.json"), JSON.stringify(staleLockInfo, null, 2), "utf-8");

    const txModulePath = resolve(import.meta.dirname, "../src/project/transactions.ts");
    const workerScript = join(tempDir, "proj-lock-worker.mjs");
    const workerContent = `
import { acquireProjectLock } from ${JSON.stringify(pathToFileURL(txModulePath).href)};
import readline from "node:readline";

const projectDir = process.argv[2];
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
let release = null;

process.stdout.write("READY\\n");

rl.on("line", (cmd) => {
  const action = cmd.trim();
  if (action === "START") {
    try {
      release = acquireProjectLock(projectDir);
      process.stdout.write("RESULT:SUCCESS\\n");
    } catch (err) {
      process.stdout.write("RESULT:" + (err?.code || "LOCK_FAILED") + "\\n");
      process.exit(0);
    }
  } else if (action === "RELEASE") {
    if (release) {
      release();
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
          new Error(`Test timed out waiting for children results (got ${results.length}/${concurrency})`)
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
    expect(successCount).toBe(1);
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
  });

  it("当 acquireProjectLock 遇到存活进程持锁抛出 PROJECT_BUSY 错误代码", () => {
    const lockDir = join(tempDir, ".actiondock", "project.lock");
    mkdirSync(lockDir, { recursive: true });
    writeFileSync(
      join(lockDir, "metadata.json"),
      JSON.stringify({
        pid: process.pid,
        sessionToken: "active-holder-token",
        createdAt: Date.now(),
      })
    );

    let caughtErr: any;
    try {
      acquireProjectLock(tempDir);
    } catch (err) {
      caughtErr = err;
    }

    expect(caughtErr).toBeDefined();
    expect(caughtErr?.code).toBe("PROJECT_BUSY");
    expect(caughtErr?.message).toContain("PROJECT_BUSY");
  });

  it("当工程锁被存活进程占用（PROJECT_BUSY）时 recoverPendingTransactions 安全返回空数组", async () => {
    const txBaseDir = join(tempDir, ".actiondock", "transactions");
    mkdirSync(txBaseDir, { recursive: true });
    const lockDir = join(tempDir, ".actiondock", "project.lock");
    mkdirSync(lockDir, { recursive: true });
    writeFileSync(
      join(lockDir, "metadata.json"),
      JSON.stringify({
        pid: process.pid,
        sessionToken: "active-holder-token",
        createdAt: Date.now(),
      })
    );

    const res = await recoverPendingTransactions(tempDir);
    expect(res).toEqual([]);
  });

  it("当 acquireProjectLock 遇到权限或非 busy 异常时 recoverPendingTransactions 会正确向外抛出", async () => {
    const txBaseDir = join(tempDir, ".actiondock", "transactions");
    mkdirSync(txBaseDir, { recursive: true });

    const origMkdir = fs.mkdirSync;
    try {
      // 模拟底层文件系统权限异常 EACCES
      fs.mkdirSync = ((path: any, options: any) => {
        if (typeof path === "string" && path.includes("project.lock")) {
          const err: any = new Error("EACCES: permission denied, mkdir '" + path + "'");
          err.code = "EACCES";
          throw err;
        }
        return origMkdir(path, options);
      }) as any;

      let caughtErr: any;
      try {
        await recoverPendingTransactions(tempDir);
      } catch (err) {
        caughtErr = err;
      }

      expect(caughtErr).toBeDefined();
      expect(caughtErr?.code).toBe("EACCES");
    } finally {
      fs.mkdirSync = origMkdir;
    }

    // 验证其他非 busy 系统异常（如 ENOSPC）同样向外透传，严禁静默吞掉
    try {
      fs.mkdirSync = ((path: any, options: any) => {
        if (typeof path === "string" && path.includes("project.lock")) {
          const err: any = new Error("ENOSPC: no space left on device");
          err.code = "ENOSPC";
          throw err;
        }
        return origMkdir(path, options);
      }) as any;

      let caughtErr2: any;
      try {
        await recoverPendingTransactions(tempDir);
      } catch (err) {
        caughtErr2 = err;
      }

      expect(caughtErr2).toBeDefined();
      expect(caughtErr2?.code).toBe("ENOSPC");
    } finally {
      fs.mkdirSync = origMkdir;
    }
  });

  it("当活跃 reclaim guard 持续存在时，acquireProjectLock 遵循 acquireTimeoutMs 超时退出并抛出 PROJECT_BUSY", () => {
    const lockDir = join(tempDir, ".actiondock", "project.lock");
    const reclaimDir = `${lockDir}.reclaim`;
    mkdirSync(reclaimDir, { recursive: true });

    // 构造活跃的 reclaim guard（当前进程 PID 存活且创建于刚刚）
    writeFileSync(
      join(reclaimDir, "metadata.json"),
      JSON.stringify({ pid: process.pid, guardToken: "active-guard-token", createdAt: Date.now() }, null, 2),
      "utf-8"
    );

    let caughtErr: any;
    const start = Date.now();
    try {
      acquireProjectLock(tempDir, { acquireTimeoutMs: 150 });
    } catch (err) {
      caughtErr = err;
    }
    const elapsed = Date.now() - start;

    expect(caughtErr).toBeDefined();
    expect(caughtErr?.code).toBe("PROJECT_BUSY");
    expect(caughtErr?.message).toContain("Timeout waiting for active reclaim guard");
    expect(elapsed).toBeGreaterThanOrEqual(100);

    // 清理
    rmSync(reclaimDir, { recursive: true, force: true });
  });

  it("当工程接管守卫 token 不匹配且恢复原位失败时，safeRemoveStaleProjectReclaimGuard 绝不执行 rmSync 误删隔离目录", () => {
    const lockDir = join(tempDir, ".actiondock", "project.lock");
    const reclaimDir = `${lockDir}.reclaim`;
    mkdirSync(reclaimDir, { recursive: true });

    const guardData = {
      pid: 99999999,
      guardToken: "token-actual-rival",
      createdAt: Date.now() - 5000,
    };
    writeFileSync(
      join(reclaimDir, "metadata.json"),
      JSON.stringify(guardData, null, 2),
      "utf-8"
    );

    const origRenameSync = fs.renameSync;
    let quarantinedPathFound = "";
    try {
      (fs.renameSync as any) = (src: string, dest: string) => {
        if (typeof src === "string" && src.includes(".reclaim.quarantine")) {
          const err: any = new Error("EEXIST: file already exists");
          err.code = "EEXIST";
          throw err;
        }
        if (typeof dest === "string" && dest.includes(".reclaim.quarantine")) {
          quarantinedPathFound = dest;
        }
        return origRenameSync(src, dest);
      };

      // 不传入 expectedGuardToken，进入隔离后 token 检查分支
      safeRemoveStaleProjectReclaimGuard(reclaimDir);

      // 验证隔离目录依然完整保留，绝未被 rmSync 误删
      expect(quarantinedPathFound).not.toBe("");
      expect(existsSync(quarantinedPathFound)).toBe(true);
    } finally {
      (fs.renameSync as any) = origRenameSync;
      if (quarantinedPathFound && existsSync(quarantinedPathFound)) {
        rmSync(quarantinedPathFound, { recursive: true, force: true });
      }
    }
  });

  it("持有者 PID 存活的工程接管守卫不会被判定为陈旧守卫，竞争者等待超时并抛出 PROJECT_BUSY", () => {
    const lockDir = join(tempDir, ".actiondock", "project.lock");
    const reclaimDir = `${lockDir}.reclaim`;
    mkdirSync(reclaimDir, { recursive: true });

    // 模拟持有者 PID 存活的工程接管守卫
    const guardToken = "alive-project-guard-token";
    writeFileSync(
      join(reclaimDir, "metadata.json"),
      JSON.stringify({ pid: process.pid, guardToken, createdAt: Date.now() - 10000 }, null, 2),
      "utf-8"
    );

    const start = Date.now();
    expect(() => {
      acquireProjectLock(tempDir, { acquireTimeoutMs: 150 });
    }).toThrow("PROJECT_BUSY");
    const elapsed = Date.now() - start;
    expect(elapsed).toBeGreaterThanOrEqual(100);
    expect(elapsed).toBeLessThan(600);
    expect(existsSync(reclaimDir)).toBe(true);

    // 清理
    rmSync(reclaimDir, { recursive: true, force: true });
  });

  it("safeRollbackProjectLock 严格核对 sessionToken：一致时清理目录，不匹配时完整恢复原位", () => {
    const lockDir = join(tempDir, ".actiondock", "project.lock");
    mkdirSync(lockDir, { recursive: true });
    const correctToken = "proj-session-token-correct";
    const wrongToken = "proj-session-token-wrong";

    writeFileSync(
      join(lockDir, "metadata.json"),
      JSON.stringify({ pid: process.pid, sessionToken: correctToken }, null, 2),
      "utf-8"
    );

    // 传入不匹配的 token：锁目录绝不删除，恢复原位
    safeRollbackProjectLock(lockDir, wrongToken);
    expect(existsSync(lockDir)).toBe(true);
    expect(existsSync(join(lockDir, "metadata.json"))).toBe(true);

    // 传入匹配的 token：锁目录被安全回滚并清理
    safeRollbackProjectLock(lockDir, correctToken);
    expect(existsSync(lockDir)).toBe(false);
  });

  it("acquireProjectLock 在遇到缺失 metadata.json 的宽限期主锁目录时，严格受限于 acquireTimeoutMs 并在小超时下快速退出", () => {
    const lockDir = join(tempDir, ".actiondock", "project.lock");
    mkdirSync(lockDir, { recursive: true });

    const start = Date.now();
    expect(() => {
      acquireProjectLock(tempDir, { acquireTimeoutMs: 100 });
    }).toThrow("PROJECT_BUSY");
    const elapsed = Date.now() - start;

    expect(elapsed).toBeGreaterThanOrEqual(80);
    expect(elapsed).toBeLessThan(400);

    // 清理
    rmSync(lockDir, { recursive: true, force: true });
  });

  it("safeRemoveStaleProjectReclaimGuard 在 token 不匹配时保持隔离状态，绝不恢复至 canonical 路径以防鬼魅守卫", () => {
    const lockDir = join(tempDir, ".actiondock", "project.lock");
    const reclaimDir = `${lockDir}.reclaim`;
    mkdirSync(reclaimDir, { recursive: true });
    writeFileSync(
      join(reclaimDir, "metadata.json"),
      JSON.stringify({ pid: 999999, guardToken: "new-active-token", createdAt: Date.now() }, null, 2),
      "utf8"
    );

    // 不带 expectedGuardToken 调用：重命名到隔离区后检测到 actualGuardToken 存在且不匹配（undefined !== actual）
    // 旧代码会 rename 回 reclaimDir 导致鬼魅守卫复活；新代码保持隔离状态，不恢复主路径
    safeRemoveStaleProjectReclaimGuard(reclaimDir);
    expect(existsSync(reclaimDir)).toBe(false);
  });

  it("acquireProjectLock 与 release 会安全 GC 清理超期的工程锁隔离目录", () => {
    const metaDir = join(tempDir, ".actiondock");
    mkdirSync(metaDir, { recursive: true });
    const staleQuarantine = join(metaDir, "project.lock.quarantine.12345.100.abcd");
    mkdirSync(staleQuarantine, { recursive: true });
    const oldTime = (Date.now() - 20000) / 1000;
    utimesSync(staleQuarantine, oldTime, oldTime);

    const release = acquireProjectLock(tempDir);
    expect(existsSync(staleQuarantine)).toBe(false);
    release();
  });

  it("源锁目录 mtime 较旧但刚刚被重命名为带当前时间戳的隔离目录时，工程锁 GC 绝不误删，超过 10 秒后才安全删除", () => {
    const metaDir = join(tempDir, ".actiondock");
    mkdirSync(metaDir, { recursive: true });

    // - 创建源锁目录并将其 mtime 设置为 1 小时前
    const sourceDir = join(metaDir, "project.lock");
    mkdirSync(sourceDir, { recursive: true });
    const oneHourAgo = (Date.now() - 3600 * 1000) / 1000;
    utimesSync(sourceDir, oneHourAgo, oneHourAgo);

    // - 刚刚重命名为带当前时间戳的隔离目录（操作者为死亡进程）
    const deadOperatorPid = 99999999;
    const recentQuarantine = join(
      metaDir,
      `project.lock.quarantine.${deadOperatorPid}.${Date.now()}.uuid1234`
    );
    fs.renameSync(sourceDir, recentQuarantine);

    // - 验证继承了旧 mtime
    const stat = statSync(recentQuarantine);
    expect(Date.now() - stat.mtimeMs).toBeGreaterThan(3000 * 1000);

    // - 执行 acquire 触发 GC：由于文件名包含当前时间戳，GC 判定其处于 10 秒保护期内，绝不误删
    const release = acquireProjectLock(tempDir);
    expect(existsSync(recentQuarantine)).toBe(true);
    release();

    // - 当文件名中的隔离时间戳超过 10 秒后，操作者已死亡且无存活所有者，GC 允许安全清理
    const expiredQuarantine = join(
      metaDir,
      `project.lock.quarantine.${deadOperatorPid}.${Date.now() - 20000}.uuid5678`
    );
    fs.renameSync(recentQuarantine, expiredQuarantine);

    const release2 = acquireProjectLock(tempDir);
    expect(existsSync(expiredQuarantine)).toBe(false);
    release2();
  });

  it("超期的工程锁 rollback 隔离目录在其 metadata.json 指向存活 PID 时 GC 完好保留，修改为死亡 PID 后被安全清理", () => {
    const metaDir = join(tempDir, ".actiondock");
    mkdirSync(metaDir, { recursive: true });

    // - 构造超期（>20 秒）的 rollback 目录，操作者 PID 为已死亡的 99999999
    const deadOperatorPid = 99999999;
    const rollbackDir = join(
      metaDir,
      `project.lock.rollback.${deadOperatorPid}.${Date.now() - 25000}.uuid1111`
    );
    mkdirSync(rollbackDir, { recursive: true });

    // - 内部 metadata.json 记录锁持有者为当前存活的 process.pid
    const metaFile = join(rollbackDir, "metadata.json");
    const activeMeta = {
      pid: process.pid,
      sessionToken: "active-session-token",
      createdAt: Date.now() - 25000,
    };
    writeFileSync(metaFile, JSON.stringify(activeMeta, null, 2), "utf-8");

    // - 执行 acquireProjectLock 触发 GC：持有者存活，完好保留
    const release1 = acquireProjectLock(tempDir);
    expect(existsSync(rollbackDir)).toBe(true);
    release1();

    // - 将 metadata.json 修改为死亡 PID
    const deadMeta = {
      ...activeMeta,
      pid: deadOperatorPid,
    };
    writeFileSync(metaFile, JSON.stringify(deadMeta, null, 2), "utf-8");

    // - 再次执行 acquireProjectLock 触发 GC：持有者已死且超期，被安全清理
    const release2 = acquireProjectLock(tempDir);
    expect(existsSync(rollbackDir)).toBe(false);
    release2();
  });

  it("当工程锁隔离目录名称中的操作者 PID 为存活进程时，即使隔离超期也绝对不被 GC 删除", () => {
    const metaDir = join(tempDir, ".actiondock");
    mkdirSync(metaDir, { recursive: true });

    // - 构造超期（>20 秒）的隔离目录，但操作者 PID 为当前存活的 process.pid
    const liveOperatorQuarantine = join(
      metaDir,
      `project.lock.rollback.${process.pid}.${Date.now() - 25000}.uuid2222`
    );
    mkdirSync(liveOperatorQuarantine, { recursive: true });

    // - 即使 metadata.json 为死亡 PID
    const metaFile = join(liveOperatorQuarantine, "metadata.json");
    writeFileSync(metaFile, JSON.stringify({ pid: 99999999, sessionToken: "dead-token" }, null, 2), "utf-8");

    // - 执行 acquireProjectLock 触发 GC：操作者存活，绝不清理
    const release = acquireProjectLock(tempDir);
    expect(existsSync(liveOperatorQuarantine)).toBe(true);
    release();
  });
});
