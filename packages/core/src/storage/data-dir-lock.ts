import { existsSync, mkdirSync, renameSync, statSync, writeFileSync } from "node:fs";
import { hostname } from "node:os";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import { DATA_DIR_IN_USE, DATA_DIR_RECOVERY_REQUIRED } from "../errors";
import {
  acquireDirectoryLock,
  cleanStaleQuarantines,
  isProcessAlive,
  parseQuarantineTimestamp,
  safeReleaseLock as coreSafeReleaseLock,
  safeRemoveStaleReclaimGuard,
  safeRollbackLock,
} from "./lock-core";

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
  /** 内部排他锁令牌（用于防护伪造 sessionToken 的所有权隔离） */
  lockToken?: string;
  /** 创建时间戳（ISO 8601 格式） */
  createdAt: string;
  /** 关联存活的受管子进程列表 */
  childPids?: number[];
  /** 宿主会话标识 */
  hostSessionId?: string;
}

const LOCK_DIR_NAME = ".actiondock.data.lock";

export {
  isProcessAlive,
  parseQuarantineTimestamp,
  cleanStaleQuarantines,
  safeRemoveStaleReclaimGuard,
  safeRollbackLock,
};

/**
 * 安全释放主锁。
 * 仅当锁目录中持有当前 lockToken / sessionToken 时才删除，杜绝删除他人新锁。
 */
export function safeReleaseLock(
  lockPath: string,
  expectedSessionToken: string,
  expectedLockToken?: string
): void {
  coreSafeReleaseLock(lockPath, expectedSessionToken, expectedLockToken);
}

/**
 * 数据目录排他文件锁管理器。
 * 负责在数据目录下维护 .actiondock.data.lock 排他文件锁，记录宿主进程与子进程运行状态，
 * 防止多个无协调宿主并发冲突，并在非正常退出时提供故障恢复检测。
 */
export class DataDirLock {
  private readonly lockDirPath: string;
  private readonly info: DataDirLockInfo;
  private released = false;

  constructor(lockDirPath: string, info: DataDirLockInfo) {
    this.lockDirPath = lockDirPath;
    this.info = info;
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
   * 先写入临时文件再通过 renameSync 原子替换，消除 truncate 空文件窗口。
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
    } catch {
      // 忽略刷新写入异常
    }
  }

  /**
   * 释放排他锁并移除锁目录或文件。
   */
  release(): void {
    if (this.released) return;
    this.released = true;
    coreSafeReleaseLock(this.lockDirPath, this.info.sessionToken, this.info.lockToken);
    cleanStaleQuarantines(dirname(this.lockDirPath), LOCK_DIR_NAME);
  }

  /**
   * 尝试获取指定数据目录的排他锁。
   *
   * 仲裁规则由目录锁内核（lock-core）统一承载：
   * - 引入所有竞争者均遵守的原子 reclaim guard 机制（lockDirPath.reclaim），每个 guard 具备全局唯一 guardToken。
   * - 基于原子目录创建 mkdirSync(lockDirPath, { mode: 0o700 }) 确立所有权，并在其下存放 metadata.json。
   * - 兼容已有常规文件锁（如老版本或测试 mock 场景）。
   * - 若检测到 reclaim guard 存在且处于宽限期内或持有者存活，必须等待，禁止抢先创建主锁。
   * - 若锁目录已存在，通过宽限期机制防止将并发写入中的元数据误判为锁死亡。
   * - 若主进程仍处于存活状态，抛出 DATA_DIR_IN_USE 错误拒绝并发启动。
   * - 若主进程已退出但仍有子进程存活，抛出 DATA_DIR_RECOVERY_REQUIRED 错误。
   * - 当识别到主锁为陈旧锁时，竞争者必须先原子竞争获取 reclaim guard。
   * - 仅成功获取 reclaim guard 的唯一胜利者获准执行：复核主锁陈旧性 -> 验证并清理陈旧主锁 -> 原子创建新主锁并写入自身元数据 -> 清理 reclaim guard。
   * - 竞争失败者等待并 continue 重试；若 reclaim guard 持有者意外崩溃，其他竞争者在超过宽限期且 PID 已死后通过 safeRemoveStaleReclaimGuard 核对 guardToken 并清理。
   * - 严禁在获取新主锁遇到 EEXIST 时盲目 rmSync；后检发现他人活跃 guard 时，仅通过 safeRollbackLock 核对自身 sessionToken 回滚自身锁。
   *
   * @param dataDir 目标数据存储目录物理绝对路径
   * @param options 锁配置参数
   */
  static acquire(
    dataDir: string,
    options: { sessionToken?: string; hostSessionId?: string; acquireTimeoutMs?: number } = {}
  ): DataDirLock {
    const timeoutMs = options.acquireTimeoutMs ?? 5000;
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
    const content = JSON.stringify(newLockInfo, null, 2);

    return acquireDirectoryLock({
      lockPath: lockDirPath,
      parentDir: dataDir,
      basePrefix: LOCK_DIR_NAME,
      metadataContent: content,
      sessionToken: token,
      lockToken,
      acquireTimeoutMs: options.acquireTimeoutMs,
      createLockError(message) {
        const timeoutErr: any = new Error(message);
        timeoutErr.code = DATA_DIR_IN_USE;
        return timeoutErr;
      },
      messages: {
        timeoutWaitingReclaimGuard: (holderPid?: number) =>
          `DATA_DIR_IN_USE: Timeout waiting for active reclaim guard (PID ${holderPid ?? "unknown"}) on data directory '${dataDir}' after ${timeoutMs}ms`,
        timeoutAcquireBlockedByGuard: (holderPid?: number) =>
          `DATA_DIR_IN_USE: Timeout acquiring lock on data directory '${dataDir}' due to active reclaim guard (PID ${holderPid}) after ${timeoutMs}ms`,
        timeoutAcquire: () =>
          `DATA_DIR_IN_USE: Timeout acquiring lock on data directory '${dataDir}' after ${timeoutMs}ms`,
        timeoutGracePeriod: () =>
          `DATA_DIR_IN_USE: Timeout waiting for lock grace period on data directory '${dataDir}' after ${timeoutMs}ms`,
        timeoutGuardContention: () =>
          `DATA_DIR_IN_USE: Timeout contending for reclaim guard on data directory '${dataDir}' after ${timeoutMs}ms`,
        timeoutReclaimStale: () =>
          `DATA_DIR_IN_USE: Timeout reclaiming stale lock on data directory '${dataDir}' after ${timeoutMs}ms`,
        timeoutCreate: () =>
          `DATA_DIR_IN_USE: Timeout creating primary lock on data directory '${dataDir}' after ${timeoutMs}ms`,
      },
      assertStaleHolderReclaimable(info) {
        const holderPid = info.pid as number;
        if (isProcessAlive(holderPid)) {
          const inUseErr: any = new Error(
            `DATA_DIR_IN_USE: Data directory '${dataDir}' is in use by another active Host process (PID ${holderPid})`
          );
          inUseErr.code = DATA_DIR_IN_USE;
          throw inUseErr;
        }

        // 主进程已死亡，检查关联子进程存活状态
        const activeChildren = (info.childPids || []).filter((childPid) => isProcessAlive(childPid));
        if (activeChildren.length > 0) {
          const recoveryErr: any = new Error(
            `DATA_DIR_RECOVERY_REQUIRED: Data directory recovery required for '${dataDir}': previous host (PID ${holderPid}) exited but child processes (${activeChildren.join(
              ", "
            )}) are still running`
          );
          recoveryErr.code = DATA_DIR_RECOVERY_REQUIRED;
          throw recoveryErr;
        }
      },
      onAcquired: () => new DataDirLock(lockDirPath, newLockInfo),
    });
  }
}
