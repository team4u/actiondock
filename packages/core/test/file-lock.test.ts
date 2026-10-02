import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  acquireFileLock,
  acquireFileLockSync,
  isLockHeld,
  isStaleLock,
  isStaleLockSync,
} from "../src/storage/file-lock";
import type { Clock } from "../src/storage/clock";
import { ActionDockError, STORAGE_BUSY, TIMEOUT } from "../src/errors";

/**
 * 确定性虚拟测试时钟。
 * 遵循 Clock 接口契约，支持手动推进时间并立即触发挂起的 sleep 计划。
 * 墙钟起点取真实当前时间，避免虚拟时间早于被测文件的真实 mtime 导致年龄恒为负。
 */
class DeterministicTestClock implements Clock {
  private currentNow: number;
  private currentMonotonic: number;
  private pendingSleeps: Array<{ targetMonotonic: number; resolve: () => void }> = [];

  constructor(startMs = Date.now()) {
    this.currentNow = startMs;
    this.currentMonotonic = 0;
  }

  now(): Date {
    return new Date(this.currentNow);
  }

  monotonic(): number {
    return this.currentMonotonic;
  }

  sleep(ms: number): Promise<void> {
    if (ms <= 0) return Promise.resolve();
    return new Promise((resolve) => {
      this.pendingSleeps.push({
        targetMonotonic: this.currentMonotonic + ms,
        resolve,
      });
    });
  }

  advance(ms: number): void {
    this.currentMonotonic += ms;
    this.currentNow += ms;
    const ready = this.pendingSleeps.filter((s) => s.targetMonotonic <= this.currentMonotonic);
    this.pendingSleeps = this.pendingSleeps.filter((s) => s.targetMonotonic > this.currentMonotonic);
    for (const item of ready) {
      item.resolve();
    }
  }

  hasPendingSleeps(): boolean {
    return this.pendingSleeps.length > 0;
  }
}

/** 确定存活的非本进程标识（PID 1 恒为 init 进程） */
const FOREIGN_LIVE_PID = 1;

describe("文件锁时钟源注入与确定性测试", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "ad-file-lock-test-"));
  });

  afterEach(() => {
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // 忽略临时目录清理异常
    }
  });

  it("当被其他存活进程占用时，acquireFileLock 通过注入的 Clock 确定性推进并在超时后抛出 TIMEOUT", async () => {
    const lockPath = join(tempDir, "test.lock");
    mkdirSync(lockPath, { recursive: true });

    // 写入其他存活进程（PID 1）的持有者元数据，使陈旧判定永不通过、锁不可接管
    const metadata = {
      pid: FOREIGN_LIVE_PID,
      token: "existing-live-token",
      createdAt: new Date().toISOString(),
    };
    writeFileSync(join(lockPath, "metadata.json"), JSON.stringify(metadata, null, 2));

    const clock = new DeterministicTestClock();
    const acquireTimeoutMs = 1000;
    const retryDelayMs = 50;

    let caughtError: any;
    const acquirePromise = acquireFileLock(lockPath, {
      acquireTimeoutMs,
      retryDelayMs,
      clock,
    }).catch((err) => {
      caughtError = err;
    });

    // 轮询等待 acquireFileLock 走完存活性判定链并注册 clock.sleep（上限 2 秒防御性退出）。
    // 陈旧判定内部包含多次异步 IO（mkdir 探测、stat、读元数据），
    // 不同 runner 的 worker 调度下刻度数不固定，轮询是唯一确定性等待方式。
    const waitStart = Date.now();
    while (!clock.hasPendingSleeps() && Date.now() - waitStart < 2000) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    assert.strictEqual(clock.hasPendingSleeps(), true);

    // 推进时钟超出超时上限，虚拟 sleep 立即唤醒并触发超时判定
    clock.advance(acquireTimeoutMs + retryDelayMs);

    await acquirePromise;

    assert.ok(caughtError instanceof ActionDockError);
    assert.strictEqual(caughtError.code, TIMEOUT);
    assert.ok((caughtError.message).includes(`Failed to acquire lock '${lockPath}' within ${acquireTimeoutMs}ms`));
  });

  it("当锁被其他活跃进程持有且不满足接管条件时，acquireFileLockSync 抛出 STORAGE_BUSY", () => {
    const lockPath = join(tempDir, "sync.lock");
    mkdirSync(lockPath, { recursive: true });

    const metadata = {
      pid: FOREIGN_LIVE_PID,
      token: "existing-sync-token",
      createdAt: new Date().toISOString(),
    };
    writeFileSync(join(lockPath, "metadata.json"), JSON.stringify(metadata, null, 2));

    const clock = new DeterministicTestClock();

    let caughtError: any;
    try {
      acquireFileLockSync(lockPath, { clock });
    } catch (err) {
      caughtError = err;
    }

    assert.ok(caughtError instanceof ActionDockError);
    assert.strictEqual(caughtError.code, STORAGE_BUSY);
    assert.ok((caughtError.message).includes(`Lock '${lockPath}' is currently held by another active process`));
  });

  it("isStaleLock 与 isStaleLockSync 优先通过注入的 Clock 计算 mtime 超龄", async () => {
    const lockPath = join(tempDir, "stale.lock");
    mkdirSync(lockPath, { recursive: true });

    const startMs = Date.now();
    const clock = new DeterministicTestClock(startMs);

    // 将锁目录 mtime 对齐到虚拟时钟起点，保证年龄计算仅依赖注入时钟的推进
    utimesSync(lockPath, new Date(startMs), new Date(startMs));

    // 锁刚创建时未超龄
    assert.strictEqual(await isStaleLock(lockPath, 10000, { clock, mtimeFirst: true }), false);
    assert.strictEqual(isStaleLockSync(lockPath, 10000, { clock, mtimeFirst: true }), false);

    // 时钟推进 20 秒后超龄
    clock.advance(20000);

    assert.strictEqual(await isStaleLock(lockPath, 10000, { clock, mtimeFirst: true }), true);
    assert.strictEqual(isStaleLockSync(lockPath, 10000, { clock, mtimeFirst: true }), true);
  });
});
