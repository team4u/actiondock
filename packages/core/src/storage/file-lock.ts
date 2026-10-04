import { randomUUID } from "node:crypto";
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

const defaultClock: Clock = new SystemClock();

export const DEFAULT_FILE_LOCK_STALE_MS = 10000;
export const DEFAULT_FILE_LOCK_ACQUIRE_TIMEOUT_MS = 15000;
export const DEFAULT_FILE_LOCK_RETRY_DELAY_MS = 25;
export const DEFAULT_FILE_LOCK_HEARTBEAT_MS = 3000;
export const LOCK_METADATA_FILE = "metadata.json";

export interface FileLockMetadata {
  pid: number;
  token: string;
  createdAt: string;
  sessionToken?: string;
  lockToken?: string;
  [key: string]: unknown;
}

export interface FileLockOptions {
  staleMs?: number;
  acquireTimeoutMs?: number;
  retryDelayMs?: number;
  heartbeatMs?: number;
  metadata?: Record<string, unknown>;
  mtimeFirst?: boolean;
  createLockError?: (message: string) => Error;
  assertHolderReclaimable?: (metadata: FileLockMetadata) => void;
  clock?: Clock;
}

export interface FileLockHandle {
  lockPath: string;
  metadata: FileLockMetadata;
  release(): void | Promise<void>;
}

const activeLockPaths = new Set<string>();

export interface LockDriver<T> {
  mkdir(path: string, options?: { mode?: number; recursive?: boolean }): T;
  rmdir(path: string, options?: { recursive?: boolean; force?: boolean }): T;
  readFile(path: string, encoding: "utf-8"): T;
  writeFile(path: string, data: string, options?: { mode?: number }): T;
  rename(oldPath: string, newPath: string): T;
  stat(path: string): T;
  unlink(path: string): T;
  delay(ms: number): T;
  timeExceeded(deadline: number): boolean;
  setInterval?(fn: () => void, ms: number): NodeJS.Timeout;
}

export const syncLockDriver: LockDriver<any> = {
  mkdir: (path, opts) => mkdirSync(path, opts),
  rmdir: (path, opts) => rmSync(path, opts as any),
  readFile: (path, enc) => readFileSync(path, enc),
  writeFile: (path, data, opts) => writeFileSync(path, data, opts),
  rename: (oldPath, newPath) => renameSync(oldPath, newPath),
  stat: (path) => statSync(path),
  unlink: (path) => rmSync(path, { force: true }),
  delay: () => {},
  timeExceeded: () => false,
};

export const asyncLockDriver: LockDriver<Promise<any>> = {
  mkdir: (path, opts) => mkdir(path, opts),
  rmdir: (path, opts) => rm(path, opts as any),
  readFile: (path, enc) => readFile(path, enc),
  writeFile: (path, data, opts) => writeFile(path, data, opts),
  rename: (oldPath, newPath) => rename(oldPath, newPath),
  stat: (path) => stat(path),
  unlink: (path) => rm(path, { force: true }),
  delay: (ms) => new Promise(resolve => setTimeout(resolve, ms)),
  timeExceeded: (deadline) => Date.now() >= deadline,
  setInterval: (fn, ms) => setInterval(fn, ms),
};

export function runSync<T>(driver: LockDriver<any>, machine: Generator<any, T, any>): T {
  let result = machine.next();
  while (!result.done) {
    try {
      const value = result.value(driver);
      result = machine.next(value);
    } catch (err) {
      result = machine.throw(err);
    }
  }
  return result.value;
}

export async function runAsync<T>(driver: LockDriver<Promise<any>>, machine: Generator<any, T, any>): Promise<T> {
  let result = machine.next();
  while (!result.done) {
    try {
      const value = await result.value(driver);
      result = machine.next(value);
    } catch (err) {
      result = machine.throw(err);
    }
  }
  return result.value;
}

function* readLockMetadataMachine(lockPath: string): Generator<any, FileLockMetadata | undefined, any> {
  let isDir = false;
  try {
    const s = yield (d: LockDriver<any>) => d.stat(lockPath);
    isDir = s.isDirectory();
  } catch {
    return undefined;
  }
  const targetFile = isDir ? join(lockPath, LOCK_METADATA_FILE) : lockPath;
  try {
    const raw = yield (d: LockDriver<any>) => d.readFile(targetFile, "utf-8");
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object") {
      return parsed as FileLockMetadata;
    }
  } catch {
    // 忽略异常
  }
  return undefined;
}

export async function readLockMetadata(lockPath: string): Promise<FileLockMetadata | undefined> {
  return runAsync(asyncLockDriver, readLockMetadataMachine(lockPath));
}

export function readLockMetadataSync(lockPath: string): FileLockMetadata | undefined {
  return runSync(syncLockDriver, readLockMetadataMachine(lockPath));
}

function* checkIsStaleLock(lockPath: string, staleMs: number, options: FileLockOptions | undefined, clock: Clock): Generator<any, boolean, any> {
  const effectiveClock = options?.clock ?? clock;
  let lockAgeMs: number;
  try {
    const s = yield (d: LockDriver<any>) => d.stat(lockPath);
    lockAgeMs = effectiveClock.now().getTime() - s.mtimeMs;
  } catch (err: any) {
    throw err;
  }

  if (options?.mtimeFirst && lockAgeMs <= staleMs) {
    return false;
  }

  const metadata = yield* readLockMetadataMachine(lockPath);

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

export async function isStaleLock(
  lockPath: string,
  staleMs: number = DEFAULT_FILE_LOCK_STALE_MS,
  options?: FileLockOptions,
  clock?: Clock
): Promise<boolean> {
  return runAsync(asyncLockDriver, checkIsStaleLock(lockPath, staleMs, options, clock ?? defaultClock));
}

export function isStaleLockSync(
  lockPath: string,
  staleMs: number = DEFAULT_FILE_LOCK_STALE_MS,
  options?: FileLockOptions,
  clock?: Clock
): boolean {
  return runSync(syncLockDriver, checkIsStaleLock(lockPath, staleMs, options, clock ?? defaultClock));
}

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

function* safeReleaseMachine(lockPath: string, expectedToken?: string, expectedSessionToken?: string): Generator<any, void, any> {
  try {
    const meta = yield* readLockMetadataMachine(lockPath);
    if (meta) {
      if (expectedSessionToken && meta.sessionToken && meta.sessionToken !== expectedSessionToken) return;
      if (expectedToken && meta.token && meta.token !== expectedToken) return;
    }
    yield (d: LockDriver<any>) => d.rmdir(lockPath, { recursive: true, force: true });
  } catch {
    // 忽略释放异常
  }
}

export async function safeReleaseFileLock(
  lockPath: string,
  expectedToken?: string,
  expectedSessionToken?: string
): Promise<void> {
  return runAsync(asyncLockDriver, safeReleaseMachine(lockPath, expectedToken, expectedSessionToken));
}

export function safeReleaseFileLockSync(
  lockPath: string,
  expectedToken?: string,
  expectedSessionToken?: string
): void {
  return runSync(syncLockDriver, safeReleaseMachine(lockPath, expectedToken, expectedSessionToken));
}

function* checkIsReclaimGuardActive(reclaimPath: string, staleMs: number, clock: Clock): Generator<any, boolean, any> {
  try {
    const raw = yield (d: LockDriver<any>) => d.readFile(join(reclaimPath, "reclaim.json"), "utf-8");
    const meta = JSON.parse(raw);
    if (typeof meta.pid === "number") {
      const age = clock.now().getTime() - (meta.createdAt ?? 0);
      if (age < staleMs && isProcessAlive(meta.pid)) return true;
    }
  } catch {}
  try {
    const s = yield (d: LockDriver<any>) => d.stat(reclaimPath);
    return clock.now().getTime() - s.mtimeMs < staleMs;
  } catch {
    return false;
  }
}

function* tryAcquireReclaimGuard(reclaimPath: string, staleMs: number, clock: Clock): Generator<any, boolean, any> {
  try {
    yield (d: LockDriver<any>) => d.mkdir(reclaimPath, { mode: 0o700 });
    yield (d: LockDriver<any>) => d.writeFile(
      join(reclaimPath, "reclaim.json"),
      JSON.stringify({ pid: process.pid, createdAt: clock.now().getTime() }),
      { mode: 0o600 }
    );
    return true;
  } catch (err: any) {
    if (err.code !== "EEXIST") throw err;
  }

  const active = yield* checkIsReclaimGuardActive(reclaimPath, staleMs, clock);
  if (!active) {
    try {
      yield (d: LockDriver<any>) => d.rmdir(reclaimPath, { recursive: true, force: true });
      yield (d: LockDriver<any>) => d.mkdir(reclaimPath, { mode: 0o700 });
      yield (d: LockDriver<any>) => d.writeFile(
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

function* acquireLockMachine(
  lockPath: string,
  options: FileLockOptions | undefined,
  isAsync: boolean
): Generator<any, FileLockHandle, any> {
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
    yield (d: LockDriver<any>) => d.mkdir(parentDir, { recursive: true });
  } catch {}

  let token = "";
  let metadata: FileLockMetadata | undefined;
  let reclaimMetadataWritten = false;

  let acquired = false;
  while (!acquired) {
    const guardActive = yield* checkIsReclaimGuardActive(reclaimPath, staleMs, clock);
    if (guardActive) {
      if (!isAsync) {
        if (options?.createLockError) {
          throw options.createLockError(`Lock '${lockPath}' is currently being reclaimed by another active process`);
        }
        throw new ActionDockError(STORAGE_BUSY, `Lock '${lockPath}' is currently being reclaimed by another active process`);
      }
    } else {
      try {
        yield (d: LockDriver<any>) => d.mkdir(lockPath, { mode: 0o700 });
        activeLockPaths.add(resolvedPath);
        acquired = true;
      } catch (err: any) {
        if (err.code !== "EEXIST") {
          throw err;
        }
      }
    }

    if (!acquired) {
      let stale = false;
      try {
        stale = yield* checkIsStaleLock(lockPath, staleMs, options, clock);
      } catch (err: any) {
        if (err.code !== "ENOENT") throw err;
      }

      if (stale) {
        const guardAcquired = yield* tryAcquireReclaimGuard(reclaimPath, staleMs, clock);
        if (!guardAcquired) {
          if (!isAsync) {
            if (options?.createLockError) {
              throw options.createLockError(`Lock '${lockPath}' is currently held by another active process`);
            }
            throw new ActionDockError(STORAGE_BUSY, `Lock '${lockPath}' is currently held by another active process`);
          }
        } else {
          try {
            let stillStale = false;
            try {
              stillStale = yield* checkIsStaleLock(lockPath, staleMs, options, clock);
            } catch (err: any) {
              if (err.code === "ENOENT") stillStale = true;
              else throw err;
            }

            if (!stillStale) {
              if (options?.createLockError) {
                throw options.createLockError(`Lock '${lockPath}' is currently held by another active process`);
              }
              throw new ActionDockError(STORAGE_BUSY, `Lock '${lockPath}' is currently held by another active process`);
            }

            let isDir = false;
            try {
              const s = yield (d: LockDriver<any>) => d.stat(lockPath);
              isDir = s.isDirectory();
            } catch {}

            if (!isDir) {
              try {
                yield (d: LockDriver<any>) => d.unlink(lockPath);
              } catch {}
              try {
                yield (d: LockDriver<any>) => d.mkdir(lockPath, { mode: 0o700 });
              } catch (err: any) {
                if (err.code !== "EEXIST") throw err;
              }
            }

            // 在接管守卫独占保护下写入并核验元数据，杜绝外部并发读取到残余陈旧元数据
            token = randomUUID();
            metadata = {
              pid: process.pid,
              createdAt: clock.now().toISOString(),
              ...options?.metadata,
              token,
            };

            const metaPath = join(lockPath, LOCK_METADATA_FILE);
            const tmpPath = join(lockPath, `meta.tmp.${process.pid}.${randomUUID().slice(0, 8)}`);
            yield (d: LockDriver<any>) => d.writeFile(tmpPath, JSON.stringify(metadata, null, 2), { mode: 0o600 });
            yield (d: LockDriver<any>) => d.rename(tmpPath, metaPath);

            const raw = yield (d: LockDriver<any>) => d.readFile(metaPath, "utf-8");
            const verify = JSON.parse(raw);
            if (verify?.token !== token) {
              if (options?.createLockError) {
                throw options.createLockError(`Failed to verify acquired lock ownership in '${lockPath}'`);
              }
              throw new ActionDockError(STORAGE_BUSY, `Failed to verify acquired lock ownership in '${lockPath}'`);
            }

            activeLockPaths.add(resolvedPath);
            acquired = true;
            reclaimMetadataWritten = true;
          } finally {
            try {
              yield (d: LockDriver<any>) => d.rmdir(reclaimPath, { recursive: true, force: true });
            } catch {}
          }
        }
      }
    }

    if (!acquired) {
      if (isAsync) {
        const exceeded = clock.monotonic() >= deadline;
        if (exceeded) {
          if (options?.createLockError) {
            throw options.createLockError(`Failed to acquire lock '${lockPath}' within ${acquireTimeoutMs}ms`);
          }
          throw new ActionDockError(TIMEOUT, `Failed to acquire lock '${lockPath}' within ${acquireTimeoutMs}ms`);
        }
        yield () => clock.sleep(retryDelayMs);
      } else {
        if (options?.createLockError) {
          throw options.createLockError(`Lock '${lockPath}' is currently held by another active process`);
        }
        throw new ActionDockError(STORAGE_BUSY, `Lock '${lockPath}' is currently held by another active process`);
      }
    }
  }

  if (!reclaimMetadataWritten) {
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
      yield (d: LockDriver<any>) => d.writeFile(tmpPath, JSON.stringify(metadata, null, 2), { mode: 0o600 });
      yield (d: LockDriver<any>) => d.rename(tmpPath, metaPath);

      const raw = yield (d: LockDriver<any>) => d.readFile(metaPath, "utf-8");
      const verify = JSON.parse(raw);
      if (verify?.token !== token) {
        throw new Error("Lock metadata verification failed");
      }
    } catch (err) {
      activeLockPaths.delete(resolvedPath);
      try {
        yield (d: LockDriver<any>) => d.rmdir(lockPath, { recursive: true, force: true });
      } catch {}

      if (options?.createLockError) {
        throw options.createLockError(`Failed to write or verify lock metadata for '${lockPath}'`);
      }
      throw new ActionDockError(STORAGE_BUSY, `Failed to write or verify lock metadata for '${lockPath}'`);
    }
  }

  let timer: NodeJS.Timeout | undefined;
  if (isAsync && heartbeatMs > 0) {
    timer = yield (d: LockDriver<any>) => {
      if (d.setInterval) {
        return d.setInterval(() => {
          const now = clock.now();
          utimes(lockPath, now, now).catch(() => {});
        }, heartbeatMs);
      }
    };
    if (timer?.unref) {
      timer.unref();
    }
  }

  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    if (timer) {
      clearInterval(timer);
    }
    activeLockPaths.delete(resolvedPath);
  };

  return {
    lockPath,
    metadata: metadata!,
    release,
  };
}

export function acquireFileLockSync(
  lockPath: string,
  options?: FileLockOptions
): FileLockHandle {
  const handle = runSync(syncLockDriver, acquireLockMachine(lockPath, options, false));
  const origRelease = handle.release;
  handle.release = () => {
    origRelease();
    safeReleaseFileLockSync(lockPath, handle.metadata.token, handle.metadata.sessionToken);
  };
  return handle;
}

export async function acquireFileLock(
  lockPath: string,
  options?: FileLockOptions
): Promise<FileLockHandle> {
  const handle = await runAsync(asyncLockDriver, acquireLockMachine(lockPath, options, true));
  const origRelease = handle.release;
  handle.release = async () => {
    origRelease();
    await safeReleaseFileLock(lockPath, handle.metadata.token, handle.metadata.sessionToken);
  };
  return handle;
}

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
