import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  acquireProjectLock,
  beginTransaction,
  hasPendingTransactions,
  recoverPendingTransactions,
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
});
