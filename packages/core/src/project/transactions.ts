import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import {
  acquireDirectoryLock,
  checkReclaimGuard,
  cleanStaleQuarantines,
  isProcessAlive,
  parseQuarantineTimestamp as parseQuarantineTimestampCore,
  readLockWithGracePeriod,
  safeReleaseLock as coreSafeReleaseLock,
  safeRemoveStaleReclaimGuard,
  safeRollbackLock,
} from "../storage/lock-core";
import { ActionDockError, PROJECT_BUSY, PROJECT_RECOVERY_REQUIRED } from "../errors";
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

const LOCK_DIR_NAME = "project.lock";

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
  return isProcessAlive(pid);
}

/**
 * 从工程锁隔离或回滚临时目录名称中解析操作者 PID 与隔离生成时间戳。
 * 命名规范：*.(quarantine|rollback|release).<pid>.<timestamp>.<uuid> 或 *.orphan.<timestamp>.<uuid>
 */
export function parseProjectQuarantineTimestamp(entryName: string): {
  operatorPid?: number;
  timestamp?: number;
} {
  return parseQuarantineTimestampCore(entryName);
}

export const parseQuarantineTimestamp = parseProjectQuarantineTimestamp;

/**
 * 安全清理陈旧接管守卫（reclaim guard）。
 * 采用原子重命名检疫并严格核对 guardToken 与持有者存活状态，确保仅删除目标陈旧 guard，严禁误删活跃守卫或并发新守卫。
 *
 * @param reclaimPath 目标守卫路径
 * @param expectedGuardToken 预期持有的守卫令牌（必填，拒绝未指定令牌的盲目清理）
 */
export function safeRemoveStaleProjectReclaimGuard(
  reclaimPath: string,
  expectedGuardToken: string
): void {
  safeRemoveStaleReclaimGuard(reclaimPath, expectedGuardToken);
}

/**
 * 安全回滚当前进程创建的工程修改锁。
 * 优先核对 lockToken，回退核对 sessionToken，防止误删接管者或并发新锁。
 */
export function safeRollbackProjectLock(
  lockPath: string,
  expectedSessionToken: string,
  expectedLockToken?: string
): void {
  safeRollbackLock(lockPath, expectedSessionToken, expectedLockToken);
}

/**
 * 清理过期的工程锁隔离目录（GC 回收机制）。
 * 实施分流存活校验，防止误删活跃持锁者与回滚中目录，同时防止孤儿目录无限泄漏，语义由目录锁内核统一承载。
 */
export function cleanStaleProjectQuarantines(
  parentDir: string,
  basePrefix: string,
  maxAgeMs = 10000,
  deadline?: number
): void {
  cleanStaleQuarantines(parentDir, basePrefix, maxAgeMs, deadline);
}

/**
 * 安全释放工程主锁。
 * 仅当锁目录中持有当前 lockToken / sessionToken 时才删除，杜绝删除他人新锁。
 * 释放后同步触发一轮工程锁隔离目录 GC。
 */
export function safeReleaseProjectLock(
  lockPath: string,
  expectedSessionToken: string,
  expectedLockToken?: string
): void {
  coreSafeReleaseLock(lockPath, expectedSessionToken, expectedLockToken, { gcAfterRelease: true });
}

/**
 * 检查项目修改锁 .actiondock/project.lock 是否存在且持有者 PID 处于存活状态。
 *
 * @param projectRoot 项目根目录
 * @param excludeSelf 是否排除当前进程本身（默认为 true，即仅当其他活跃进程持锁时判定为锁被占用）
 */
export function isProjectLockHeld(projectRoot: string, excludeSelf = true): boolean {
  const lockPath = join(projectRoot, ".actiondock", LOCK_DIR_NAME);
  const reclaimPath = `${lockPath}.reclaim`;
  if (existsSync(reclaimPath)) {
    const reclaimState = checkReclaimGuard(reclaimPath, 1000);
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
    const lockState = readLockWithGracePeriod(lockPath, 3000);
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
      return isProcessAlive(lockState.info.pid);
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
  const timeoutMs = options.acquireTimeoutMs ?? 5000;
  const metaDir = join(projectRoot, ".actiondock");
  if (!existsSync(metaDir)) {
    mkdirSync(metaDir, { recursive: true });
  }

  const lockPath = join(metaDir, LOCK_DIR_NAME);
  const sessionToken = options.sessionToken || randomUUID();
  const lockToken = randomUUID();
  const currentPid = process.pid;
  const lockData = {
    pid: currentPid,
    sessionToken,
    lockToken,
    createdAt: Date.now(),
  };
  const content = JSON.stringify(lockData, null, 2);

  acquireDirectoryLock({
    lockPath,
    parentDir: metaDir,
    basePrefix: LOCK_DIR_NAME,
    metadataContent: content,
    sessionToken,
    lockToken,
    acquireTimeoutMs: options.acquireTimeoutMs,
    createLockError(message) {
      return new ActionDockError(PROJECT_BUSY, message);
    },
    messages: {
      timeoutWaitingReclaimGuard: (holderPid?: number) =>
        `PROJECT_BUSY: Timeout waiting for active reclaim guard (PID ${holderPid ?? "unknown"}) on project '${projectRoot}' after ${timeoutMs}ms`,
      timeoutAcquireBlockedByGuard: (holderPid?: number) =>
        `PROJECT_BUSY: Timeout acquiring project lock on '${projectRoot}' due to active reclaim guard (PID ${holderPid}) after ${timeoutMs}ms`,
      timeoutAcquire: () =>
        `PROJECT_BUSY: Timeout acquiring project lock on '${projectRoot}' after ${timeoutMs}ms`,
      timeoutGracePeriod: () =>
        `PROJECT_BUSY: Timeout waiting for project lock grace period on '${projectRoot}' after ${timeoutMs}ms`,
      timeoutGuardContention: () =>
        `PROJECT_BUSY: Timeout contending for project reclaim guard on '${projectRoot}' after ${timeoutMs}ms`,
      timeoutReclaimStale: () =>
        `PROJECT_BUSY: Timeout reclaiming stale project lock on '${projectRoot}' after ${timeoutMs}ms`,
      timeoutCreate: () =>
        `PROJECT_BUSY: Timeout creating project lock on '${projectRoot}' after ${timeoutMs}ms`,
    },
    assertStaleHolderReclaimable(info) {
      const holderPid = info.pid as number;
      if (isProcessAlive(holderPid)) {
        throw new ActionDockError(
          PROJECT_BUSY,
          `PROJECT_BUSY: Project modification lock is held by PID ${holderPid}. Another command is running in ${projectRoot}.`
        );
      }
    },
    onAcquired: () => true,
  });

  let released = false;
  return () => {
    if (released) return;
    released = true;
    safeReleaseProjectLock(lockPath, sessionToken, lockToken);
    cleanStaleQuarantines(metaDir, LOCK_DIR_NAME);
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
    env: {
      ...process.env,
      // 项目级安装禁用 npm 的 allow-scripts 白名单机制，避免用户全局 .npmrc
      // 的 allow-scripts 约束触发 EALLOWSCRIPTS 导致恢复失败（本安装已带 --ignore-scripts）
      npm_config_allow_scripts: "",
      NPM_CONFIG_ALLOW_SCRIPTS: "",
    },
  });

  if (proc.status !== 0) {
    const errorMsg = proc.stderr?.toString() || proc.stdout?.toString() || "Unknown error";
    throw new ActionDockError(
      PROJECT_RECOVERY_REQUIRED,
      `PROJECT_RECOVERY_REQUIRED: Frozen install failed during recovery in ${projectRoot}: ${errorMsg}`
    );
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
    if (err?.code === "PROJECT_BUSY") {
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
