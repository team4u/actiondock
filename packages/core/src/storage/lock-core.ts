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
import { basename, dirname, join } from "node:path";
import { randomUUID } from "node:crypto";

/**
 * 目录锁内核（单一事实源）。
 *
 * 统一承载工程修改锁（project.lock）与数据目录排他锁（.actiondock.data.lock）
 * 共用的目录锁协议实现：原子目录创建、元数据宽限期检测、接管守卫（reclaim guard）
 * 仲裁、检疫隔离与孤儿回收。上层模块（project/transactions 与 storage/data-dir-lock）
 * 仅以参数与钩子形式注入领域差异（路径、错误码、消息与陈旧持有者判定），严禁在此
 * 之外再复制锁算法实现。
 *
 * 物理布局约定：主锁为目录，内部存放 metadata.json；接管守卫目录为主锁路径加
 * .reclaim 后缀；隔离与孤儿目录以 .quarantine / .rollback / .release / .orphan
 * 后缀标记并由 GC 按时间与存活凭证回收。
 */

const METADATA_FILE = "metadata.json";
const RECLAIM_SUFFIX = ".reclaim";

/**
 * 目录锁元数据通用契约。
 * 工程锁与数据目录锁共用同一物理布局，仅部分字段按场景取舍。
 */
export interface DirectoryLockMetadata {
  pid?: number;
  sessionToken?: string;
  lockToken?: string;
  guardToken?: string;
  childPids?: number[];
  createdAt?: number | string;
  [key: string]: unknown;
}

/**
 * 带宽限期检测的锁状态快照。
 */
export interface LockGraceState {
  exists: boolean;
  isDir: boolean;
  info?: DirectoryLockMetadata;
  inGracePeriod: boolean;
}

/**
 * 接管守卫（reclaim guard）状态快照。
 */
export interface ReclaimGuardState {
  exists: boolean;
  active: boolean;
  isStale: boolean;
  holderPid?: number;
  guardToken?: string;
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
      const metaPath = join(lockPath, METADATA_FILE);
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
export function readLockWithGracePeriod(
  lockPath: string,
  gracePeriodMs = 3000,
  deadline?: number
): LockGraceState {
  if (!existsSync(lockPath)) {
    return { exists: false, isDir: false, inGracePeriod: false };
  }

  let isDir = false;
  try {
    isDir = statSync(lockPath).isDirectory();
  } catch {
    return { exists: false, isDir: false, inGracePeriod: false };
  }

  const metaPath = isDir ? join(lockPath, METADATA_FILE) : lockPath;

  const tryParse = (): DirectoryLockMetadata | undefined => {
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
 * 检查接管守卫（reclaim guard）目录状态。
 *
 * - 若目录不存在：返回非活跃。
 * - 若处于宽限期内或持有者存活：返回活跃，禁止抢先创建主锁。
 * - 若持有者已死亡且超过宽限期：返回陈旧，可供安全清理。
 */
export function checkReclaimGuard(
  reclaimPath: string,
  gracePeriodMs = 1000
): ReclaimGuardState {
  if (!existsSync(reclaimPath)) {
    return { exists: false, active: false, isStale: false };
  }

  let isDir = false;
  try {
    isDir = statSync(reclaimPath).isDirectory();
  } catch {
    return { exists: false, active: false, isStale: false };
  }

  const metaPath = isDir ? join(reclaimPath, METADATA_FILE) : reclaimPath;

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

    if (isProcessAlive(info.pid)) {
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
export function tryAcquireReclaimGuard(reclaimPath: string, pid: number, guardToken: string): boolean {
  try {
    mkdirSync(reclaimPath, { mode: 0o700 });
    const metaPath = join(reclaimPath, METADATA_FILE);
    const tmpPath = join(
      reclaimPath,
      `${METADATA_FILE}.tmp.${pid}.${randomUUID().slice(0, 8)}`
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
 * 采用原子重命名检疫并严格核对 guardToken 与持有者存活状态，确保仅删除目标陈旧 guard，严禁误删活跃守卫或并发新守卫。
 *
 * @param reclaimPath 目标守卫路径
 * @param expectedGuardToken 预期持有的守卫令牌（必填，拒绝未指定令牌的盲目清理）
 */
export function safeRemoveStaleReclaimGuard(
  reclaimPath: string,
  expectedGuardToken: string
): void {
  if (!expectedGuardToken || typeof expectedGuardToken !== "string") return;
  if (!existsSync(reclaimPath)) return;

  let isDir = false;
  try {
    isDir = statSync(reclaimPath).isDirectory();
  } catch {
    return;
  }

  const metaPath = isDir ? join(reclaimPath, METADATA_FILE) : reclaimPath;
  if (!existsSync(metaPath)) {
    return;
  }

  try {
    const metaStat = statSync(metaPath);
    const mtimeMs = metaStat.mtimeMs;
    const raw = readFileSync(metaPath, "utf8");
    if (raw.trim().length === 0) {
      return;
    }
    const parsed = JSON.parse(raw);
    if (parsed?.guardToken !== expectedGuardToken) {
      return;
    }

    // 自身验证 fail-closed：
    // 若不是当前进程自身清理自身守卫（即 parsed.pid !== process.pid）：
    // 验证持有者 PID 是否存活，若仍存活则判定守卫仍处于活跃状态，严禁删除；
    // 且验证是否处于创建宽限期内（1000ms），若在宽限期内严禁删除。
    if (parsed?.pid !== process.pid) {
      if (typeof parsed?.pid === "number" && isProcessAlive(parsed.pid)) {
        return;
      }
      if (Date.now() - mtimeMs < 1000) {
        return;
      }
    }
  } catch {
    return;
  }

  const quarantinePath = `${reclaimPath}.quarantine.${process.pid}.${Date.now()}.${randomUUID().slice(0, 8)}`;
  try {
    fs.renameSync(reclaimPath, quarantinePath);
  } catch {
    return;
  }

  try {
    const quarantinedMetaPath = isDir ? join(quarantinePath, METADATA_FILE) : quarantinePath;
    let actualGuardToken: string | undefined;
    let actualPid: number | undefined;
    if (existsSync(quarantinedMetaPath)) {
      try {
        const raw = readFileSync(quarantinedMetaPath, "utf8");
        if (raw.trim().length > 0) {
          const parsed = JSON.parse(raw);
          actualGuardToken = parsed?.guardToken;
          actualPid = typeof parsed?.pid === "number" ? parsed.pid : undefined;
        }
      } catch {}
    }

    // 后置校验：必须再次核对 actualGuardToken 与 expectedGuardToken 一致，
    // 且若持有者非自身，必须确保 actualPid 确已死亡。
    if (
      expectedGuardToken !== actualGuardToken ||
      (actualPid !== undefined && actualPid !== process.pid && isProcessAlive(actualPid))
    ) {
      // 并非此前检查的目标陈旧 guard（已被并发者替换或持有者存活）
      // 保持隔离状态，转换为 .orphan 脱离态，脱离创建者 Host PID 的存活保护，由 GC 基于规范路径凭据与时间清理
      const orphanPath = `${reclaimPath}.orphan.${Date.now()}.${randomUUID().slice(0, 8)}`;
      try {
        fs.renameSync(quarantinePath, orphanPath);
      } catch {}
      return;
    }

    // 确认正是目标陈旧 guard（或自身持有的 guard），安全清理
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
 * 命名规范：*.(quarantine|rollback|release).<pid>.<timestamp>.<uuid> 或 *.orphan.<timestamp>.<uuid>
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
 * 读取目标规范路径（主锁目录或 reclaim 目录）中记录的当前有效令牌凭据。
 */
function readCanonicalToken(targetPath: string): string | undefined {
  try {
    if (!existsSync(targetPath)) {
      return undefined;
    }
    let isDir = false;
    try {
      isDir = statSync(targetPath).isDirectory();
    } catch {
      return undefined;
    }
    const metaPath = isDir ? join(targetPath, METADATA_FILE) : targetPath;
    if (!existsSync(metaPath)) {
      return undefined;
    }
    const raw = readFileSync(metaPath, "utf8");
    if (raw.trim().length === 0) {
      return undefined;
    }
    const parsed = JSON.parse(raw);
    if (typeof parsed?.guardToken === "string" && parsed.guardToken.length > 0) {
      return parsed.guardToken;
    }
    if (typeof parsed?.lockToken === "string" && parsed.lockToken.length > 0) {
      return parsed.lockToken;
    }
    return undefined;
  } catch {
    return undefined;
  }
}

/**
 * 清理过期的隔离目录（GC 回收机制）。
 * 实施分流存活校验，防止误删活跃持锁者与回滚中目录，同时防止孤儿目录无限泄漏：
 * - 共同前置条件：存活年龄必须超过 maxAgeMs（默认 10000ms），未超期前严禁清理（保持宽限期）。
 * - 活跃隔离目录（quarantine / rollback / release）：若 operatorPid 存活或内部 metadata.json 记录的 pid 与 childPids 存活，跳过不予清理。
 * - 孤儿脱离目录（orphan）：内部旧 metadata.pid 不再作为续命依据；提取其内部 orphanToken，仅当当前规范主路径（主锁目录与 reclaim 目录）依然持有该凭证时保守跳过；规范路径不存在或已变更凭据时直接安全清理。
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
    const canonicalPrimaryLockPath = basePrefix.endsWith(RECLAIM_SUFFIX)
      ? join(parentDir, basePrefix.slice(0, -RECLAIM_SUFFIX.length))
      : join(parentDir, basePrefix);
    const canonicalReclaimPath = `${canonicalPrimaryLockPath}${RECLAIM_SUFFIX}`;

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

        // 共同前置条件：存活年龄必须超过 maxAgeMs，未超期前严禁清理（保持宽限期）
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

        const isOrphan = entry.includes(".orphan.");
        if (!isOrphan) {
          // 活跃的 quarantine / rollback / release 目录：
          // 若 operatorPid 存活，跳过不予清理
          if (operatorPid !== undefined && isProcessAlive(operatorPid)) {
            continue;
          }

          // 若内部 metadata.json 记录的 pid 或 childPids 存活，跳过不予清理
          let isDir = false;
          try {
            isDir = statSync(fullPath).isDirectory();
          } catch {
            continue;
          }
          const metaPath = isDir ? join(fullPath, METADATA_FILE) : fullPath;
          if (existsSync(metaPath)) {
            try {
              const raw = readFileSync(metaPath, "utf8");
              if (raw.trim().length > 0) {
                const meta = JSON.parse(raw);
                if (typeof meta?.pid === "number" && isProcessAlive(meta.pid)) {
                  continue;
                }
                if (
                  Array.isArray(meta?.childPids) &&
                  meta.childPids.some((childPid: any) => typeof childPid === "number" && isProcessAlive(childPid))
                ) {
                  continue;
                }
              }
            } catch {
              // 元数据损坏或不可读，不视为存在存活持有者
            }
          }

          rmSync(fullPath, { recursive: true, force: true });
          continue;
        }

        // 孤儿脱离目录（已脱离规范路径）：
        // 严禁再用内部旧 metadata.pid 存活为由无限续命，
        // 提取 orphan 内部记录的 orphanToken（guardToken ?? lockToken）
        const orphanToken = readCanonicalToken(fullPath);

        // 核对当前 canonical 规范主路径（主锁目录与 reclaim 目录）的当前凭证：
        // 仅当当前规范路径依然持有该 orphanToken 时保守跳过；若规范路径不存在或已切换为其他 token，直接执行 rmSync 安全清理
        const primaryToken = readCanonicalToken(canonicalPrimaryLockPath);
        const reclaimToken = readCanonicalToken(canonicalReclaimPath);

        if (
          orphanToken !== undefined &&
          (orphanToken === primaryToken || orphanToken === reclaimToken)
        ) {
          continue;
        }

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
    const metaPath = isDir ? join(quarantinePath, METADATA_FILE) : quarantinePath;
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
export function safeQuarantineStaleLock(
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
    const metaPath = isDir ? join(quarantinePath, METADATA_FILE) : quarantinePath;
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
 * 传入 gcAfterRelease 时在释放结束后以主锁文件名为前缀触发一轮隔离目录 GC。
 */
export function safeReleaseLock(
  lockPath: string,
  expectedSessionToken: string,
  expectedLockToken?: string,
  options?: { gcAfterRelease?: boolean }
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
    const metaPath = isDir ? join(quarantinePath, METADATA_FILE) : quarantinePath;
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
  if (options?.gcAfterRelease) {
    cleanStaleQuarantines(dirname(lockPath), basename(lockPath));
  }
}

/**
 * 向主锁目录原子写入元数据。
 * 先写入临时文件再通过 renameSync 原子替换，消除 truncate 空文件窗口。
 */
function writePrimaryLockMetadata(lockPath: string, content: string): void {
  const metaPath = join(lockPath, METADATA_FILE);
  const tmpPath = join(
    lockPath,
    `${METADATA_FILE}.tmp.${process.pid}.${randomUUID().slice(0, 8)}`
  );
  writeFileSync(tmpPath, content, { mode: 0o600 });
  renameSync(tmpPath, metaPath);
}

/**
 * 目录锁获取流程的各类超时错误消息模板。
 * 由上层模块注入，保证各领域错误文案与错误码完全保持原语义。
 */
export interface DirectoryLockMessages {
  /** 等待活跃接管守卫超时 */
  timeoutWaitingReclaimGuard(holderPid?: number): string;
  /** 因他人活跃接管守卫导致获取主锁超时 */
  timeoutAcquireBlockedByGuard(holderPid?: number): string;
  /** 获取主锁通用超时 */
  timeoutAcquire(): string;
  /** 等待主锁元数据宽限期超时 */
  timeoutGracePeriod(): string;
  /** 争抢接管守卫超时 */
  timeoutGuardContention(): string;
  /** 接管陈旧主锁超时 */
  timeoutReclaimStale(): string;
  /** 创建新主锁超时 */
  timeoutCreate(): string;
}

/**
 * 目录锁获取流程配置。
 * 上层模块以此注入锁路径、令牌、错误构造与领域差异钩子。
 */
export interface AcquireDirectoryLockConfig<T> {
  /** 主锁目录完整路径 */
  lockPath: string;
  /** 主锁所在父目录（用于隔离目录 GC） */
  parentDir: string;
  /** 主锁目录在父目录中的基础名称前缀 */
  basePrefix: string;
  /** 待写入主锁的元数据 JSON 文本 */
  metadataContent: string;
  /** 自身会话令牌 */
  sessionToken: string;
  /** 自身内部排他锁令牌 */
  lockToken: string;
  /** 获取锁的超时时间，默认 5000ms */
  acquireTimeoutMs?: number;
  /** 构造带错误码的占用异常 */
  createLockError(message: string): Error & { code: string };
  /** 各类超时场景的错误消息模板 */
  messages: DirectoryLockMessages;
  /** 陈旧锁持有者复核回调：若持有者仍阻断接管则直接抛错 */
  assertStaleHolderReclaimable(info: DirectoryLockMetadata): void;
  /** 成功获取主锁后的返回值构造 */
  onAcquired(): T;
}

/**
 * 目录锁统一获取仲裁流程。
 *
 * 仲裁规则：
 * - 引入所有竞争者均遵守的原子 reclaim guard 机制（lockPath.reclaim），每个 guard 具备全局唯一 guardToken。
 * - 基于原子目录创建 mkdirSync(lockPath, { mode: 0o700 }) 确立所有权，并在其下存放 metadata.json。
 * - 若检测到 reclaim guard 存在且处于宽限期内或持有者存活，必须等待，禁止抢先创建主锁。
 * - 若锁目录已存在，通过宽限期机制防止将并发写入中的元数据误判为锁死亡。
 * - 若持有者仍存活（判定由 assertStaleHolderReclaimable 注入），抛出上层领域错误拒绝并发接管。
 * - 当识别到主锁为陈旧锁时，竞争者必须先原子竞争获取 reclaim guard。
 * - 仅成功获取 reclaim guard 的唯一胜利者获准执行：复核主锁陈旧性 -> 验证并清理陈旧主锁 -> 原子创建新主锁并写入自身元数据 -> 清理 reclaim guard。
 * - 竞争失败者等待并 continue 重试；若 reclaim guard 持有者意外崩溃，其他竞争者在超过宽限期且 PID 已死后通过 safeRemoveStaleReclaimGuard 核对 guardToken 并清理。
 * - 严禁在获取新主锁遇到 EEXIST 时盲目 rmSync；后检发现他人活跃 guard 时，仅通过 safeRollbackLock 核对自身 sessionToken 回滚自身锁。
 */
export function acquireDirectoryLock<T>(config: AcquireDirectoryLockConfig<T>): T {
  const {
    lockPath,
    parentDir,
    basePrefix,
    metadataContent,
    sessionToken,
    lockToken,
    createLockError,
    messages,
    assertStaleHolderReclaimable,
    onAcquired,
  } = config;
  const timeoutMs = config.acquireTimeoutMs ?? 5000;
  const deadline = Date.now() + timeoutMs;
  const reclaimPath = `${lockPath}${RECLAIM_SUFFIX}`;
  const currentPid = process.pid;
  const content = metadataContent;

  const throwLockError = (message: string): never => {
    throw createLockError(message);
  };

  cleanStaleQuarantines(parentDir, basePrefix, 10000, deadline);

  while (true) {
    // 当竞争者尝试创建新主锁时，若检测到 reclaim 目录存在且处于宽限期内或持有者存活，必须等待，禁止在他人正在接管/验证期间抢先创建主锁
    const reclaimState = checkReclaimGuard(reclaimPath, 1000);
    if (reclaimState.active) {
      if (Date.now() >= deadline) {
        throwLockError(messages.timeoutWaitingReclaimGuard(reclaimState.holderPid));
      }
      sleepSync(Math.min(50, Math.max(1, deadline - Date.now())));
      continue;
    }
    if (reclaimState.isStale && reclaimState.guardToken) {
      // 若 reclaim guard 持有者意外崩溃，其他竞争者核对此前检查的 guardToken 安全清理
      safeRemoveStaleReclaimGuard(reclaimPath, reclaimState.guardToken);
    }

    // 尝试常规获取新主锁
    try {
      fs.mkdirSync(lockPath, { mode: 0o700 });

      writePrimaryLockMetadata(lockPath, content);

      // 再次确认在此窗口期内是否有他人持有活跃 reclaim guard
      const postCheck = checkReclaimGuard(reclaimPath, 1000);
      if (postCheck.active && postCheck.holderPid !== currentPid) {
        // 仅当锁目录中包含自身创建的 sessionToken 与 lockToken 时安全回滚，杜绝误删他人新锁
        safeRollbackLock(lockPath, sessionToken, lockToken);
        if (Date.now() >= deadline) {
          throwLockError(messages.timeoutAcquireBlockedByGuard(postCheck.holderPid));
        }
        sleepSync(Math.min(50, Math.max(1, deadline - Date.now())));
        continue;
      }

      return onAcquired();
    } catch (err: any) {
      if (err && (err.code === "EEXIST" || err.code === "ENOENT")) {
        const lockState = readLockWithGracePeriod(lockPath, 3000, deadline);

        if (!lockState.exists) {
          if (Date.now() >= deadline) {
            throwLockError(messages.timeoutAcquire());
          }
          continue;
        }

        if (lockState.inGracePeriod) {
          if (Date.now() >= deadline) {
            throwLockError(messages.timeoutGracePeriod());
          }
          sleepSync(Math.min(50, Math.max(1, deadline - Date.now())));
          continue;
        }

        if (lockState.info) {
          assertStaleHolderReclaimable(lockState.info);
        }

        const staleSessionToken = lockState.info?.sessionToken;
        const staleLockToken = lockState.info?.lockToken;
        const guardToken = randomUUID();
        // 当识别到主锁为陈旧锁时，竞争者必须先原子竞争获取 reclaim guard
        const acquiredReclaim = tryAcquireReclaimGuard(reclaimPath, currentPid, guardToken);
        if (!acquiredReclaim) {
          const currentReclaim = checkReclaimGuard(reclaimPath, 1000);
          if (currentReclaim.isStale && currentReclaim.guardToken) {
            safeRemoveStaleReclaimGuard(reclaimPath, currentReclaim.guardToken);
          }
          if (Date.now() >= deadline) {
            throwLockError(messages.timeoutGuardContention());
          }
          sleepSync(Math.min(50, Math.max(1, deadline - Date.now())));
          continue;
        }

        // 仅成功获取 reclaim guard 的唯一胜利者获准执行：
        // 复核主锁陈旧性 -> 隔离/清理陈旧锁 -> 原子创建新主锁并写入自身元数据 -> 清理 reclaim guard
        try {
          const verifyReclaimOwnership = (): boolean => {
            const ownGuard = checkReclaimGuard(reclaimPath, 1000);
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
              throwLockError(messages.timeoutAcquire());
            }
            sleepSync(Math.min(50, Math.max(1, deadline - Date.now())));
            continue;
          }

          // 复核主锁陈旧性
          const recheckState = readLockWithGracePeriod(lockPath, 1000, deadline);
          if (recheckState.exists) {
            if (recheckState.inGracePeriod) {
              if (Date.now() >= deadline) {
                throwLockError(messages.timeoutGracePeriod());
              }
              sleepSync(Math.min(50, Math.max(1, deadline - Date.now())));
              continue;
            }
            if (recheckState.info) {
              assertStaleHolderReclaimable(recheckState.info);
            }

            // 隔离并核验清理陈旧主锁（验证 sessionToken 一致，若已被他人占用则恢复原位）
            const cleaned = safeQuarantineStaleLock(
              lockPath,
              recheckState.info?.sessionToken ?? staleSessionToken,
              recheckState.info?.lockToken ?? staleLockToken
            );
            if (!cleaned) {
              if (Date.now() >= deadline) {
                throwLockError(messages.timeoutReclaimStale());
              }
              continue;
            }
          }

          // 后置复核：在清理陈旧主锁之后、创建新主锁之前，再次核验 reclaim guard 所有权
          // 若守卫在此期间失窃，严禁继续创建新主锁，立即退出重试
          if (!verifyReclaimOwnership()) {
            if (Date.now() >= deadline) {
              throwLockError(messages.timeoutAcquire());
            }
            sleepSync(Math.min(50, Math.max(1, deadline - Date.now())));
            continue;
          }

          // 原子创建新主锁并写入自身元数据（严格遵守 deadline，并在每次重试检查时间窗口）
          let created = false;
          for (let attempt = 0; attempt < 40; attempt++) {
            try {
              fs.mkdirSync(lockPath, { mode: 0o700 });
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
              throwLockError(messages.timeoutCreate());
            }
            continue;
          }

          writePrimaryLockMetadata(lockPath, content);

          // 后置复核：新主锁创建完成后、返回之前再次核验 reclaim guard 所有权
          // 若守卫在创建新主锁期间失窃，说明存在并发仲裁漂移，严禁生效并安全回滚自身主锁
          if (!verifyReclaimOwnership()) {
            safeRollbackLock(lockPath, sessionToken, lockToken);
            if (Date.now() >= deadline) {
              throwLockError(messages.timeoutAcquire());
            }
            sleepSync(Math.min(50, Math.max(1, deadline - Date.now())));
            continue;
          }

          return onAcquired();
        } finally {
          // 清理自身持有的 reclaim guard（必须核对自身 guardToken）
          safeRemoveStaleReclaimGuard(reclaimPath, guardToken);
        }
      }
      throw err;
    }
  }
}
