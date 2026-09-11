import { closeSync, existsSync, mkdirSync, openSync, readFileSync, unlinkSync, writeFileSync, writeSync } from "node:fs";
import { hostname } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

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
  /** 创建时间戳（ISO 8601 格式） */
  createdAt: string;
  /** 关联存活的受管子进程列表 */
  childPids?: number[];
  /** 宿主会话标识 */
  hostSessionId?: string;
}

/**
 * 检查目标进程是否处于存活状态。
 *
 * @param pid 待检测的进程标识符
 */
export function isProcessAlive(pid: number): boolean {
  if (typeof pid !== "number" || isNaN(pid) || pid <= 0) {
    return false;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch (err: any) {
    return Boolean(err && err.code === "EPERM");
  }
}

/**
 * 数据目录排他文件锁管理器。
 * 负责在数据目录下维护 .actiondock.data.lock 排他文件锁，记录宿主进程与子进程运行状态，
 * 防止多个无协调宿主并发冲突，并在非正常退出时提供故障恢复检测。
 */
export class DataDirLock {
  private readonly lockFilePath: string;
  private readonly info: DataDirLockInfo;
  private released = false;

  constructor(lockFilePath: string, info: DataDirLockInfo) {
    this.lockFilePath = lockFilePath;
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
   */
  private flush(): void {
    try {
      writeFileSync(this.lockFilePath, JSON.stringify(this.info, null, 2), { mode: 0o600 });
    } catch {
      // 忽略刷新写入异常
    }
  }

  /**
   * 释放排他锁并移除锁文件。
   */
  release(): void {
    if (this.released) return;
    this.released = true;
    try {
      if (existsSync(this.lockFilePath)) {
        const raw = readFileSync(this.lockFilePath, "utf8");
        const onDisk = JSON.parse(raw) as DataDirLockInfo;
        if (onDisk && onDisk.sessionToken === this.info.sessionToken) {
          unlinkSync(this.lockFilePath);
        }
      }
    } catch {
      // 忽略文件读取与解绑异常
    }
  }

  /**
   * 尝试获取指定数据目录的排他锁。
   *
   * 仲裁规则：
   * - 若锁文件不存在，原子创建写入并持有锁。
   * - 若锁文件已存在（openSync 捕获 EEXIST），解析持有者进程状态：
   *   - 若主进程仍处于存活状态，抛出 DATA_DIR_IN_USE 错误拒绝并发启动。
   *   - 若主进程已退出但仍有子进程存活，抛出 DATA_DIR_RECOVERY_REQUIRED 错误。
   *   - 若主进程与所有子进程均已退出，允许接管覆盖锁并清理残留旧会话。
   *
   * @param dataDir 目标数据存储目录物理绝对路径
   * @param options 锁配置参数
   */
  static acquire(
    dataDir: string,
    options: { sessionToken?: string; hostSessionId?: string } = {}
  ): DataDirLock {
    if (!existsSync(dataDir)) {
      mkdirSync(dataDir, { recursive: true, mode: 0o700 });
    }

    const lockFilePath = join(dataDir, ".actiondock.data.lock");
    const currentPid = process.pid;
    const currentHost = hostname();
    const token = options.sessionToken || randomUUID();
    const newLockInfo: DataDirLockInfo = {
      pid: currentPid,
      hostname: currentHost,
      sessionToken: token,
      createdAt: new Date().toISOString(),
      childPids: [],
      hostSessionId: options.hostSessionId,
    };
    const content = JSON.stringify(newLockInfo, null, 2);

    try {
      const fd = openSync(lockFilePath, "wx", 0o600);
      try {
        writeSync(fd, content);
      } finally {
        closeSync(fd);
      }
      return new DataDirLock(lockFilePath, newLockInfo);
    } catch (err: any) {
      if (err && err.code === "EEXIST") {
        let existing: DataDirLockInfo | undefined;
        try {
          const raw = readFileSync(lockFilePath, "utf8");
          existing = JSON.parse(raw) as DataDirLockInfo;
        } catch {
          // 损坏的锁文件视为待接管或直接覆盖
        }

        if (existing && typeof existing.pid === "number") {
          const parentAlive = isProcessAlive(existing.pid);

          if (parentAlive) {
            const inUseErr: any = new Error(
              `DATA_DIR_IN_USE: Data directory '${dataDir}' is in use by another active Host process (PID ${existing.pid})`
            );
            inUseErr.code = "DATA_DIR_IN_USE";
            throw inUseErr;
          }

          // 主进程已死亡，检查关联子进程存活状态
          const activeChildren = (existing.childPids || []).filter((childPid) =>
            isProcessAlive(childPid)
          );

          if (activeChildren.length > 0) {
            const recoveryErr: any = new Error(
              `DATA_DIR_RECOVERY_REQUIRED: Data directory recovery required for '${dataDir}': previous host (PID ${existing.pid}) exited but child processes (${activeChildren.join(
                ", "
              )}) are still running`
            );
            recoveryErr.code = "DATA_DIR_RECOVERY_REQUIRED";
            throw recoveryErr;
          }
        }

        // 主进程与所有子进程均已退出（或损坏的锁文件），接管覆盖
        writeFileSync(lockFilePath, content, { mode: 0o600 });
        return new DataDirLock(lockFilePath, newLockInfo);
      }
      throw err;
    }
  }
}
