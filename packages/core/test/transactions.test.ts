import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
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
    writeFileSync(join(tempDir, "actiondock.lock.json"), JSON.stringify({ lockfileVersion: 2 }));

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
});
