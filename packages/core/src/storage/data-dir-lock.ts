import fs, {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { hostname } from "node:os";
import { dirname, join } from "node:path";
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
  gracePeriodMs = 3000,
  deadline?: number
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
    // 处于宽限期内，说明并发所有者可能正在写入，进行有限次重试等待（严格受限于 deadline）
    const maxRetries = 20;
    for (let i = 0; i < maxRetries; i++) {
      if (deadline !== undefined && Date.now() >= deadline) {
        break;
      }
      const remaining = deadline !== undefined ? deadline - Date.now() : 50;
      if (remaining <= 0) {
        break;
      }
      sleepSync(Math.min(50, remaining));
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
  /** 内部排他锁令牌（用于防护伪造 sessionToken 的所有权隔离） */
  lockToken?: string;
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
    const createdAt = typeof info.createdAt === "number" ? info.createdAt : getLockMtimeMs(reclaimPath, isDir);
    const age = Date.now() - createdAt;

    if (isAliveFn(info.pid)) {
      return { exists: true, active: true, isStale: false, holderPid: info.pid, guardToken };
    }

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
export function safeRemoveStaleReclaimGuard(
  reclaimPath: string,
  expectedGuardToken?: string
): void {
  if (!existsSync(reclaimPath)) return;

  let isDir = false;
  try {
    isDir = statSync(reclaimPath).isDirectory();
  } catch {
    return;
  }

  const metaPath = isDir ? join(reclaimPath, "metadata.json") : reclaimPath;

  if (expectedGuardToken) {
    if (!existsSync(metaPath)) {
      return;
    }
    try {
      const metaStat = statSync(metaPath);
      const mtimeMs = metaStat.mtimeMs;
      const raw = readFileSync(metaPath, "utf8");
      const parsed = JSON.parse(raw);
      if (parsed?.guardToken !== expectedGuardToken) {
        return;
      }
      if (parsed?.pid !== process.pid && Date.now() - mtimeMs < 1000) {
        return;
      }
    } catch {
      return;
    }
  }

  const quarantinePath = `${reclaimPath}.quarantine.${process.pid}.${Date.now()}.${randomUUID().slice(0, 8)}`;
  try {
    fs.renameSync(reclaimPath, quarantinePath);
  } catch {
    return;
  }

  try {
    const quarantinedMetaPath = isDir ? join(quarantinePath, "metadata.json") : quarantinePath;
    let actualGuardToken: string | undefined;
    if (existsSync(quarantinedMetaPath)) {
      try {
        const raw = readFileSync(quarantinedMetaPath, "utf8");
        const parsed = JSON.parse(raw);
        actualGuardToken = parsed?.guardToken;
      } catch {}
    }

    if (expectedGuardToken !== actualGuardToken) {
      // 并非此前检查的陈旧 guard（已被并发者替换为新活跃 guard）
      // 保持隔离状态，转换为 .orphan 脱离态，脱离创建者 Host PID 的存活保护，由 GC 基于真实持有者存活与时间清理
      const orphanPath = `${reclaimPath}.orphan.${Date.now()}.${randomUUID().slice(0, 8)}`;
      try {
        fs.renameSync(quarantinePath, orphanPath);
      } catch {}
      return;
    }

    // 确认正是目标陈旧 guard，安全清理
    fs.rmSync(quarantinePath, { recursive: true, force: true });
  } catch {
    // 发生异常，保持隔离状态，转换为 .orphan 脱离态
    const orphanPath = `${reclaimPath}.orphan.${Date.now()}.${randomUUID().slice(0, 8)}`;
    try {
      fs.renameSync(quarantinePath, orphanPath);
    } catch {}
  }
}

/**
 * 从隔离或回滚临时目录名称中解析操作者 PID 与隔离生成时间戳。
 * 命名规范：*.(quarantine|rollback|release).<pid>.<timestamp>.<uuid>
 */
export function parseQuarantineTimestamp(entryName: string): {
  operatorPid?: number;
  timestamp?: number;
} {
  const orphanMatch = entryName.match(/\.orphan\.(\d+)(?:\.|$)/);
  if (orphanMatch && orphanMatch[1]) {
    const ts = parseInt(orphanMatch[1], 10);
    return {
      timestamp: !Number.isNaN(ts) && ts > 0 ? ts : undefined,
    };
  }

  const match = entryName.match(/\.(?:quarantine|rollback|release)\.(\d+)\.(\d+)(?:\.|$)/);
  if (match && match[1] && match[2]) {
    const pid = parseInt(match[1], 10);
    const ts = parseInt(match[2], 10);
    return {
      operatorPid: !Number.isNaN(pid) && pid > 0 ? pid : undefined,
      timestamp: !Number.isNaN(ts) && ts > 0 ? ts : undefined,
    };
  }
  const fallbackMatch = entryName.match(/\.(?:quarantine|rollback|release)\.(\d+)(?:\.|$)/);
  if (fallbackMatch && fallbackMatch[1]) {
    const ts = parseInt(fallbackMatch[1], 10);
    return {
      timestamp: !Number.isNaN(ts) && ts > 0 ? ts : undefined,
    };
  }
  return {};
}

/**
 * 清理过期的隔离目录（GC 回收机制）。
 * 实施双重存活 fencing 校验，防止并发竞争者误删活跃持锁者或正处于回滚保护中的目录：
 * - 检查操作者 PID：若正在操作该目录的 operatorPid 仍存活，绝对不得清理。
 * - 检查存活年龄：若未超过 maxAgeMs，不得清理。
 * - 检查隔离目录内 metadata.json：若记录的锁持有者 pid 存活（或 childPids 存在存活子进程），绝对不得清理。
 * - 仅当操作者已死、已超过 maxAgeMs、且内部 metadata.json 记录的持有者（及子进程）均已死或无存活 owner 时，才安全删除。
 */
export function cleanStaleQuarantines(
  parentDir: string,
  basePrefix: string,
  maxAgeMs = 10000,
  deadline?: number
): void {
  try {
    if (!existsSync(parentDir)) return;
    const entries = readdirSync(parentDir);
    const now = Date.now();
    for (const entry of entries) {
      if (deadline !== undefined && Date.now() >= deadline) {
        break;
      }
      if (!entry.startsWith(basePrefix)) continue;
      if (
        !entry.includes(".quarantine.") &&
        !entry.includes(".rollback.") &&
        !entry.includes(".release.") &&
        !entry.includes(".orphan.")
      ) {
        continue;
      }
      const fullPath = join(parentDir, entry);
      try {
        const { operatorPid, timestamp } = parseQuarantineTimestamp(entry);

        // 检查操作者 PID：若正在操作该目录的 operatorPid 仍处于存活状态，绝对不得清理，直接跳过
        if (operatorPid !== undefined && isProcessAlive(operatorPid)) {
          continue;
        }

        // 检查存活年龄：若未超过 maxAgeMs（默认 10000ms），直接跳过
        let age: number;
        if (timestamp !== undefined) {
          age = now - timestamp;
        } else {
          const stat = statSync(fullPath);
          age = now - stat.mtimeMs;
        }
        if (age <= maxAgeMs) {
          continue;
        }

        // 检查隔离目录内 metadata.json：若 metadata 中记录的锁持有者 pid 存活（或 childPids 存在存活子进程），绝对不得清理，直接跳过
        let isDir = false;
        try {
          isDir = statSync(fullPath).isDirectory();
        } catch {
          continue;
        }
        const metaPath = isDir ? join(fullPath, "metadata.json") : fullPath;
        if (existsSync(metaPath)) {
          try {
            const raw = readFileSync(metaPath, "utf8");
            if (raw.trim().length > 0) {
              const meta = JSON.parse(raw) as Partial<DataDirLockInfo>;
              if (typeof meta?.pid === "number" && isProcessAlive(meta.pid)) {
                continue;
              }
              if (
                Array.isArray(meta?.childPids) &&
                meta.childPids.some((childPid) => typeof childPid === "number" && isProcessAlive(childPid))
              ) {
                continue;
              }
            }
          } catch {
            // 元数据损坏或不可读，不视为存在存活持有者
          }
        }

        // 仅当操作者已死、已超过 maxAgeMs、且内部 metadata.json 记录的持有者（及子进程）均已死或无存活 owner 时，才执行 rmSync 安全清理
        rmSync(fullPath, { recursive: true, force: true });
      } catch {}
    }
  } catch {}
}

/**
 * 安全回滚当前进程创建的主锁。
 * 优先核对 lockToken，回退核对 sessionToken，防止误删接管者或并发新锁。
 */
export function safeRollbackLock(
  lockPath: string,
  expectedSessionToken: string,
  expectedLockToken?: string
): void {
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
    let actualLockToken: string | undefined;
    if (existsSync(metaPath)) {
      try {
        const raw = readFileSync(metaPath, "utf8");
        const parsed = JSON.parse(raw);
        actualSessionToken = parsed?.sessionToken;
        actualLockToken = parsed?.lockToken;
      } catch {}
    }

    const isMatch = expectedLockToken
      ? (actualLockToken === expectedLockToken && actualSessionToken === expectedSessionToken)
      : (actualSessionToken === expectedSessionToken);

    if (!isMatch) {
      // 并非自身刚才创建的锁目录，立即恢复原位！
      try {
        renameSync(quarantinePath, lockPath);
      } catch {
        try {
          renameSync(quarantinePath, `${lockPath}.orphan.${Date.now()}.${randomUUID().slice(0, 8)}`);
        } catch {}
      }
      return;
    }

    rmSync(quarantinePath, { recursive: true, force: true });
  } catch {
    try {
      renameSync(quarantinePath, lockPath);
    } catch {
      try {
        renameSync(quarantinePath, `${lockPath}.orphan.${Date.now()}.${randomUUID().slice(0, 8)}`);
      } catch {}
    }
  }
}

/**
 * 安全隔离并清理陈旧主锁。
 * 隔离后复核元数据，确保仅删除目标陈旧锁，若已被更新或仍有存活所有者则恢复原位。
 */
function safeQuarantineStaleLock(
  lockPath: string,
  expectedSessionToken?: string,
  expectedLockToken?: string
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
    let actualLockToken: string | undefined;
    let actualPid: number | undefined;
    if (existsSync(metaPath)) {
      try {
        const raw = readFileSync(metaPath, "utf8");
        const parsed = JSON.parse(raw);
        actualSessionToken = parsed?.sessionToken;
        actualLockToken = parsed?.lockToken;
        actualPid = parsed?.pid;
      } catch {}
    }

    const tokenMismatch = expectedLockToken
      ? (actualLockToken !== expectedLockToken || (expectedSessionToken && actualSessionToken !== expectedSessionToken))
      : ((expectedSessionToken && actualSessionToken !== expectedSessionToken) || (!expectedSessionToken && actualSessionToken));

    if (tokenMismatch) {
      // 锁已被其他竞争者接管并写入新 token，绝不可删除！立即恢复原位
      try {
        renameSync(quarantinePath, lockPath);
      } catch {
        try {
          renameSync(quarantinePath, `${lockPath}.orphan.${Date.now()}.${randomUUID().slice(0, 8)}`);
        } catch {}
      }
      return false;
    }

    if (typeof actualPid === "number" && isProcessAlive(actualPid)) {
      // 持有者实际仍存活，恢复原位
      try {
        renameSync(quarantinePath, lockPath);
      } catch {
        try {
          renameSync(quarantinePath, `${lockPath}.orphan.${Date.now()}.${randomUUID().slice(0, 8)}`);
        } catch {}
      }
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
        renameSync(quarantinePath, `${lockPath}.orphan.${Date.now()}.${randomUUID().slice(0, 8)}`);
      } catch {}
    }
    return false;
  }
}

/**
 * 安全释放主锁。
 * 仅当锁目录中持有当前 lockToken / sessionToken 时才删除，杜绝删除他人新锁。
 */
export function safeReleaseLock(
  lockPath: string,
  expectedSessionToken: string,
  expectedLockToken?: string
): void {
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
    let actualLockToken: string | undefined;
    if (existsSync(metaPath)) {
      try {
        const raw = readFileSync(metaPath, "utf8");
        const parsed = JSON.parse(raw);
        actualSessionToken = parsed?.sessionToken;
        actualLockToken = parsed?.lockToken;
      } catch {}
    }

    const isMatch = expectedLockToken
      ? (actualLockToken === expectedLockToken && actualSessionToken === expectedSessionToken)
      : (actualSessionToken === expectedSessionToken);

    if (isMatch) {
      rmSync(quarantinePath, { recursive: true, force: true });
    } else {
      // 并非当前会话持有的锁，恢复原位
      try {
        renameSync(quarantinePath, lockPath);
      } catch {
        try {
          renameSync(quarantinePath, `${lockPath}.orphan.${Date.now()}.${randomUUID().slice(0, 8)}`);
        } catch {}
      }
    }
  } catch {
    try {
      renameSync(quarantinePath, lockPath);
    } catch {
      try {
        renameSync(quarantinePath, `${lockPath}.orphan.${Date.now()}.${randomUUID().slice(0, 8)}`);
      } catch {}
    }
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
    safeReleaseLock(this.lockDirPath, this.info.sessionToken, this.info.lockToken);
    cleanStaleQuarantines(dirname(this.lockDirPath), ".actiondock.data.lock");
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
    options: { sessionToken?: string; hostSessionId?: string; acquireTimeoutMs?: number } = {}
  ): DataDirLock {
    const timeoutMs = options.acquireTimeoutMs ?? 5000;
    const deadline = Date.now() + timeoutMs;
    if (!existsSync(dataDir)) {
      mkdirSync(dataDir, { recursive: true, mode: 0o700 });
    }
    cleanStaleQuarantines(dataDir, ".actiondock.data.lock", 10000, deadline);

    const lockDirPath = join(dataDir, ".actiondock.data.lock");
    const reclaimDirPath = `${lockDirPath}.reclaim`;
    const currentPid = process.pid;
    const currentHost = hostname();
    const token = options.sessionToken || randomUUID();
    const lockToken = randomUUID();
    const newLockInfo: DataDirLockInfo = {
      pid: currentPid,
      hostname: currentHost,
      sessionToken: token,
      lockToken,
      createdAt: new Date().toISOString(),
      childPids: [],
      hostSessionId: options.hostSessionId,
    };
    const content = JSON.stringify(newLockInfo, null, 2);

    while (true) {
      // 1. 当竞争者尝试创建新主锁时，若检测到 reclaim 目录存在且处于宽限期内或持有者存活，必须等待，禁止在他人正在接管/验证期间抢先创建主锁
      const reclaimState = checkReclaimGuard(reclaimDirPath, isProcessAlive, 1000);
      if (reclaimState.active) {
        if (Date.now() >= deadline) {
          const timeoutErr: any = new Error(
            `DATA_DIR_IN_USE: Timeout waiting for active reclaim guard (PID ${reclaimState.holderPid ?? "unknown"}) on data directory '${dataDir}' after ${timeoutMs}ms`
          );
          timeoutErr.code = "DATA_DIR_IN_USE";
          throw timeoutErr;
        }
        sleepSync(Math.min(50, Math.max(1, deadline - Date.now())));
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
          // 仅当锁目录中包含自身创建的 sessionToken 与 lockToken 时安全回滚，杜绝误删他人新锁
          safeRollbackLock(lockDirPath, newLockInfo.sessionToken, newLockInfo.lockToken);
          if (Date.now() >= deadline) {
            const timeoutErr: any = new Error(
              `DATA_DIR_IN_USE: Timeout acquiring lock on data directory '${dataDir}' due to active reclaim guard (PID ${postCheck.holderPid}) after ${timeoutMs}ms`
            );
            timeoutErr.code = "DATA_DIR_IN_USE";
            throw timeoutErr;
          }
          sleepSync(Math.min(50, Math.max(1, deadline - Date.now())));
          continue;
        }

        return new DataDirLock(lockDirPath, newLockInfo);
      } catch (err: any) {
        if (err && (err.code === "EEXIST" || err.code === "ENOENT")) {
          const lockState = readLockWithGracePeriod(lockDirPath, 3000, deadline);

          if (!lockState.exists) {
            if (Date.now() >= deadline) {
              const timeoutErr: any = new Error(
                `DATA_DIR_IN_USE: Timeout acquiring lock on data directory '${dataDir}' after ${timeoutMs}ms`
              );
              timeoutErr.code = "DATA_DIR_IN_USE";
              throw timeoutErr;
            }
            continue;
          }

          if (lockState.inGracePeriod) {
            if (Date.now() >= deadline) {
              const timeoutErr: any = new Error(
                `DATA_DIR_IN_USE: Timeout waiting for lock grace period on data directory '${dataDir}' after ${timeoutMs}ms`
              );
              timeoutErr.code = "DATA_DIR_IN_USE";
              throw timeoutErr;
            }
            sleepSync(Math.min(50, Math.max(1, deadline - Date.now())));
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
          const staleLockToken = lockState.info?.lockToken;
          const guardToken = randomUUID();
          // 当识别到主锁为陈旧锁时，竞争者必须先原子竞争获取 reclaim guard
          const acquiredReclaim = tryAcquireReclaimGuard(reclaimDirPath, currentPid, guardToken);
          if (!acquiredReclaim) {
            const currentReclaim = checkReclaimGuard(reclaimDirPath, isProcessAlive, 1000);
            if (currentReclaim.isStale) {
              safeRemoveStaleReclaimGuard(reclaimDirPath, currentReclaim.guardToken);
            }
            if (Date.now() >= deadline) {
              const timeoutErr: any = new Error(
                `DATA_DIR_IN_USE: Timeout contending for reclaim guard on data directory '${dataDir}' after ${timeoutMs}ms`
              );
              timeoutErr.code = "DATA_DIR_IN_USE";
              throw timeoutErr;
            }
            sleepSync(Math.min(50, Math.max(1, deadline - Date.now())));
            continue;
          }

          // 仅成功获取 reclaim guard 的唯一胜利者获准执行：
          // 复核主锁陈旧性 -> 隔离/清理陈旧锁 -> 原子创建新主锁并写入自身元数据 -> 清理 reclaim guard
          try {
            const verifyReclaimOwnership = (): boolean => {
              const ownGuard = checkReclaimGuard(reclaimDirPath, isProcessAlive, 1000);
              return Boolean(
                ownGuard.active &&
                ownGuard.holderPid === currentPid &&
                ownGuard.guardToken === guardToken
              );
            };

            // 自检校验自身守卫：验证自身 guardToken 依然有效且持有者为自身 PID
            // 若已被抢占或不匹配，立即退出当前接管并 continue 重试，杜绝在守卫已失窃的情况下操作主锁
            if (!verifyReclaimOwnership()) {
              if (Date.now() >= deadline) {
                const timeoutErr: any = new Error(
                  `DATA_DIR_IN_USE: Timeout acquiring lock on data directory '${dataDir}' after ${timeoutMs}ms`
                );
                timeoutErr.code = "DATA_DIR_IN_USE";
                throw timeoutErr;
              }
              sleepSync(Math.min(50, Math.max(1, deadline - Date.now())));
              continue;
            }

            // 1. 复核主锁陈旧性
            const recheckState = readLockWithGracePeriod(lockDirPath, 1000, deadline);
            if (recheckState.exists) {
              if (recheckState.inGracePeriod) {
                if (Date.now() >= deadline) {
                  const timeoutErr: any = new Error(
                    `DATA_DIR_IN_USE: Timeout waiting for lock grace period on data directory '${dataDir}' after ${timeoutMs}ms`
                  );
                  timeoutErr.code = "DATA_DIR_IN_USE";
                  throw timeoutErr;
                }
                sleepSync(Math.min(50, Math.max(1, deadline - Date.now())));
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
                recheckState.info?.sessionToken ?? staleSessionToken,
                recheckState.info?.lockToken ?? staleLockToken
              );
              if (!cleaned) {
                if (Date.now() >= deadline) {
                  const timeoutErr: any = new Error(
                    `DATA_DIR_IN_USE: Timeout reclaiming stale lock on data directory '${dataDir}' after ${timeoutMs}ms`
                  );
                  timeoutErr.code = "DATA_DIR_IN_USE";
                  throw timeoutErr;
                }
                continue;
              }
            }

            // 后置复核 1：在清理陈旧主锁之后、创建新主锁之前，再次核验 reclaim guard 所有权
            // 若守卫在此期间失窃，严禁继续创建新主锁，立即退出重试
            if (!verifyReclaimOwnership()) {
              if (Date.now() >= deadline) {
                const timeoutErr: any = new Error(
                  `DATA_DIR_IN_USE: Timeout acquiring lock on data directory '${dataDir}' after ${timeoutMs}ms`
                );
                timeoutErr.code = "DATA_DIR_IN_USE";
                throw timeoutErr;
              }
              sleepSync(Math.min(50, Math.max(1, deadline - Date.now())));
              continue;
            }

            // 3. 原子创建新主锁并写入自身元数据（严格遵守 deadline，并在每次重试检查时间窗口）
            let created = false;
            for (let attempt = 0; attempt < 40; attempt++) {
              try {
                mkdirSync(lockDirPath, { mode: 0o700 });
                created = true;
                break;
              } catch (createErr: any) {
                if (createErr?.code === "EEXIST") {
                  if (Date.now() >= deadline) {
                    break;
                  }
                  const remaining = deadline - Date.now();
                  if (remaining <= 0) {
                    break;
                  }
                  sleepSync(Math.min(25, remaining));
                  continue;
                }
                throw createErr;
              }
            }

            if (!created) {
              if (Date.now() >= deadline) {
                const timeoutErr: any = new Error(
                  `DATA_DIR_IN_USE: Timeout creating primary lock on data directory '${dataDir}' after ${timeoutMs}ms`
                );
                timeoutErr.code = "DATA_DIR_IN_USE";
                throw timeoutErr;
              }
              continue;
            }

            const metaPath = join(lockDirPath, "metadata.json");
            const tmpPath = join(
              lockDirPath,
              `metadata.json.tmp.${currentPid}.${randomUUID().slice(0, 8)}`
            );
            writeFileSync(tmpPath, content, { mode: 0o600 });
            renameSync(tmpPath, metaPath);

            // 后置复核 2：新主锁创建完成后、返回之前再次核验 reclaim guard 所有权
            // 若守卫在创建新主锁期间失窃，说明存在并发仲裁漂移，严禁生效并安全回滚自身主锁
            if (!verifyReclaimOwnership()) {
              safeRollbackLock(lockDirPath, newLockInfo.sessionToken, newLockInfo.lockToken);
              if (Date.now() >= deadline) {
                const timeoutErr: any = new Error(
                  `DATA_DIR_IN_USE: Timeout acquiring lock on data directory '${dataDir}' after ${timeoutMs}ms`
                );
                timeoutErr.code = "DATA_DIR_IN_USE";
                throw timeoutErr;
              }
              sleepSync(Math.min(50, Math.max(1, deadline - Date.now())));
              continue;
            }

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
