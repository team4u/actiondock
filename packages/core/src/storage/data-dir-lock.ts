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
 * 检查接管守卫（reclaim guard）目录状态。
 *
 * - 若目录不存在：返回非活跃。
 * - 若处于宽限期内或持有者存活：返回活跃，禁止抢先创建主锁。
 * - 若持有者已死亡且超过宽限期：返回陈旧，可供安全清理。
 */
function checkReclaimGuard(
  reclaimPath: string,
  isAliveFn: (pid: number) => boolean,
  gracePeriodMs = 1000
): { exists: boolean; active: boolean; isStale: boolean; holderPid?: number; guardToken?: string } {
  if (!existsSync(reclaimPath)) {
    return { exists: false, active: false, isStale: false };
  }

  let isDir = false;
  try {
    isDir = statSync(reclaimPath).isDirectory();
  } catch {
    return { exists: false, active: false, isStale: false };
  }

  const metaPath = isDir ? join(reclaimPath, "metadata.json") : reclaimPath;

  const tryParse = (): { pid?: number; guardToken?: string; createdAt?: number } | undefined => {
    try {
      if (existsSync(metaPath)) {
        const raw = readFileSync(metaPath, "utf8");
        if (raw.trim().length > 0) {
          const parsed = JSON.parse(raw);
          if (parsed && typeof parsed.pid === "number") {
            return parsed;
          }
        }
      }
    } catch {}
    return undefined;
  };

  const info = tryParse();
  if (info && typeof info.pid === "number") {
    const guardToken = typeof info.guardToken === "string" ? info.guardToken : undefined;
    if (isAliveFn(info.pid)) {
      return { exists: true, active: true, isStale: false, holderPid: info.pid, guardToken };
    }
    const createdAt = typeof info.createdAt === "number" ? info.createdAt : getLockMtimeMs(reclaimPath, isDir);
    const age = Date.now() - createdAt;
    if (age < gracePeriodMs) {
      return { exists: true, active: true, isStale: false, holderPid: info.pid, guardToken };
    }
    return { exists: true, active: false, isStale: true, holderPid: info.pid, guardToken };
  }

  const mtime = getLockMtimeMs(reclaimPath, isDir);
  const age = Date.now() - mtime;
  if (age < gracePeriodMs) {
    return { exists: true, active: true, isStale: false };
  }

  return { exists: true, active: false, isStale: true };
}

/**
 * 尝试原子获取接管守卫（reclaim guard）。
 * 基于 mkdirSync 原子创建目录并写入自身元数据与唯一 guardToken。
 */
function tryAcquireReclaimGuard(reclaimPath: string, pid: number, guardToken: string): boolean {
  try {
    mkdirSync(reclaimPath, { mode: 0o700 });
    const metaPath = join(reclaimPath, "metadata.json");
    const tmpPath = join(
      reclaimPath,
      `metadata.json.tmp.${pid}.${randomUUID().slice(0, 8)}`
    );
    writeFileSync(
      tmpPath,
      JSON.stringify({ pid, guardToken, createdAt: Date.now() }, null, 2),
      { mode: 0o600 }
    );
    renameSync(tmpPath, metaPath);
    return true;
  } catch {
    return false;
  }
}

/**
 * 安全清理陈旧接管守卫（reclaim guard）。
 * 采用原子重命名检疫并核对 guardToken，确保仅删除此前确认已陈旧的目标，严禁误删并发新守卫。
 */
function safeRemoveStaleReclaimGuard(
  reclaimPath: string,
  expectedGuardToken?: string
): void {
  if (!existsSync(reclaimPath)) return;
  const quarantinePath = `${reclaimPath}.quarantine.${process.pid}.${Date.now()}.${randomUUID().slice(0, 8)}`;
  try {
    renameSync(reclaimPath, quarantinePath);
  } catch {
    return;
  }

  try {
    const metaPath = join(quarantinePath, "metadata.json");
    let actualGuardToken: string | undefined;
    if (existsSync(metaPath)) {
      try {
        const raw = readFileSync(metaPath, "utf8");
        const parsed = JSON.parse(raw);
        actualGuardToken = parsed?.guardToken;
      } catch {}
    }

    if (expectedGuardToken !== actualGuardToken) {
      // 并非此前检查的陈旧 guard（已被并发者替换为新活跃 guard），立即恢复原位！
      try {
        renameSync(quarantinePath, reclaimPath);
      } catch {}
      return;
    }

    // 确认正是目标陈旧 guard，安全清理
    rmSync(quarantinePath, { recursive: true, force: true });
  } catch {
    try {
      renameSync(quarantinePath, reclaimPath);
    } catch {
      try {
        rmSync(quarantinePath, { recursive: true, force: true });
      } catch {}
    }
  }
}

/**
 * 安全回滚当前进程创建的主锁。
 * 仅当锁目录中的 sessionToken 与自身一致时才删除，防止误删接管者或并发新锁。
 */
function safeRollbackLock(lockPath: string, expectedSessionToken: string): void {
  if (!existsSync(lockPath)) return;
  const quarantinePath = `${lockPath}.rollback.${process.pid}.${Date.now()}.${randomUUID().slice(0, 8)}`;
  try {
    renameSync(lockPath, quarantinePath);
  } catch {
    return;
  }

  try {
    let isDir = false;
    try {
      isDir = statSync(quarantinePath).isDirectory();
    } catch {
      isDir = false;
    }
    const metaPath = isDir ? join(quarantinePath, "metadata.json") : quarantinePath;
    let actualSessionToken: string | undefined;
    if (existsSync(metaPath)) {
      try {
        const raw = readFileSync(metaPath, "utf8");
        const parsed = JSON.parse(raw);
        actualSessionToken = parsed?.sessionToken;
      } catch {}
    }

    if (actualSessionToken !== expectedSessionToken) {
      // 并非自身刚才创建的锁目录，立即恢复原位！
      try {
        renameSync(quarantinePath, lockPath);
      } catch {}
      return;
    }

    rmSync(quarantinePath, { recursive: true, force: true });
  } catch {
    try {
      rmSync(quarantinePath, { recursive: true, force: true });
    } catch {}
  }
}

/**
 * 安全隔离并清理陈旧主锁。
 * 隔离后复核元数据，确保仅删除目标陈旧锁，若已被更新或仍有存活所有者则恢复原位。
 */
function safeQuarantineStaleLock(
  lockPath: string,
  expectedSessionToken?: string
): boolean {
  if (!existsSync(lockPath)) return true;
  const quarantinePath = `${lockPath}.quarantine.${process.pid}.${Date.now()}.${randomUUID().slice(0, 8)}`;
  try {
    renameSync(lockPath, quarantinePath);
  } catch {
    return false;
  }

  try {
    let isDir = false;
    try {
      isDir = statSync(quarantinePath).isDirectory();
    } catch {
      isDir = false;
    }
    const metaPath = isDir ? join(quarantinePath, "metadata.json") : quarantinePath;
    let actualSessionToken: string | undefined;
    let actualPid: number | undefined;
    if (existsSync(metaPath)) {
      try {
        const raw = readFileSync(metaPath, "utf8");
        const parsed = JSON.parse(raw);
        actualSessionToken = parsed?.sessionToken;
        actualPid = parsed?.pid;
      } catch {}
    }

    if (
      (expectedSessionToken && actualSessionToken !== expectedSessionToken) ||
      (!expectedSessionToken && actualSessionToken)
    ) {
      // 锁已被其他竞争者接管并写入新 token，绝不可删除！立即恢复原位
      try {
        renameSync(quarantinePath, lockPath);
      } catch {}
      return false;
    }

    if (typeof actualPid === "number" && isProcessAlive(actualPid)) {
      // 持有者实际仍存活，恢复原位
      try {
        renameSync(quarantinePath, lockPath);
      } catch {}
      return false;
    }

    // 确认正是目标陈旧锁，安全删除
    rmSync(quarantinePath, { recursive: true, force: true });
    return true;
  } catch {
    try {
      renameSync(quarantinePath, lockPath);
    } catch {
      try {
        rmSync(quarantinePath, { recursive: true, force: true });
      } catch {}
    }
    return false;
  }
}

/**
 * 安全释放主锁。
 * 仅当锁目录中持有当前 sessionToken 时才删除，杜绝删除他人新锁。
 */
function safeReleaseLock(lockPath: string, expectedSessionToken: string): void {
  if (!existsSync(lockPath)) return;
  const quarantinePath = `${lockPath}.release.${process.pid}.${Date.now()}.${randomUUID().slice(0, 8)}`;
  try {
    renameSync(lockPath, quarantinePath);
  } catch {
    return;
  }

  try {
    let isDir = false;
    try {
      isDir = statSync(quarantinePath).isDirectory();
    } catch {
      isDir = false;
    }
    const metaPath = isDir ? join(quarantinePath, "metadata.json") : quarantinePath;
    let actualSessionToken: string | undefined;
    if (existsSync(metaPath)) {
      try {
        const raw = readFileSync(metaPath, "utf8");
        const parsed = JSON.parse(raw);
        actualSessionToken = parsed?.sessionToken;
      } catch {}
    }

    if (actualSessionToken === expectedSessionToken) {
      rmSync(quarantinePath, { recursive: true, force: true });
    } else {
      // 并非当前会话持有的锁，恢复原位
      try {
        renameSync(quarantinePath, lockPath);
      } catch {}
    }
  } catch {
    try {
      rmSync(quarantinePath, { recursive: true, force: true });
    } catch {}
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
    safeReleaseLock(this.lockDirPath, this.info.sessionToken);
  }


  /**
   * 尝试获取指定数据目录的排他锁。
   *
   * 仲裁规则：
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
    options: { sessionToken?: string; hostSessionId?: string } = {}
  ): DataDirLock {
    if (!existsSync(dataDir)) {
      mkdirSync(dataDir, { recursive: true, mode: 0o700 });
    }

    const lockDirPath = join(dataDir, ".actiondock.data.lock");
    const reclaimDirPath = `${lockDirPath}.reclaim`;
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
      // 1. 当竞争者尝试创建新主锁时，若检测到 reclaim 目录存在且处于宽限期内或持有者存活，必须等待，禁止在他人正在接管/验证期间抢先创建主锁
      const reclaimState = checkReclaimGuard(reclaimDirPath, isProcessAlive, 1000);
      if (reclaimState.active) {
        sleepSync(50);
        continue;
      }
      if (reclaimState.isStale) {
        // 若 reclaim guard 持有者意外崩溃，其他竞争者核对此前检查的 guardToken 安全清理
        safeRemoveStaleReclaimGuard(reclaimDirPath, reclaimState.guardToken);
      }

      // 2. 尝试常规获取新主锁
      try {
        mkdirSync(lockDirPath, { mode: 0o700 });

        const metaPath = join(lockDirPath, "metadata.json");
        const tmpPath = join(
          lockDirPath,
          `metadata.json.tmp.${currentPid}.${randomUUID().slice(0, 8)}`
        );
        writeFileSync(tmpPath, content, { mode: 0o600 });
        renameSync(tmpPath, metaPath);

        // 再次确认在此窗口期内是否有他人持有活跃 reclaim guard
        const postCheck = checkReclaimGuard(reclaimDirPath, isProcessAlive, 1000);
        if (postCheck.active && postCheck.holderPid !== currentPid) {
          // 仅当锁目录中包含自身创建的 sessionToken 时安全回滚，杜绝误删他人新锁
          safeRollbackLock(lockDirPath, newLockInfo.sessionToken);
          sleepSync(50);
          continue;
        }

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

          const staleSessionToken = lockState.info?.sessionToken;
          const guardToken = randomUUID();
          // 当识别到主锁为陈旧锁时，竞争者必须先原子竞争获取 reclaim guard
          const acquiredReclaim = tryAcquireReclaimGuard(reclaimDirPath, currentPid, guardToken);
          if (!acquiredReclaim) {
            const currentReclaim = checkReclaimGuard(reclaimDirPath, isProcessAlive, 1000);
            if (currentReclaim.isStale) {
              safeRemoveStaleReclaimGuard(reclaimDirPath, currentReclaim.guardToken);
            }
            sleepSync(50);
            continue;
          }

          // 仅成功获取 reclaim guard 的唯一胜利者获准执行：
          // 复核主锁陈旧性 -> 隔离/清理陈旧锁 -> 原子创建新主锁并写入自身元数据 -> 清理 reclaim guard
          try {
            // 1. 复核主锁陈旧性
            const recheckState = readLockWithGracePeriod(lockDirPath, 1000);
            if (recheckState.exists) {
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

              const activeChildren = (recheckState.info?.childPids || []).filter((childPid) =>
                isProcessAlive(childPid)
              );
              if (activeChildren.length > 0) {
                const recoveryErr: any = new Error(
                  `DATA_DIR_RECOVERY_REQUIRED: Data directory recovery required for '${dataDir}': previous host (PID ${recheckState.info?.pid}) exited but child processes (${activeChildren.join(
                    ", "
                  )}) are still running`
                );
                recoveryErr.code = "DATA_DIR_RECOVERY_REQUIRED";
                throw recoveryErr;
              }

              // 2. 隔离并核验清理陈旧主锁（验证 sessionToken 一致，若已被他人占用则恢复原位）
              const cleaned = safeQuarantineStaleLock(
                lockDirPath,
                recheckState.info?.sessionToken ?? staleSessionToken
              );
              if (!cleaned) {
                continue;
              }
            }

            // 3. 原子创建新主锁并写入自身元数据（严禁在遇到 EEXIST 时盲目 rmSync，等待并发者安全回滚）
            let created = false;
            for (let attempt = 0; attempt < 40; attempt++) {
              try {
                mkdirSync(lockDirPath, { mode: 0o700 });
                created = true;
                break;
              } catch (createErr: any) {
                if (createErr?.code === "EEXIST") {
                  sleepSync(25);
                  continue;
                }
                throw createErr;
              }
            }

            if (!created) {
              continue;
            }

            const metaPath = join(lockDirPath, "metadata.json");
            const tmpPath = join(
              lockDirPath,
              `metadata.json.tmp.${currentPid}.${randomUUID().slice(0, 8)}`
            );
            writeFileSync(tmpPath, content, { mode: 0o600 });
            renameSync(tmpPath, metaPath);

            return new DataDirLock(lockDirPath, newLockInfo);
          } finally {
            // 4. 清理自身持有的 reclaim guard（必须核对自身 guardToken）
            safeRemoveStaleReclaimGuard(reclaimDirPath, guardToken);
          }
        }
        throw err;
      }
    }
  }
}
