import { withFileLock, type FileLockOptions } from "../storage/file-lock";

/**
 * 锁目录最近一次心跳（创建或续期）后超过该时长且持有进程已死亡，
 * 才视为持有进程异常退出的残留锁。
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

/**
 * 持锁期间的心跳续期间隔。持有者定期 touch 锁目录刷新 mtime，
 * 使长耗时持锁操作不会仅因耗时超过 stale 阈值而被等待方误判为残留锁抢占。
 */
export const REGISTRY_LOCK_HEARTBEAT_MS = 3000;

/**
 * 锁配置选项。
 */
export interface RegistryLockOptions {
  staleMs?: number;
  acquireTimeoutMs?: number;
  retryDelayMs?: number;
  heartbeatMs?: number;
}

/**
 * 异步注册表锁（防止多进程并发读写导致 registry.json 损坏）。
 * 基于统一轻量文件锁原语实现。
 *
 * @param filePath 注册表文件路径，锁目录为其同级 `${filePath}.lock`
 * @param fn 持锁期间执行的操作（同步或异步）
 * @param options 可选锁超时与重试配置
 * @returns fn 的返回值
 * @throws 超过 acquireTimeoutMs 仍未获取时抛出描述性错误
 */
export async function withRegistryLock<T>(
  filePath: string,
  fn: () => T | Promise<T>,
  options?: RegistryLockOptions
): Promise<T> {
  const lockDir = `${filePath}.lock`;
  const acquireTimeoutMs = options?.acquireTimeoutMs ?? REGISTRY_LOCK_ACQUIRE_TIMEOUT_MS;

  const lockOptions: FileLockOptions = {
    staleMs: options?.staleMs ?? REGISTRY_LOCK_STALE_MS,
    acquireTimeoutMs,
    retryDelayMs: options?.retryDelayMs ?? REGISTRY_LOCK_RETRY_DELAY_MS,
    heartbeatMs: options?.heartbeatMs ?? REGISTRY_LOCK_HEARTBEAT_MS,
    mtimeFirst: true,
    createLockError: () =>
      new Error(
        `Failed to acquire registry lock '${lockDir}' within ${acquireTimeoutMs}ms. ` +
          `The lock may be held by another ActionDock process; retry after it exits or remove the stale lock directory manually.`
      ),
  };

  return await withFileLock(lockDir, fn, lockOptions);
}
