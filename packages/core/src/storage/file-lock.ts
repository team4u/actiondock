import { randomUUID } from "node:crypto";
import type { Stats } from "node:fs";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { mkdir, readFile, rename, rm, stat, utimes, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { isProcessAlive } from "../utils";
import { type Clock, SystemClock } from "./clock";
import { ActionDockError, STORAGE_BUSY, TIMEOUT } from "../errors";

/** 模块级默认时钟实例 */
const defaultClock: Clock = new SystemClock();

/**
 * 默认锁超时与重试配置。
 */
export const DEFAULT_FILE_LOCK_STALE_MS = 10000;
export const DEFAULT_FILE_LOCK_ACQUIRE_TIMEOUT_MS = 15000;
export const DEFAULT_FILE_LOCK_RETRY_DELAY_MS = 25;
export const DEFAULT_FILE_LOCK_HEARTBEAT_MS = 3000;

export const LOCK_METADATA_FILE = "metadata.json";

/**
 * 文件锁持有者元数据契约。
 */
export interface FileLockMetadata {
  pid: number;
  token: string;
  createdAt: string;
  sessionToken?: string;
  lockToken?: string;
  [key: string]: unknown;
}

/**
 * 统一文件锁配置选项。
 */
export interface FileLockOptions {
  staleMs?: number;
  acquireTimeoutMs?: number;
  retryDelayMs?: number;
  heartbeatMs?: number;
  metadata?: Record<string, unknown>;
  /**
   * 是否优先校验 mtime 超龄（为 true 时若 mtime 未超龄一律不回收，即使 PID 已死）。
   * 注册表目录锁等需要避免超长持锁被抢占的场景开启此选项。
   */
  mtimeFirst?: boolean;
  createLockError?: (message: string) => Error;
  assertHolderReclaimable?: (metadata: FileLockMetadata) => void;
  clock?: Clock;
}

/**
 * 文件锁持有句柄。
 */
export interface FileLockHandle {
  lockPath: string;
  metadata: FileLockMetadata;
  release(): void | Promise<void>;
}

/**
 * 本进程当前活跃持有的锁路径集合（已规范化）。
 * 用于区分「同进程在途持锁」（不可回收）与「同进程历史泄漏锁」（可回收）。
 */
const activeLockPaths = new Set<string>();

/**
 * 读取锁元数据（异步）。
 */
export async function readLockMetadata(lockPath: string): Promise<FileLockMetadata | undefined> {
  let isDir = false;
  try {
    const s = await stat(lockPath);
    isDir = s.isDirectory();
  } catch {
    return undefined;
  }

  const targetFile = isDir ? join(lockPath, LOCK_METADATA_FILE) : lockPath;
  try {
    const raw = await readFile(targetFile, "utf-8");
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object") {
      return parsed as FileLockMetadata;
    }
  } catch {
    // 元数据不存在或损坏
  }
  return undefined;
}

/**
 * 读取锁元数据（同步）。
 */
export function readLockMetadataSync(lockPath: string): FileLockMetadata | undefined {
  let isDir = false;
  try {
    const s = statSync(lockPath);
    isDir = s.isDirectory();
  } catch {
    return undefined;
  }

  const targetFile = isDir ? join(lockPath, LOCK_METADATA_FILE) : lockPath;
  try {
    const raw = readFileSync(targetFile, "utf-8");
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object") {
      return parsed as FileLockMetadata;
    }
  } catch {
    // 元数据不存在或损坏
  }
  return undefined;
}

/**
 * 判定锁是否为可接管的陈旧锁（异步）。
 */
export async function isStaleLock(
  lockPath: string,
  staleMs: number = DEFAULT_FILE_LOCK_STALE_MS,
  options?: FileLockOptions,
  clock?: Clock
): Promise<boolean> {
  const effectiveClock = options?.clock ?? clock ?? defaultClock;
  let lockAgeMs: number;
  try {
    const s = await stat(lockPath);
    lockAgeMs = effectiveClock.now().getTime() - s.mtimeMs;
  } catch (err: any) {
    throw err;
  }

  if (options?.mtimeFirst && lockAgeMs <= staleMs) {
    return false;
  }

  const metadata = await readLockMetadata(lockPath);

  if (options?.assertHolderReclaimable && metadata) {
    options.assertHolderReclaimable(metadata);
  }

  if (metadata === undefined) {
    if (lockAgeMs <= staleMs) {
      return false;
    }
    return true;
  }

  if (typeof metadata.pid === "number") {
    if (metadata.pid === process.pid) {
      return !activeLockPaths.has(resolve(lockPath));
    }
    return !isProcessAlive(metadata.pid);
  }

  return lockAgeMs > staleMs;
}

/**
 * 判定锁是否为可接管的陈旧锁（同步）。
 */
export function isStaleLockSync(
  lockPath: string,
  staleMs: number = DEFAULT_FILE_LOCK_STALE_MS,
  options?: FileLockOptions,
  clock?: Clock
): boolean {
  const effectiveClock = options?.clock ?? clock ?? defaultClock;
  let lockAgeMs: number;
  try {
    const s = statSync(lockPath);
    lockAgeMs = effectiveClock.now().getTime() - s.mtimeMs;
  } catch (err: any) {
    throw err;
  }

  if (options?.mtimeFirst && lockAgeMs <= staleMs) {
    return false;
  }

  const metadata = readLockMetadataSync(lockPath);

  if (options?.assertHolderReclaimable && metadata) {
    options.assertHolderReclaimable(metadata);
  }

  if (metadata === undefined) {
    if (lockAgeMs <= staleMs) {
      return false;
    }
    return true;
  }

  if (typeof metadata.pid === "number") {
    if (metadata.pid === process.pid) {
      return !activeLockPaths.has(resolve(lockPath));
    }
    return !isProcessAlive(metadata.pid);
  }

  return lockAgeMs > staleMs;
}

/**
 * 检查指定锁路径是否当前被活跃进程持有。
 */
export function isLockHeld(lockPath: string, excludeSelf = true, clock?: Clock): boolean {
  if (!existsSync(lockPath)) return false;
  const effectiveClock = clock ?? defaultClock;
  try {
    const meta = readLockMetadataSync(lockPath);
    if (meta && typeof meta.pid === "number") {
      if (excludeSelf && meta.pid === process.pid) {
        return false;
      }
      return isProcessAlive(meta.pid);
    }
    const stat = statSync(lockPath);
    return effectiveClock.now().getTime() - stat.mtimeMs < DEFAULT_FILE_LOCK_STALE_MS;
  } catch {
    return false;
  }
}

/**
 * 同步释放锁文件或目录。
 * 核对持有者标识（token 或 sessionToken），防止误删并发新锁。
 */
export function safeReleaseFileLockSync(
  lockPath: string,
  expectedToken?: string,
  expectedSessionToken?: string
): void {
  try {
    if (!existsSync(lockPath)) return;
    const meta = readLockMetadataSync(lockPath);
    if (meta) {
      if (expectedSessionToken && meta.sessionToken && meta.sessionToken !== expectedSessionToken) {
        return;
      }
      if (expectedToken && meta.token && meta.token !== expectedToken) {
        return;
      }
    }
    rmSync(lockPath, { recursive: true, force: true });
  } catch {
    // 忽略释放异常
  }
}

/**
 * 异步释放锁文件或目录。
 * 核对持有者标识（token 或 sessionToken），防止误删并发新锁。
 */
export async function safeReleaseFileLock(
  lockPath: string,
  expectedToken?: string,
  expectedSessionToken?: string
): Promise<void> {
  try {
    const meta = await readLockMetadata(lockPath);
    if (meta) {
      if (expectedSessionToken && meta.sessionToken && meta.sessionToken !== expectedSessionToken) {
        return;
      }
      if (expectedToken && meta.token && meta.token !== expectedToken) {
        return;
      }
    }
    await rm(lockPath, { recursive: true, force: true });
  } catch {
    // 忽略释放异常
  }
}

/**
/**
 * 检查陈旧锁接管守卫是否处于活跃状态。
 */
function isReclaimGuardActive(
  reclaimPath: string,
  staleMs: number,
  clock: Clock
): boolean {
  if (!existsSync(reclaimPath)) return false;
  try {
    const raw = readFileSync(join(reclaimPath, "reclaim.json"), "utf-8");
    const meta = JSON.parse(raw);
    if (typeof meta.pid === "number") {
      const age = clock.now().getTime() - (meta.createdAt ?? 0);
      if (age < staleMs && isProcessAlive(meta.pid)) {
        return true;
      }
    }
  } catch {}
  try {
    const s = statSync(reclaimPath);
    return clock.now().getTime() - s.mtimeMs < staleMs;
  } catch {
    return false;
  }
}

/**
 * 尝试原子获取接管守卫目录。
 */
function tryAcquireReclaimGuardSync(
  reclaimPath: string,
  staleMs: number,
  clock: Clock
): boolean {
  try {
    mkdirSync(reclaimPath, { mode: 0o700 });
    writeFileSync(
      join(reclaimPath, "reclaim.json"),
      JSON.stringify({ pid: process.pid, createdAt: clock.now().getTime() }),
      { mode: 0o600 }
    );
    return true;
  } catch (err: any) {
    if (err.code !== "EEXIST") throw err;
  }

  // 守卫目录已存在，检查是否为崩溃遗留的残留守卫
  if (!isReclaimGuardActive(reclaimPath, staleMs, clock)) {
    try {
      rmSync(reclaimPath, { recursive: true, force: true });
      mkdirSync(reclaimPath, { mode: 0o700 });
      writeFileSync(
        join(reclaimPath, "reclaim.json"),
        JSON.stringify({ pid: process.pid, createdAt: clock.now().getTime() }),
        { mode: 0o600 }
      );
      return true;
    } catch {
      return false;
    }
  }
  return false;
}

/**
 * 安全释放接管守卫目录。
 */
function releaseReclaimGuardSync(reclaimPath: string): void {
  try {
    rmSync(reclaimPath, { recursive: true, force: true });
  } catch {}
}

/**
 * 同步非阻塞获取文件锁。
 *
 * 保证非阻塞：绝不使用 Atomics.wait 或忙等循环阻塞主线程。
 * 遇锁占用且持有者存活时立即抛出占用异常；
 * 遇陈旧锁时通过原子接管守卫互斥抢占并更新元数据。
 */
export function acquireFileLockSync(
  lockPath: string,
  options?: FileLockOptions
): FileLockHandle {
  const clock = options?.clock ?? defaultClock;
  const staleMs = options?.staleMs ?? DEFAULT_FILE_LOCK_STALE_MS;
  const parentDir = dirname(lockPath);
  if (!existsSync(parentDir)) {
    mkdirSync(parentDir, { recursive: true });
  }

  const resolvedPath = resolve(lockPath);
  const reclaimPath = `${lockPath}.reclaim`;
  let token = "";
  let metadata: FileLockMetadata | undefined;

  let acquired = false;
  while (!acquired) {
    if (isReclaimGuardActive(reclaimPath, staleMs, clock)) {
      if (options?.createLockError) {
        throw options.createLockError(`Lock '${lockPath}' is currently being reclaimed by another active process`);
      }
      throw new ActionDockError(STORAGE_BUSY, `Lock '${lockPath}' is currently being reclaimed by another active process`);
    }

    try {
      mkdirSync(lockPath, { mode: 0o700 });
      activeLockPaths.add(resolvedPath);
    } catch (err: any) {
      if (err.code !== "EEXIST") {
        throw err;
      }

      // 锁已存在:判定是否为可接管的陈旧锁
      let stale = false;
      try {
        stale = isStaleLockSync(lockPath, staleMs, options, clock);
      } catch (err: any) {
        if (err.code === "ENOENT") {
          continue;
        }
        throw err;
      }

      if (stale) {
        const guardAcquired = tryAcquireReclaimGuardSync(reclaimPath, staleMs, clock);
        if (!guardAcquired) {
          if (options?.createLockError) {
            throw options.createLockError(`Lock '${lockPath}' is currently held by another active process`);
          }
          throw new ActionDockError(STORAGE_BUSY, `Lock '${lockPath}' is currently held by another active process`);
        }

        try {
          // 接管前在守卫保护下二次确认锁状态
          let stillStale = false;
          try {
            stillStale = !existsSync(lockPath) || isStaleLockSync(lockPath, staleMs, options, clock);
          } catch (err: any) {
            if (err.code === "ENOENT") {
              stillStale = true;
            } else {
              throw err;
            }
          }

          if (!stillStale) {
            if (options?.createLockError) {
              throw options.createLockError(`Lock '${lockPath}' is currently held by another active process`);
            }
            throw new ActionDockError(STORAGE_BUSY, `Lock '${lockPath}' is currently held by another active process`);
          }

          let isDir = false;
          try {
            isDir = existsSync(lockPath) && statSync(lockPath).isDirectory();
          } catch {
            isDir = false;
          }

          if (existsSync(lockPath) && !isDir) {
            // 单文件陈旧锁：安全清理并转为目录锁结构
            rmSync(lockPath, { force: true });
            mkdirSync(lockPath, { mode: 0o700 });
          } else if (!existsSync(lockPath)) {
            mkdirSync(lockPath, { mode: 0o700 });
          }

          // 保持目录锁常驻，直接原子更新本方持有者元数据
          token = randomUUID();
          metadata = {
            pid: process.pid,
            createdAt: clock.now().toISOString(),
            ...options?.metadata,
            token,
          };

          const metaPath = join(lockPath, LOCK_METADATA_FILE);
          const tmpPath = join(lockPath, `meta.tmp.${process.pid}.${randomUUID().slice(0, 8)}`);
          writeFileSync(tmpPath, JSON.stringify(metadata, null, 2), { mode: 0o600 });
          renameSync(tmpPath, metaPath);

          const verify = readLockMetadataSync(lockPath);
          if (verify?.token !== token) {
            if (options?.createLockError) {
              throw options.createLockError(`Failed to verify acquired lock ownership in '${lockPath}'`);
            }
            throw new ActionDockError(STORAGE_BUSY, `Failed to verify acquired lock ownership in '${lockPath}'`);
          }

          activeLockPaths.add(resolvedPath);
          acquired = true;
          break;
        } finally {
          releaseReclaimGuardSync(reclaimPath);
        }
      }

      if (options?.createLockError) {
        throw options.createLockError(`Lock '${lockPath}' is currently held by another active process`);
      }
      throw new ActionDockError(STORAGE_BUSY, `Lock '${lockPath}' is currently held by another active process`);
    }

    // mkdir 成功,写入本方持锁元数据(token 永远由本方生成,禁止被外部 metadata 覆盖)
    token = randomUUID();
    metadata = {
      pid: process.pid,
      createdAt: clock.now().toISOString(),
      ...options?.metadata,
      token,
    };

    const metaPath = join(lockPath, LOCK_METADATA_FILE);
    const tmpPath = join(lockPath, `meta.tmp.${process.pid}.${randomUUID().slice(0, 8)}`);
    try {
      writeFileSync(tmpPath, JSON.stringify(metadata, null, 2), { mode: 0o600 });
      renameSync(tmpPath, metaPath);
    } catch (err) {
      activeLockPaths.delete(resolvedPath);
      throw err;
    }

    // 获取后自校验:回读元数据确认锁仍属于自己的令牌。
    try {
      const verify = readLockMetadataSync(lockPath);
      if (verify?.token !== token) {
        activeLockPaths.delete(resolvedPath);
        continue;
      }
    } catch {
      // 容忍临时读取异常
    }

    acquired = true;
  }

  let released = false;
  const release = (): void => {
    if (released) return;
    released = true;
    activeLockPaths.delete(resolvedPath);
    safeReleaseFileLockSync(
      lockPath,
      token,
      (options?.metadata?.sessionToken as string | undefined) ?? metadata!.sessionToken
    );
  };

  return {
    lockPath,
    metadata: metadata!,
    release,
  };
}

/**
 * 异步轻量文件锁获取。
 *
 * 保证非阻塞异步：基于 sleep 让出事件循环，心跳定期刷新 mtime。
 */
export async function acquireFileLock(
  lockPath: string,
  options?: FileLockOptions
): Promise<FileLockHandle> {
  const clock = options?.clock ?? defaultClock;
  const staleMs = options?.staleMs ?? DEFAULT_FILE_LOCK_STALE_MS;
  const acquireTimeoutMs = options?.acquireTimeoutMs ?? DEFAULT_FILE_LOCK_ACQUIRE_TIMEOUT_MS;
  const retryDelayMs = options?.retryDelayMs ?? DEFAULT_FILE_LOCK_RETRY_DELAY_MS;
  const heartbeatMs = options?.heartbeatMs ?? DEFAULT_FILE_LOCK_HEARTBEAT_MS;
  const deadline = clock.monotonic() + acquireTimeoutMs;

  const resolvedPath = resolve(lockPath);
  const reclaimPath = `${lockPath}.reclaim`;
  const parentDir = dirname(lockPath);
  try {
    await mkdir(parentDir, { recursive: true });
  } catch {}

  let token = "";
  let metadata: FileLockMetadata | undefined;

  while (true) {
    if (!isReclaimGuardActive(reclaimPath, staleMs, clock)) {
      try {
        await mkdir(lockPath, { mode: 0o700 });
        activeLockPaths.add(resolvedPath);
        break;
      } catch (err: any) {
        if (err.code !== "EEXIST") {
          throw err;
        }
      }
    }

    let stale = false;
    try {
      stale = await isStaleLock(lockPath, staleMs, options, clock);
    } catch (err: any) {
      if (err.code === "ENOENT") {
        continue;
      }
      throw err;
    }

    if (stale) {
      const guardAcquired = tryAcquireReclaimGuardSync(reclaimPath, staleMs, clock);
      if (guardAcquired) {
        try {
          let stillStale = false;
          try {
            stillStale = !existsSync(lockPath) || isStaleLockSync(lockPath, staleMs, options, clock);
          } catch (err: any) {
            if (err.code === "ENOENT") stillStale = true;
            else throw err;
          }

          if (stillStale) {
            let isDir = false;
            try {
              isDir = existsSync(lockPath) && statSync(lockPath).isDirectory();
            } catch {
              isDir = false;
            }

            if (existsSync(lockPath) && !isDir) {
              rmSync(lockPath, { force: true });
              mkdirSync(lockPath, { mode: 0o700 });
            } else if (!existsSync(lockPath)) {
              mkdirSync(lockPath, { mode: 0o700 });
            }

            token = randomUUID();
            metadata = {
              pid: process.pid,
              token,
              createdAt: clock.now().toISOString(),
              ...options?.metadata,
            };

            const metaPath = join(lockPath, LOCK_METADATA_FILE);
            const tmpPath = join(lockPath, `meta.tmp.${process.pid}.${randomUUID().slice(0, 8)}`);
            writeFileSync(tmpPath, JSON.stringify(metadata, null, 2), { mode: 0o600 });
            renameSync(tmpPath, metaPath);

            activeLockPaths.add(resolvedPath);
            break;
          }
        } finally {
          releaseReclaimGuardSync(reclaimPath);
        }
      }
    }

    if (clock.monotonic() >= deadline) {
      if (options?.createLockError) {
        throw options.createLockError(`Failed to acquire lock '${lockPath}' within ${acquireTimeoutMs}ms`);
      }
      throw new ActionDockError(TIMEOUT, `Failed to acquire lock '${lockPath}' within ${acquireTimeoutMs}ms`);
    }

    await clock.sleep(retryDelayMs);
  }

  if (!metadata) {
    token = randomUUID();
    metadata = {
      pid: process.pid,
      token,
      createdAt: clock.now().toISOString(),
      ...options?.metadata,
    };

    const metaPath = join(lockPath, LOCK_METADATA_FILE);
    const tmpPath = join(lockPath, `meta.tmp.${process.pid}.${randomUUID().slice(0, 8)}`);
    try {
      await writeFile(tmpPath, JSON.stringify(metadata, null, 2), { mode: 0o600 });
      await rename(tmpPath, metaPath);
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      console.warn(`[FileLock] Failed to write lock metadata in '${lockPath}': ${reason}`);
    }
  }

  let timer: NodeJS.Timeout | undefined;
  if (heartbeatMs > 0) {
    timer = setInterval(() => {
      const now = clock.now();
      utimes(lockPath, now, now).catch((err) => {
        const reason = err instanceof Error ? err.message : String(err);
        console.warn(`[FileLock] Failed to refresh lock heartbeat for '${lockPath}': ${reason}`);
      });
    }, heartbeatMs);
    timer.unref?.();
  }

  let released = false;
  const release = async (): Promise<void> => {
    if (released) return;
    released = true;
    if (timer) clearInterval(timer);
    activeLockPaths.delete(resolvedPath);
    await safeReleaseFileLock(
      lockPath,
      token,
      (options?.metadata?.sessionToken as string | undefined) ?? metadata.sessionToken
    );
  };

  return {
    lockPath,
    metadata,
    release,
  };
}

/**
 * 异步执行持锁业务操作并在完成后自动安全释放锁。
 */
export async function withFileLock<T>(
  lockPath: string,
  fn: () => T | Promise<T>,
  options?: FileLockOptions
): Promise<T> {
  const lock = await acquireFileLock(lockPath, options);
  try {
    return await fn();
  } finally {
    await lock.release();
  }
}
