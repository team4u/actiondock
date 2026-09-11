import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { hostname } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

/**
 * 同步休眠指定毫秒数。
 */
function sleepSync(ms: number): void {
  try {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
  } catch {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      // 降级忙等待
    }
  }
}

/**
 * 获取排他锁路径最近一次修改时间戳。
 */
function getLockMtimeMs(lockPath: string, isDir: boolean): number {
  try {
    const stat = statSync(lockPath);
    let mtime = Math.max(stat.mtimeMs, (stat as any).ctimeMs ?? 0);
    if (isDir) {
      const metaPath = join(lockPath, "metadata.json");
      if (existsSync(metaPath)) {
        const metaStat = statSync(metaPath);
        mtime = Math.max(mtime, metaStat.mtimeMs, (metaStat as any).ctimeMs ?? 0);
      }
    }
    return mtime;
  } catch {
    return Date.now();
  }
}

/**
 * 读取排他锁元数据并执行宽限期检测。
 */
function readLockWithGracePeriod(
  lockPath: string,
  gracePeriodMs = 3000
): { exists: boolean; isDir: boolean; info?: DataDirLockInfo; inGracePeriod: boolean } {
  if (!existsSync(lockPath)) {
    return { exists: false, isDir: false, inGracePeriod: false };
  }

  let isDir = false;
  try {
    isDir = statSync(lockPath).isDirectory();
  } catch {
    return { exists: false, isDir: false, inGracePeriod: false };
  }

  const metaPath = isDir ? join(lockPath, "metadata.json") : lockPath;

  const tryParse = (): DataDirLockInfo | undefined => {
    try {
      if (existsSync(metaPath)) {
        const raw = readFileSync(metaPath, "utf8");
        if (raw.trim().length > 0) {
          const parsed = JSON.parse(raw) as DataDirLockInfo;
          if (parsed && typeof parsed.pid === "number") {
            return parsed;
          }
        }
      }
    } catch {
      // 损坏或并发写入中
    }
    return undefined;
  };

  const initialInfo = tryParse();
  if (initialInfo) {
    return { exists: true, isDir, info: initialInfo, inGracePeriod: false };
  }

  // 元数据缺失或不可解析，检查修改时间是否在宽限期内
  const mtime = getLockMtimeMs(lockPath, isDir);
  const age = Date.now() - mtime;
  if (age < gracePeriodMs) {
    // 处于宽限期内，说明并发所有者可能正在写入，进行有限次重试等待
    const maxRetries = 20;
    for (let i = 0; i < maxRetries; i++) {
      sleepSync(50);
      const retriedInfo = tryParse();
      if (retriedInfo) {
        return { exists: true, isDir, info: retriedInfo, inGracePeriod: false };
      }
      if (!existsSync(lockPath)) {
        return { exists: false, isDir: false, inGracePeriod: false };
      }
    }

    const currentAge = Date.now() - getLockMtimeMs(lockPath, isDir);
    if (currentAge < gracePeriodMs) {
      return { exists: true, isDir, inGracePeriod: true };
    }
  }

  return { exists: true, isDir, inGracePeriod: false };
}

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
    try {
      if (existsSync(this.lockDirPath)) {
        let isDir = false;
        try {
          isDir = statSync(this.lockDirPath).isDirectory();
        } catch {
          isDir = false;
        }
        const metaPath = isDir ? join(this.lockDirPath, "metadata.json") : this.lockDirPath;
        if (existsSync(metaPath)) {
          const raw = readFileSync(metaPath, "utf8");
          const onDisk = JSON.parse(raw) as DataDirLockInfo;
          if (onDisk && onDisk.sessionToken === this.info.sessionToken) {
            rmSync(this.lockDirPath, { recursive: true, force: true });
          }
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
   * - 基于原子目录创建 mkdirSync(lockDirPath, { mode: 0o700 }) 确立所有权，并在其下存放 metadata.json。
   * - 兼容已有常规文件锁（如老版本或测试 mock 场景）。
   * - 若锁目录已存在，通过宽限期机制防止将并发写入中的元数据误判为锁死亡。
   * - 若主进程仍处于存活状态，抛出 DATA_DIR_IN_USE 错误拒绝并发启动。
   * - 若主进程已退出但仍有子进程存活，抛出 DATA_DIR_RECOVERY_REQUIRED 错误。
   * - 若主进程与所有子进程均已退出（或超过宽限期的陈旧损坏锁），通过原子隔离安全移除并接管。
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

    const lockDirPath = join(dataDir, ".actiondock.data.lock");
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

    while (true) {
      try {
        mkdirSync(lockDirPath, { mode: 0o700 });
        const metaPath = join(lockDirPath, "metadata.json");
        const tmpPath = join(
          lockDirPath,
          `metadata.json.tmp.${currentPid}.${randomUUID().slice(0, 8)}`
        );
        writeFileSync(tmpPath, content, { mode: 0o600 });
        renameSync(tmpPath, metaPath);
        return new DataDirLock(lockDirPath, newLockInfo);
      } catch (err: any) {
        if (err && (err.code === "EEXIST" || err.code === "ENOENT")) {
          const lockState = readLockWithGracePeriod(lockDirPath, 3000);

          if (!lockState.exists) {
            continue;
          }

          if (lockState.inGracePeriod) {
            sleepSync(50);
            continue;
          }

          if (lockState.info && typeof lockState.info.pid === "number") {
            const parentAlive = isProcessAlive(lockState.info.pid);

            if (parentAlive) {
              const inUseErr: any = new Error(
                `DATA_DIR_IN_USE: Data directory '${dataDir}' is in use by another active Host process (PID ${lockState.info.pid})`
              );
              inUseErr.code = "DATA_DIR_IN_USE";
              throw inUseErr;
            }

            // 主进程已死亡，检查关联子进程存活状态
            const activeChildren = (lockState.info.childPids || []).filter((childPid) =>
              isProcessAlive(childPid)
            );

            if (activeChildren.length > 0) {
              const recoveryErr: any = new Error(
                `DATA_DIR_RECOVERY_REQUIRED: Data directory recovery required for '${dataDir}': previous host (PID ${lockState.info.pid}) exited but child processes (${activeChildren.join(
                  ", "
                )}) are still running`
              );
              recoveryErr.code = "DATA_DIR_RECOVERY_REQUIRED";
              throw recoveryErr;
            }
          }

          const recheckState = readLockWithGracePeriod(lockDirPath, 1000);
          if (!recheckState.exists) {
            continue;
          }
          if (recheckState.inGracePeriod) {
            sleepSync(50);
            continue;
          }
          if (
            recheckState.info &&
            typeof recheckState.info.pid === "number" &&
            isProcessAlive(recheckState.info.pid)
          ) {
            const inUseErr: any = new Error(
              `DATA_DIR_IN_USE: Data directory '${dataDir}' is in use by another active Host process (PID ${recheckState.info.pid})`
            );
            inUseErr.code = "DATA_DIR_IN_USE";
            throw inUseErr;
          }

          // 主进程与所有子进程均已退出（或超过宽限期的损坏锁），使用原子检疫隔离移除陈旧锁
          const quarantinePath = `${lockDirPath}.quarantine.${currentPid}.${Date.now()}.${randomUUID().slice(0, 8)}`;
          try {
            renameSync(lockDirPath, quarantinePath);
          } catch {
            // 若 renameSync 捕获异常（如已被其他并发者移走或改动），直接 continue 进入下一轮重试循环
            continue;
          }

          // 校验隔离目录元数据，若包含存活进程所有权或处于宽限期内则说明并发竞争下移走了活跃进程新锁，执行恢复
          const quarantinedState = readLockWithGracePeriod(quarantinePath, 500);
          if (
            quarantinedState.inGracePeriod ||
            (quarantinedState.info &&
              typeof quarantinedState.info.pid === "number" &&
              isProcessAlive(quarantinedState.info.pid))
          ) {
            try {
              renameSync(quarantinePath, lockDirPath);
            } catch {
              rmSync(quarantinePath, { recursive: true, force: true });
            }
            const holderPid = quarantinedState.info?.pid ?? "active";
            const inUseErr: any = new Error(
              `DATA_DIR_IN_USE: Data directory '${dataDir}' is in use by another active Host process (PID ${holderPid})`
            );
            inUseErr.code = "DATA_DIR_IN_USE";
            throw inUseErr;
          }

          try {
            rmSync(quarantinePath, { recursive: true, force: true });
          } catch {
            // 忽略隔离区清理异常
          }
          continue;
        }
        throw err;
      }
    }
  }
}
