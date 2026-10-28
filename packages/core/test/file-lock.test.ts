import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  acquireFileLock,
  acquireFileLockSync,
  asyncLockDriver,
  isLockHeld,
  isStaleLock,
  isStaleLockSync,
  readLockMetadataSync,
  type FileLockHandle,
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
// 跨平台稳定存活的外部进程标识：Windows 为 System 进程（PID 4），类 Unix 为 init（PID 1）
const FOREIGN_LIVE_PID = process.platform === "win32" ? 4 : 1;

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

describe("陈旧单文件回收所有权仲裁确定性测试", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "ad-file-lock-race-"));
  });

  afterEach(() => {
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // 忽略临时目录清理异常
    }
  });

  it("unlink 与 mkdir 间隙被普通创建者抢占时，未创建主锁的回收者不得覆盖赢家元数据或宣称所有权", async () => {
    const lockPath = join(tempDir, "race.lock");

    // 陈旧单文件锁：持有者进程已死亡，满足回收判定条件
    writeFileSync(
      lockPath,
      JSON.stringify({ pid: 99999998, token: "stale-token", createdAt: new Date().toISOString() }, null, 2),
      { mode: 0o600 }
    );

    const origMkdir = asyncLockDriver.mkdir;
    const origUnlink = asyncLockDriver.unlink;

    interface ParkedCreator {
      opts?: { mode?: number; recursive?: boolean };
      resolve: (value: unknown) => void;
      reject: (reason: unknown) => void;
    }
    let parkedCreator: ParkedCreator | undefined;
    let creatorParked = false;
    let creatorAcquire: Promise<FileLockHandle> | undefined;
    // 停靠信号：mkdir 屏障自身在挂起 B 时 resolve，外部直接 await，无需轮询
    const docked = Promise.withResolvers<void>();
    const acquiredHandles: FileLockHandle[] = [];
    let watchdog: NodeJS.Timeout | undefined;

    try {
      // 普通创建者 B：guard 检查之后、首个针对 lockPath 的 mkdir 被屏障挂起，
      // 模拟其被调度暂停在「已过 guard 检查、尚未创建主锁」的窗口
      asyncLockDriver.mkdir = (path: string, opts?: { mode?: number; recursive?: boolean }) => {
        if (path === lockPath && !creatorParked) {
          creatorParked = true;
          docked.resolve();
          return new Promise((resolve, reject) => {
            parkedCreator = { opts, resolve, reject };
          });
        }
        return origMkdir(path, opts);
      };

      // 回收者 A：删除陈旧单文件后被屏障暂停，先放行 B 完成主锁创建与元数据发布，
      // 再让 A 继续——此时 A 的 mkdir 必然撞上 B 已创建的主锁目录
      asyncLockDriver.unlink = (path: string) => {
        if (path === lockPath) {
          return origUnlink(path).then(async () => {
            const parked = parkedCreator;
            parkedCreator = undefined;
            if (parked) {
              try {
                parked.resolve(await origMkdir(lockPath, parked.opts));
              } catch (err) {
                parked.reject(err);
              }
            }
            await creatorAcquire;
          });
        }
        return origUnlink(path);
      };

      // 防御性看门狗：同时覆盖「B 未停靠 mkdir 屏障」与「A 未到达 unlink 放行」两个阶段，
      // 任一编排失效都释放挂起方使用例快速失败，而非挂起或轮询假失败
      watchdog = setTimeout(() => {
        const parked = parkedCreator;
        parkedCreator = undefined;
        parked?.reject(new Error("watchdog: 回收者未按编排到达 unlink 屏障"));
        docked.reject(new Error("watchdog: 普通创建者未停靠 mkdir 屏障"));
      }, 8000);

      creatorAcquire = acquireFileLock(lockPath, {
        heartbeatMs: 0,
        acquireTimeoutMs: 2000,
        retryDelayMs: 5,
      });

      // 阶段一：确定性等待 B 停靠在 mkdir 屏障（屏障自身发信号，非轮询）
      await docked.promise;

      // 回收者 A：旧单文件仍在时启动，首次 mkdir 必然 EEXIST 并转入陈旧回收分支
      const reclaimerAcquire = acquireFileLock(lockPath, {
        heartbeatMs: 0,
        acquireTimeoutMs: 150,
        retryDelayMs: 10,
      });

      const [creatorOutcome, reclaimerOutcome] = await Promise.allSettled([creatorAcquire, reclaimerAcquire]);

      // 先登记所有实际取得的 handle（含旧实现双成功情形），断言失败时 finally 仍可释放
      for (const outcome of [creatorOutcome, reclaimerOutcome]) {
        if (outcome.status === "fulfilled") {
          acquiredHandles.push(outcome.value);
        }
      }

      // 唯一赢家必须是真实创建主锁的 B；A 在赢家仍持锁期间始终不得获得
      assert.strictEqual(creatorOutcome.status, "fulfilled");
      assert.strictEqual(reclaimerOutcome.status, "rejected");
      const reclaimerError = (reclaimerOutcome as PromiseRejectedResult).reason;
      assert.ok(reclaimerError instanceof ActionDockError);
      assert.strictEqual(reclaimerError.code, TIMEOUT);

      const handleB = (creatorOutcome as PromiseFulfilledResult<FileLockHandle>).value;

      // 输家 A 不得改写赢家元数据（旧实现会在吞掉 EEXIST 后覆写 B 的 token）
      const onDisk = readLockMetadataSync(lockPath);
      assert.notStrictEqual(onDisk, undefined);
      assert.strictEqual(onDisk?.token, handleB.metadata.token);

      // A 放弃回收后必须清理自己的 guard，且不得残留临时元数据文件
      assert.strictEqual(existsSync(`${lockPath}.reclaim`), false);
      const leftovers = readdirSync(lockPath).filter((name) => name.startsWith("meta.tmp."));
      assert.deepStrictEqual(leftovers, []);

      // 赢家按当前 token 认领释放后完全干净
      await handleB.release();
      assert.strictEqual(existsSync(lockPath), false);
    } finally {
      if (watchdog) {
        clearTimeout(watchdog);
      }
      // 释放未完成屏障并恢复驱动方法，避免失败路径污染后续用例
      const parked = parkedCreator;
      parkedCreator = undefined;
      parked?.reject(new Error("测试收尾：释放未完成的 mkdir 屏障"));
      asyncLockDriver.mkdir = origMkdir;
      asyncLockDriver.unlink = origUnlink;
      // 释放所有实际取得的 handle（含旧实现双成功或断言失败路径），清理 activeLockPaths 残留
      for (const handle of acquiredHandles) {
        try {
          await handle.release();
        } catch {
          // 忽略收尾释放异常
        }
      }
    }
  });
});
