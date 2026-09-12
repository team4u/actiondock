import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs, {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

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
 * 获取项目排他锁路径最近一次修改时间戳。
 */
function getProjectLockMtimeMs(lockPath: string, isDir: boolean): number {
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
 * 读取项目排他锁元数据并执行宽限期检测。
 */
function readProjectLockWithGracePeriod(
  lockPath: string,
  gracePeriodMs = 3000
): {
  exists: boolean;
  isDir: boolean;
  info?: { pid?: number; sessionToken?: string; createdAt?: number };
  inGracePeriod: boolean;
} {
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

  const tryParse = (): { pid?: number; sessionToken?: string; createdAt?: number } | undefined => {
    try {
      if (existsSync(metaPath)) {
        const raw = readFileSync(metaPath, "utf-8");
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

  const mtime = getProjectLockMtimeMs(lockPath, isDir);
  const age = Date.now() - mtime;
  if (age < gracePeriodMs) {
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

    const currentAge = Date.now() - getProjectLockMtimeMs(lockPath, isDir);
    if (currentAge < gracePeriodMs) {
      return { exists: true, isDir, inGracePeriod: true };
    }
  }

  return { exists: true, isDir, inGracePeriod: false };
}
import { LOCKFILE_NAME } from "./lockfile";
import { MANIFEST_FILE_NAME } from "./manifest";

export const SNAPSHOT_TRACKED_FILES = [
  "package.json",
  MANIFEST_FILE_NAME,
  LOCKFILE_NAME,
  "package-lock.json",
  "npm-shrinkwrap.json",
  "bun.lock",
  "bun.lockb",
  "pnpm-lock.yaml",
  "yarn.lock",
] as const;

export interface TransactionFileRecord {
  name: string;
  existed: boolean;
}

export interface TransactionMetadata {
  id: string;
  status: "pending" | "committed" | "rolled_back";
  createdAt: number;
  description?: string;
  files: TransactionFileRecord[];
}

export interface ProjectTransaction {
  id: string;
  projectRoot: string;
  description?: string;
  commit(): Promise<void>;
  rollback(options?: { frozenInstall?: boolean }): Promise<void>;
  releaseLock(): void;
}

/**
 * 检查当前进程 PID 是否处于活跃运行状态。
 */
export function isPidAlive(pid: number): boolean {
  if (typeof pid !== "number" || isNaN(pid) || pid <= 0) {
    return false;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch (err: any) {
    return err?.code === "EPERM";
  }
}

/**
 * 检查接管守卫（reclaim guard）目录状态。
 *
 * - 若目录不存在：返回非活跃。
 * - 若处于宽限期内或持有者存活：返回活跃，禁止抢先创建主锁。
 * - 若持有者已死亡且超过宽限期：返回陈旧，可供安全清理。
 */
function checkProjectReclaimGuard(
  reclaimPath: string,
  gracePeriodMs = 1000,
  maxGuardAgeMs = 5000
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
        const raw = readFileSync(metaPath, "utf-8");
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
    const createdAt = typeof info.createdAt === "number" ? info.createdAt : getProjectLockMtimeMs(reclaimPath, isDir);
    const age = Date.now() - createdAt;

    if (isPidAlive(info.pid)) {
      if (age > maxGuardAgeMs) {
        // 即使持有者 PID 存活，若接管守卫持有时间超出最大阈值（如接管者被挂起或死循环），判定为陈旧守卫
        return { exists: true, active: false, isStale: true, holderPid: info.pid, guardToken };
      }
      return { exists: true, active: true, isStale: false, holderPid: info.pid, guardToken };
    }

    if (age < gracePeriodMs) {
      return { exists: true, active: true, isStale: false, holderPid: info.pid, guardToken };
    }
    return { exists: true, active: false, isStale: true, holderPid: info.pid, guardToken };
  }

  const mtime = getProjectLockMtimeMs(reclaimPath, isDir);
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
function tryAcquireProjectReclaimGuard(reclaimPath: string, pid: number, guardToken: string): boolean {
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
      "utf-8"
    );
    renameSync(tmpPath, metaPath);
    return true;
  } catch {
    return false;
  }
}

/**
 * 安全清理陈旧接管守卫（reclaim guard）。
 * 采用原子重命名检疫并核对 guardToken，确保仅删除目标陈旧 guard，严禁误删并发新守卫。
 */
export function safeRemoveStaleProjectReclaimGuard(
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
      const raw = readFileSync(metaPath, "utf-8");
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
        const raw = readFileSync(quarantinedMetaPath, "utf-8");
        const parsed = JSON.parse(raw);
        actualGuardToken = parsed?.guardToken;
      } catch {}
    }

    if (expectedGuardToken !== actualGuardToken) {
      // 并非此前检查的陈旧 guard（已被并发者替换），尝试恢复原位！
      try {
        fs.renameSync(quarantinePath, reclaimPath);
      } catch {
        // 恢复原位失败，严禁调用 rmSync 误删并发活跃守卫
      }
      return;
    }

    fs.rmSync(quarantinePath, { recursive: true, force: true });
  } catch {
    try {
      fs.renameSync(quarantinePath, reclaimPath);
    } catch {
      // 恢复原位失败，严禁调用 rmSync 误删并发活跃守卫
    }
  }
}

/**
 * 安全回滚当前进程创建的工程修改锁。
 * 仅当锁目录中的 sessionToken 与自身一致时才删除，防止误删接管者或并发新锁。
 */
function safeRollbackProjectLock(lockPath: string, expectedSessionToken: string): void {
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
        const raw = readFileSync(metaPath, "utf-8");
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
      renameSync(quarantinePath, lockPath);
    } catch {}
  }
}

/**
 * 安全隔离并清理陈旧工程主锁。
 * 隔离后复核元数据，确保仅删除目标陈旧锁，若已被更新或仍有存活所有者则恢复原位。
 */
function safeQuarantineStaleProjectLock(
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
        const raw = readFileSync(metaPath, "utf-8");
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

    if (typeof actualPid === "number" && isPidAlive(actualPid)) {
      // 持有者实际仍存活，恢复原位
      try {
        renameSync(quarantinePath, lockPath);
      } catch {}
      return false;
    }

    rmSync(quarantinePath, { recursive: true, force: true });
    return true;
  } catch {
    try {
      renameSync(quarantinePath, lockPath);
    } catch {}
    return false;
  }
}

/**
 * 安全释放工程主锁。
 * 仅当锁目录中持有当前 sessionToken 时才删除，杜绝删除他人新锁。
 */
function safeReleaseProjectLock(lockPath: string, expectedSessionToken: string): void {
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
        const raw = readFileSync(metaPath, "utf-8");
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
      renameSync(quarantinePath, lockPath);
    } catch {}
  }
}

/**
 * 检查项目修改锁 .actiondock/project.lock 是否存在且持有者 PID 处于存活状态。
 *
 * @param projectRoot 项目根目录
 * @param excludeSelf 是否排除当前进程本身（默认为 true，即仅当其他活跃进程持锁时判定为锁被占用）
 */
export function isProjectLockHeld(projectRoot: string, excludeSelf = true): boolean {
  const lockPath = join(projectRoot, ".actiondock", "project.lock");
  const reclaimPath = `${lockPath}.reclaim`;
  if (existsSync(reclaimPath)) {
    const reclaimState = checkProjectReclaimGuard(reclaimPath, 1000);
    if (reclaimState.active) {
      if (!excludeSelf || reclaimState.holderPid !== process.pid) {
        return true;
      }
    }
  }

  if (!existsSync(lockPath)) {
    return false;
  }
  try {
    const lockState = readProjectLockWithGracePeriod(lockPath, 3000);
    if (!lockState.exists) {
      return false;
    }
    if (lockState.inGracePeriod) {
      return true;
    }
    if (lockState.info && typeof lockState.info.pid === "number") {
      if (excludeSelf && lockState.info.pid === process.pid) {
        return false;
      }
      return isPidAlive(lockState.info.pid);
    }
  } catch {
    // 忽略读取解析异常
  }
  return false;
}

/**
 * 获取工程修改排他锁（.actiondock/project.lock）。
 * 引入所有竞争者均遵守的原子 reclaim guard 机制（project.lock.reclaim）。
 * 采用 mkdirSync 原子排他目录创建、renameSync 元数据写入、宽限期重试检测与基于 sessionToken 的释放函数。
 * 避免空文件窗口与 truncate。
 *
 * @param projectRoot 项目根目录
 * @param options 锁配置参数
 */
export function acquireProjectLock(
  projectRoot: string,
  options: { sessionToken?: string; acquireTimeoutMs?: number } = {}
): () => void {
  const metaDir = join(projectRoot, ".actiondock");
  if (!existsSync(metaDir)) {
    mkdirSync(metaDir, { recursive: true });
  }

  const lockPath = join(metaDir, "project.lock");
  const reclaimPath = `${lockPath}.reclaim`;
  const sessionToken = options.sessionToken || randomUUID();
  const currentPid = process.pid;
  const timeoutMs = options.acquireTimeoutMs ?? 5000;
  const deadline = Date.now() + timeoutMs;
  const lockData = {
    pid: currentPid,
    sessionToken,
    createdAt: Date.now(),
  };
  const content = JSON.stringify(lockData, null, 2);

  while (true) {
    // 1. 当竞争者尝试创建新主锁时，若检测到 reclaim 目录存在且处于宽限期内或持有者存活，必须等待，禁止在他人正在接管/验证期间抢先创建主锁
    const reclaimState = checkProjectReclaimGuard(reclaimPath, 1000);
    if (reclaimState.active) {
      if (Date.now() >= deadline) {
        const busyErr: any = new Error(
          `PROJECT_BUSY: Timeout waiting for active reclaim guard (PID ${reclaimState.holderPid ?? "unknown"}) on project '${projectRoot}' after ${timeoutMs}ms`
        );
        busyErr.code = "PROJECT_BUSY";
        throw busyErr;
      }
      sleepSync(50);
      continue;
    }
    if (reclaimState.isStale) {
      // 若 reclaim guard 持有者意外崩溃，其他竞争者核对此前检查的 guardToken 安全清理
      safeRemoveStaleProjectReclaimGuard(reclaimPath, reclaimState.guardToken);
    }

    // 2. 尝试常规获取新主锁
    try {
      fs.mkdirSync(lockPath, { mode: 0o700 });

      const metaFile = join(lockPath, "metadata.json");
      const tmpFile = join(
        lockPath,
        `metadata.json.tmp.${currentPid}.${randomUUID().slice(0, 8)}`
      );
      writeFileSync(tmpFile, content, "utf-8");
      renameSync(tmpFile, metaFile);

      // 再次确认在此窗口期内是否有他人持有活跃 reclaim guard
      const postCheck = checkProjectReclaimGuard(reclaimPath, 1000);
      if (postCheck.active && postCheck.holderPid !== currentPid) {
        // 仅当锁目录中包含自身创建的 sessionToken 时安全回滚，杜绝误删他人新锁
        safeRollbackProjectLock(lockPath, sessionToken);
        if (Date.now() >= deadline) {
          const busyErr: any = new Error(
            `PROJECT_BUSY: Timeout acquiring project lock on '${projectRoot}' due to active reclaim guard (PID ${postCheck.holderPid}) after ${timeoutMs}ms`
          );
          busyErr.code = "PROJECT_BUSY";
          throw busyErr;
        }
        sleepSync(50);
        continue;
      }

      break;
    } catch (err: any) {
      if (err && (err.code === "EEXIST" || err.code === "ENOENT")) {
        const lockState = readProjectLockWithGracePeriod(lockPath, 3000);

        if (!lockState.exists) {
          if (Date.now() >= deadline) {
            const busyErr: any = new Error(
              `PROJECT_BUSY: Timeout acquiring project lock on '${projectRoot}' after ${timeoutMs}ms`
            );
            busyErr.code = "PROJECT_BUSY";
            throw busyErr;
          }
          continue;
        }

        if (lockState.inGracePeriod) {
          if (Date.now() >= deadline) {
            const busyErr: any = new Error(
              `PROJECT_BUSY: Timeout waiting for project lock grace period on '${projectRoot}' after ${timeoutMs}ms`
            );
            busyErr.code = "PROJECT_BUSY";
            throw busyErr;
          }
          sleepSync(50);
          continue;
        }

        if (lockState.info && typeof lockState.info.pid === "number") {
          if (isPidAlive(lockState.info.pid)) {
            const busyErr: any = new Error(
              `PROJECT_BUSY: Project modification lock is held by PID ${lockState.info.pid}. Another command is running in ${projectRoot}.`
            );
            busyErr.code = "PROJECT_BUSY";
            throw busyErr;
          }
        }

        const staleSessionToken = lockState.info?.sessionToken;
        const guardToken = randomUUID();
        // 当识别到主锁为陈旧锁时，竞争者必须先原子竞争获取 reclaim guard
        const acquiredReclaim = tryAcquireProjectReclaimGuard(reclaimPath, currentPid, guardToken);
        if (!acquiredReclaim) {
          const currentReclaim = checkProjectReclaimGuard(reclaimPath, 1000);
          if (currentReclaim.isStale) {
            safeRemoveStaleProjectReclaimGuard(reclaimPath, currentReclaim.guardToken);
          }
          if (Date.now() >= deadline) {
            const busyErr: any = new Error(
              `PROJECT_BUSY: Timeout contending for project reclaim guard on '${projectRoot}' after ${timeoutMs}ms`
            );
            busyErr.code = "PROJECT_BUSY";
            throw busyErr;
          }
          sleepSync(50);
          continue;
        }

        // 仅成功获取 reclaim guard 的唯一胜利者获准执行：
        // 复核主锁陈旧性 -> 隔离/清理陈旧锁 -> 原子创建新主锁并写入自身元数据 -> 清理 reclaim guard
        try {
          // 自检校验自身守卫：验证自身 guardToken 依然有效且持有者为自身 PID
          // 若已被抢占或不匹配，立即退出当前接管并 continue 重试，杜绝在守卫已失窃的情况下操作主锁
          const ownGuard = checkProjectReclaimGuard(reclaimPath, 1000);
          if (!ownGuard.active || ownGuard.holderPid !== currentPid || ownGuard.guardToken !== guardToken) {
            if (Date.now() >= deadline) {
              const busyErr: any = new Error(
                `PROJECT_BUSY: Timeout acquiring project lock on '${projectRoot}' after ${timeoutMs}ms`
              );
              busyErr.code = "PROJECT_BUSY";
              throw busyErr;
            }
            sleepSync(50);
            continue;
          }

          // 1. 复核主锁陈旧性
          const recheckState = readProjectLockWithGracePeriod(lockPath, 1000);
          if (recheckState.exists) {
            if (recheckState.inGracePeriod) {
              if (Date.now() >= deadline) {
                const busyErr: any = new Error(
                  `PROJECT_BUSY: Timeout waiting for project lock grace period on '${projectRoot}' after ${timeoutMs}ms`
                );
                busyErr.code = "PROJECT_BUSY";
                throw busyErr;
              }
              sleepSync(50);
              continue;
            }
            if (
              recheckState.info &&
              typeof recheckState.info.pid === "number" &&
              isPidAlive(recheckState.info.pid)
            ) {
              const busyErr: any = new Error(
                `PROJECT_BUSY: Project modification lock is held by PID ${recheckState.info.pid}. Another command is running in ${projectRoot}.`
              );
              busyErr.code = "PROJECT_BUSY";
              throw busyErr;
            }

            // 2. 隔离并核验清理陈旧主锁（验证 sessionToken 一致，若已被他人占用则恢复原位）
            const cleaned = safeQuarantineStaleProjectLock(
              lockPath,
              recheckState.info?.sessionToken ?? staleSessionToken
            );
            if (!cleaned) {
              if (Date.now() >= deadline) {
                const busyErr: any = new Error(
                  `PROJECT_BUSY: Timeout reclaiming stale project lock on '${projectRoot}' after ${timeoutMs}ms`
                );
                busyErr.code = "PROJECT_BUSY";
                throw busyErr;
              }
              continue;
            }
          }

          // 3. 原子创建新主锁并写入自身元数据（严禁在遇到 EEXIST 时盲目 rmSync，等待并发者安全回滚）
          let created = false;
          for (let attempt = 0; attempt < 40; attempt++) {
            try {
              fs.mkdirSync(lockPath, { mode: 0o700 });
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
            if (Date.now() >= deadline) {
              const busyErr: any = new Error(
                `PROJECT_BUSY: Timeout creating project lock on '${projectRoot}' after ${timeoutMs}ms`
              );
              busyErr.code = "PROJECT_BUSY";
              throw busyErr;
            }
            continue;
          }

          const metaFile = join(lockPath, "metadata.json");
          const tmpFile = join(
            lockPath,
            `metadata.json.tmp.${currentPid}.${randomUUID().slice(0, 8)}`
          );
          writeFileSync(tmpFile, content, "utf-8");
          renameSync(tmpFile, metaFile);
          break;
        } finally {
          // 4. 清理 reclaim guard（必须核对自身 guardToken）
          safeRemoveStaleProjectReclaimGuard(reclaimPath, guardToken);
        }
      }
      throw err;
    }
  }

  let released = false;
  return () => {
    if (released) return;
    released = true;
    safeReleaseProjectLock(lockPath, sessionToken);
  };
}

/**
 * 依据恢复后的锁文件执行禁用安装脚本的冻结安装，使 node_modules 与声明重新一致。
 */
export function runFrozenInstall(projectRoot: string): void {
  if (process.env.ACTIONDOCK_AUTO_INSTALL === "false") {
    return;
  }

  const pkgJsonPath = join(projectRoot, "package.json");
  if (!existsSync(pkgJsonPath)) {
    return;
  }

  const hasBunLock = existsSync(join(projectRoot, "bun.lock")) || existsSync(join(projectRoot, "bun.lockb"));
  const hasNpmLock = existsSync(join(projectRoot, "package-lock.json")) || existsSync(join(projectRoot, "npm-shrinkwrap.json"));

  let cmd = "npm";
  let args = ["install", "--ignore-scripts"];

  if (hasBunLock) {
    cmd = "bun";
    args = ["install", "--frozen-lockfile", "--ignore-scripts"];
  } else if (hasNpmLock) {
    cmd = "npm";
    args = ["ci", "--ignore-scripts"];
  }

  try {
    const check = spawnSync(cmd, ["--version"], {
      stdio: "pipe",
      // Windows 兼容：npm 为 .cmd 脚本，无 shell 直接 spawn 必然 ENOENT，
      // 会误判 npm 缺失而把冻结安装降级为普通 install
      shell: process.platform === "win32",
    });
    if (check.status !== 0) {
      cmd = "npm";
      args = ["install", "--ignore-scripts"];
    }
  } catch {
    cmd = "npm";
    args = ["install", "--ignore-scripts"];
  }

  const proc = spawnSync(cmd, args, {
    cwd: projectRoot,
    stdio: "pipe",
    shell: process.platform === "win32",
  });

  if (proc.status !== 0) {
    const errorMsg = proc.stderr?.toString() || proc.stdout?.toString() || "Unknown error";
    const err = new Error(
      `PROJECT_RECOVERY_REQUIRED: Frozen install failed during recovery in ${projectRoot}: ${errorMsg}`
    );
    (err as any).code = "PROJECT_RECOVERY_REQUIRED";
    throw err;
  }
}

/**
 * 检查项目是否存在未完成提交的悬空事务。
 */
export function hasPendingTransactions(projectRoot: string): boolean {
  if (isProjectLockHeld(projectRoot)) {
    return false;
  }

  const txBaseDir = join(projectRoot, ".actiondock", "transactions");
  if (!existsSync(txBaseDir)) {
    return false;
  }

  try {
    const entries = readdirSync(txBaseDir);
    for (const entry of entries) {
      const metaPath = join(txBaseDir, entry, "transaction.json");
      if (existsSync(metaPath)) {
        const raw = readFileSync(metaPath, "utf-8");
        const meta = JSON.parse(raw);
        if (meta.status === "pending") {
          return true;
        }
      }
    }
  } catch {
    return false;
  }

  return false;
}

/**
 * 启动新的工程修改事务快照。
 * 捕获 package.json、actiondock.json、actiondock.lock.json 及各包管理器锁文件当前快照。
 */
export async function beginTransaction(
  projectRoot: string,
  description?: string
): Promise<ProjectTransaction> {
  const releaseLock = acquireProjectLock(projectRoot);
  try {
    const txId = `${Date.now()}-${randomUUID().slice(0, 8)}`;
    const txDir = join(projectRoot, ".actiondock", "transactions", txId);
    const snapshotDir = join(txDir, "snapshot");

    mkdirSync(snapshotDir, { recursive: true });

    const fileRecords: TransactionFileRecord[] = [];

    for (const file of SNAPSHOT_TRACKED_FILES) {
      const srcPath = join(projectRoot, file);
      if (existsSync(srcPath)) {
        const destPath = join(snapshotDir, file);
        copyFileSync(srcPath, destPath);
        fileRecords.push({ name: file, existed: true });
      } else {
        fileRecords.push({ name: file, existed: false });
      }
    }

    const meta: TransactionMetadata = {
      id: txId,
      status: "pending",
      createdAt: Date.now(),
      description,
      files: fileRecords,
    };

    writeFileSync(join(txDir, "transaction.json"), JSON.stringify(meta, null, 2) + "\n", "utf-8");

    let isFinalized = false;

    const commit = async (): Promise<void> => {
      if (isFinalized) return;
      isFinalized = true;

      meta.status = "committed";
      try {
        writeFileSync(join(txDir, "transaction.json"), JSON.stringify(meta, null, 2) + "\n", "utf-8");
        // 成功提交后清理事务目录
        rmSync(txDir, { recursive: true, force: true });
      } finally {
        releaseLock();
      }
    };

    const rollback = async (options?: { frozenInstall?: boolean }): Promise<void> => {
      if (isFinalized) return;
      isFinalized = true;

      try {
        // 逐个恢复快照文件
        for (const rec of fileRecords) {
          const targetPath = join(projectRoot, rec.name);
          const snapPath = join(snapshotDir, rec.name);
          if (rec.existed) {
            if (existsSync(snapPath)) {
              copyFileSync(snapPath, targetPath);
            }
          } else {
            // 原先不存在的文件若在事务中被创建，予以删除
            if (existsSync(targetPath)) {
              unlinkSync(targetPath);
            }
          }
        }

        // 执行冻结安装使 node_modules 与恢复后的声明重新一致
        if (options?.frozenInstall !== false) {
          runFrozenInstall(projectRoot);
        }

        meta.status = "rolled_back";
        writeFileSync(join(txDir, "transaction.json"), JSON.stringify(meta, null, 2) + "\n", "utf-8");
        rmSync(txDir, { recursive: true, force: true });
      } finally {
        releaseLock();
      }
    };

    return {
      id: txId,
      projectRoot,
      description,
      commit,
      rollback,
      releaseLock,
    };
  } catch (err) {
    releaseLock();
    throw err;
  }
}

/**
 * 依据事务日志恢复所有待恢复的悬空事务快照，并在成功后执行冻结安装。
 * 进入恢复前通过 acquireProjectLock 原子获取排他锁，持有锁执行恢复，完成后通过释放函数安全释放锁。
 * 若获取锁失败（已有活跃进程正在执行）则安全退出并返回空数组，杜绝 TOCTOU 竞争。
 * 若冻结安装失败则抛出 PROJECT_RECOVERY_REQUIRED 并阻止 Host 启动。
 */
export async function recoverPendingTransactions(
  projectRoot: string,
  options?: { frozenInstall?: boolean }
): Promise<string[]> {
  const txBaseDir = join(projectRoot, ".actiondock", "transactions");
  if (!existsSync(txBaseDir)) {
    return [];
  }

  let releaseLock: (() => void) | undefined;
  try {
    releaseLock = acquireProjectLock(projectRoot);
  } catch (err: any) {
    if (err?.code === "PROJECT_BUSY" || err?.message?.includes("PROJECT_BUSY")) {
      // 仅当项目锁被其他活跃进程占用时，安全退出并返回空数组
      return [];
    }
    // 底层系统异常（如 EACCES、ENOSPC、ENOENT 等），向外抛出，严禁静默吞掉
    throw err;
  }

  try {
    const recoveredIds: string[] = [];
    const entries = readdirSync(txBaseDir);

    for (const entry of entries) {
      const txDir = join(txBaseDir, entry);
      const metaPath = join(txDir, "transaction.json");
      if (!existsSync(metaPath)) continue;

      let meta: TransactionMetadata;
      try {
        meta = JSON.parse(readFileSync(metaPath, "utf-8"));
      } catch {
        continue;
      }

      if (meta.status === "pending") {
        const snapshotDir = join(txDir, "snapshot");
        // 逐个恢复快照文件
        for (const rec of meta.files) {
          const targetPath = join(projectRoot, rec.name);
          const snapPath = join(snapshotDir, rec.name);
          if (rec.existed) {
            if (existsSync(snapPath)) {
              copyFileSync(snapPath, targetPath);
            }
          } else {
            if (existsSync(targetPath)) {
              unlinkSync(targetPath);
            }
          }
        }

        if (options?.frozenInstall !== false) {
          runFrozenInstall(projectRoot);
        }

        meta.status = "rolled_back";
        try {
          writeFileSync(metaPath, JSON.stringify(meta, null, 2) + "\n", "utf-8");
        } catch {
          // 忽略写入异常
        }
        rmSync(txDir, { recursive: true, force: true });
        recoveredIds.push(meta.id);
      }
    }

    return recoveredIds;
  } finally {
    releaseLock();
  }
}
