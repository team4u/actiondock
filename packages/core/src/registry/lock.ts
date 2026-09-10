import { mkdir, rename, rm, stat } from "node:fs/promises";

/**
 * 锁目录创建后超过该时长仍未释放，视为持有进程异常退出的残留锁。
 */
export const REGISTRY_LOCK_STALE_MS = 10000;

/**
 * 获取锁的最长等待时间，必须大于 REGISTRY_LOCK_STALE_MS，
 * 保证等待方至少有机会观察到残留锁被回收后再判定超时。
 */
export const REGISTRY_LOCK_ACQUIRE_TIMEOUT_MS = 15000;

/**
 * 两次获取尝试之间的退避间隔，休眠让出事件循环，避免忙等阻塞。
 */
export const REGISTRY_LOCK_RETRY_DELAY_MS = 25;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * 异步注册表锁（防止多进程并发读写导致 registry.json 损坏）。
 *
 * 获取方式：fs/promises mkdir 的原子性保证同一时刻仅一个进程能创建锁目录。
 * 冲突处理：EEXIST 时 stat 检查锁目录年龄，超过 stale 阈值则先原子 rename 到
 * 隔离名再删除——rename 仅有一个进程能成功，失败方回到等待重试，消除
 * 「stat 检查后删除再重建」的竞态窗口；未过期的锁通过 sleep 让出事件循环后重试。
 *
 * @param filePath 注册表文件路径，锁目录为其同级 `${filePath}.lock`
 * @param fn 持锁期间执行的操作（同步或异步）
 * @returns fn 的返回值
 * @throws 超过 REGISTRY_LOCK_ACQUIRE_TIMEOUT_MS 仍未获取时抛出描述性错误
 */
export async function withRegistryLock<T>(
  filePath: string,
  fn: () => T | Promise<T>
): Promise<T> {
  const lockDir = `${filePath}.lock`;
  const deadline = Date.now() + REGISTRY_LOCK_ACQUIRE_TIMEOUT_MS;

  while (true) {
    try {
      // 原子获取：目录创建成功即持有锁，无需二次确认
      await mkdir(lockDir);
      break;
    } catch (err: any) {
      if (err.code !== "EEXIST") {
        throw err;
      }
    }

    // 锁被占用，检查是否为残留的过期锁
    let lockAgeMs: number;
    try {
      const info = await stat(lockDir);
      lockAgeMs = Date.now() - info.mtimeMs;
    } catch (err: any) {
      if (err.code === "ENOENT") {
        // 持有者恰好在两次探测之间释放，立即重试获取
        continue;
      }
      throw err;
    }

    if (lockAgeMs > REGISTRY_LOCK_STALE_MS) {
      // 原子抢占：rename 到含进程号与时间戳的隔离名，仅一个进程能成功；
      // 失败方说明已被其他等待者抢先处理，回到等待重试即可
      const quarantine = `${lockDir}.stale.${process.pid}.${Date.now()}`;
      try {
        await rename(lockDir, quarantine);
        await rm(quarantine, { recursive: true, force: true });
        continue;
      } catch (err: any) {
        if (err.code === "ENOENT") {
          // 其他等待者已抢先回收该残留锁
          continue;
        }
        // 其他原因的 rename 失败（如瞬时权限问题）不视为致命，退回等待重试
      }
    }

    if (Date.now() > deadline) {
      throw new Error(
        `Failed to acquire registry lock '${lockDir}' within ${REGISTRY_LOCK_ACQUIRE_TIMEOUT_MS}ms. ` +
          `The lock may be held by another ActionDock process; retry after it exits or remove the stale lock directory manually.`
      );
    }

    await sleep(REGISTRY_LOCK_RETRY_DELAY_MS);
  }

  try {
    return await fn();
  } finally {
    try {
      await rm(lockDir, { recursive: true, force: true });
    } catch {
      // 释放失败可忽略：进程未清理的锁目录会随时间超过 stale 阈值，
      // 被后续获取方的原子 rename 抢占回收，不会造成永久死锁
    }
  }
}
