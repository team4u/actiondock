import { existsSync, mkdirSync, renameSync, statSync, writeFileSync } from "node:fs";
import { hostname } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { DATA_DIR_IN_USE, DATA_DIR_RECOVERY_REQUIRED } from "../errors";
import { isProcessAlive } from "../utils";
import {
  acquireFileLockSync,
  safeReleaseFileLockSync,
  type FileLockHandle,
} from "./file-lock";

/**
 * 数据目录排他锁元数据契约。
 */
export interface DataDirLockInfo {
  /** 持有锁的宿主进程标识符 */
  pid: number;
  /** 宿主主机名 */
  hostname: string;
  /** 宿主会话令牌 */
  sessionToken: string;
  /** 内部排他锁令牌 */
  lockToken?: string;
  /** 创建时间戳（ISO 8601 格式） */
  createdAt: string;
  /** 关联存活的受管子进程列表 */
  childPids?: number[];
  /** 宿主会话标识 */
  hostSessionId?: string;
}

const LOCK_DIR_NAME = ".actiondock.data.lock";

export { isProcessAlive };

/**
 * 安全释放主锁（兼容导出）。
 */
export function safeReleaseLock(
  lockPath: string,
  expectedSessionToken?: string,
  expectedLockToken?: string
): void {
  safeReleaseFileLockSync(lockPath, expectedLockToken, expectedSessionToken);
}

/**
 * 历史机制向后兼容空桩。
 */
export function cleanStaleQuarantines(): void {}
export function safeRemoveStaleReclaimGuard(): void {}
export function safeRollbackLock(): void {}
export function parseQuarantineTimestamp(): { operatorPid?: number; timestamp?: number } {
  return {};
}

/**
 * 数据目录排他文件锁管理器。
 * 负责在数据目录下维护 .actiondock.data.lock 排他文件锁，记录宿主进程与子进程运行状态，
 * 防止多个无协调宿主并发冲突，并在非正常退出时提供故障恢复检测。
 */
export class DataDirLock {
  private readonly lockDirPath: string;
  private readonly info: DataDirLockInfo;
  private readonly handle?: FileLockHandle;
  private released = false;

  constructor(lockDirPath: string, info: DataDirLockInfo, handle?: FileLockHandle) {
    this.lockDirPath = lockDirPath;
    this.info = info;
    this.handle = handle;
  }

  /**
   * 获取当前排他锁元数据信息。
   */
  get lockInfo(): DataDirLockInfo {
    return this.info;
  }

  /**
   * 检查当前锁是否已被释放。
   */
  get isReleased(): boolean {
    return this.released;
  }

  /**
   * 登记受管子进程标识符。
   */
  registerChildPid(pid: number): void {
    if (this.released) return;
    if (!this.info.childPids) {
      this.info.childPids = [];
    }
    if (!this.info.childPids.includes(pid)) {
      this.info.childPids.push(pid);
      this.flush();
    }
  }

  /**
   * 注销受管子进程标识符。
   */
  unregisterChildPid(pid: number): void {
    if (this.released) return;
    if (this.info.childPids) {
      this.info.childPids = this.info.childPids.filter((p) => p !== pid);
      this.flush();
    }
  }

  /**
   * 将当前锁元数据刷新持久化至磁盘文件。
   */
  private flush(): void {
    try {
      let isDir = false;
      try {
        isDir = existsSync(this.lockDirPath) && statSync(this.lockDirPath).isDirectory();
      } catch {
        isDir = false;
      }

      const content = JSON.stringify(this.info, null, 2);
      if (isDir) {
        const metaPath = join(this.lockDirPath, "metadata.json");
        const tmpPath = join(
          this.lockDirPath,
          `metadata.json.tmp.${process.pid}.${randomUUID().slice(0, 8)}`
        );
        writeFileSync(tmpPath, content, { mode: 0o600 });
        renameSync(tmpPath, metaPath);
      } else {
        // 兼容单文件模式
        const tmpPath = `${this.lockDirPath}.tmp.${process.pid}.${randomUUID().slice(0, 8)}`;
        writeFileSync(tmpPath, content, { mode: 0o600 });
        renameSync(tmpPath, this.lockDirPath);
      }
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      console.warn(
        `[actiondock] data dir lock metadata flush failed (lock='${this.lockDirPath}'): ${reason}`
      );
    }
  }

  /**
   * 释放排他锁并移除锁目录或文件。
   */
  release(): void {
    if (this.released) return;
    this.released = true;
    if (this.handle) {
      this.handle.release();
    } else {
      safeReleaseFileLockSync(this.lockDirPath, this.info.lockToken, this.info.sessionToken);
    }
  }

  /**
   * 获取指定数据目录的排他锁。
   * 基于统一轻量文件锁原语实现，非阻塞且支持原子抢占与崩溃恢复。
   *
   * @param dataDir 目标数据存储目录物理绝对路径
   * @param options 锁配置参数
   */
  static acquire(
    dataDir: string,
    options: { sessionToken?: string; hostSessionId?: string; acquireTimeoutMs?: number } = {}
  ): DataDirLock {
    if (!existsSync(dataDir)) {
      mkdirSync(dataDir, { recursive: true, mode: 0o700 });
    }

    const lockDirPath = join(dataDir, LOCK_DIR_NAME);
    const token = options.sessionToken || randomUUID();
    const lockToken = randomUUID();
    const newLockInfo: DataDirLockInfo = {
      pid: process.pid,
      hostname: hostname(),
      sessionToken: token,
      lockToken,
      createdAt: new Date().toISOString(),
      childPids: [],
      hostSessionId: options.hostSessionId,
    };

    const handle = acquireFileLockSync(lockDirPath, {
      metadata: newLockInfo as any,
      createLockError() {
        const inUseErr: any = new Error(
          `DATA_DIR_IN_USE: Data directory '${dataDir}' is in use by another active Host process`
        );
        inUseErr.code = DATA_DIR_IN_USE;
        return inUseErr;
      },
      assertHolderReclaimable(info) {
        const holderPid = info.pid as number | undefined;
        if (holderPid && isProcessAlive(holderPid)) {
          const inUseErr: any = new Error(
            `DATA_DIR_IN_USE: Data directory '${dataDir}' is in use by another active Host process (PID ${holderPid})`
          );
          inUseErr.code = DATA_DIR_IN_USE;
          throw inUseErr;
        }

        const activeChildren = (info.childPids as number[] | undefined)?.filter((childPid) => isProcessAlive(childPid)) ?? [];
        if (activeChildren.length > 0) {
          const recoveryErr: any = new Error(
            `DATA_DIR_RECOVERY_REQUIRED: Data directory recovery required for '${dataDir}': previous host (PID ${holderPid ?? "unknown"}) exited but child processes (${activeChildren.join(
              ", "
            )}) are still running`
          );
          recoveryErr.code = DATA_DIR_RECOVERY_REQUIRED;
          throw recoveryErr;
        }
      },
    });

    return new DataDirLock(lockDirPath, newLockInfo, handle);
  }
}
