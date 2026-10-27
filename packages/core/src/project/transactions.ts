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
  acquireFileLockSync,
  isLockHeld,
  safeReleaseFileLockSync,
} from "../storage/file-lock";
import { isProcessAlive } from "../utils";
import { ActionDockError, PROJECT_BUSY, PROJECT_RECOVERY_REQUIRED } from "../errors";
import { LOCKFILE_NAME } from "./lockfile";
import { MANIFEST_FILE_NAME } from "./manifest";
import { runPackageManager } from "./package-manager";

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
 * 安全释放工程主锁。
 */
export function safeReleaseProjectLock(
  lockPath: string,
  expectedSessionToken?: string,
  expectedLockToken?: string
): void {
  safeReleaseFileLockSync(lockPath, expectedLockToken, expectedSessionToken);
}

/**
 * 检查项目修改锁 .actiondock/project.lock 是否存在且持有者 PID 处于存活状态。
 *
 * @param projectRoot 项目根目录
 * @param excludeSelf 是否排除当前进程本身（默认为 true，即仅当其他活跃进程持锁时判定为锁被占用）
 */
export function isProjectLockHeld(projectRoot: string, excludeSelf = true): boolean {
  const lockPath = join(projectRoot, ".actiondock", LOCK_DIR_NAME);
  return isLockHeld(lockPath, excludeSelf);
}

/**
 * 获取工程修改排他锁（.actiondock/project.lock）。
 * 基于统一轻量文件锁原语实现，非阻塞且支持原子抢占与崩溃恢复。
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

  const lockPath = join(metaDir, LOCK_DIR_NAME);
  const sessionToken = options.sessionToken || randomUUID();
  const lockToken = randomUUID();
  const lockData = {
    pid: process.pid,
    sessionToken,
    lockToken,
    createdAt: Date.now(),
  };

  const handle = acquireFileLockSync(lockPath, {
    metadata: lockData,
    createLockError() {
      return new ActionDockError(
        PROJECT_BUSY,
        `PROJECT_BUSY: Project modification lock is held by another process. Another command is running in ${projectRoot}.`
      );
    },
    assertHolderReclaimable(info) {
      const holderPid = info.pid as number | undefined;
      if (holderPid && isProcessAlive(holderPid)) {
        throw new ActionDockError(
          PROJECT_BUSY,
          `PROJECT_BUSY: Project modification lock is held by PID ${holderPid}. Another command is running in ${projectRoot}.`
        );
      }
    },
  });

  let released = false;
  return () => {
    if (released) return;
    released = true;
    handle.release();
  };
}

/**
 * 依据恢复后的锁文件异步执行禁用安装脚本的冻结安装，使 node_modules 与声明重新一致。
 */
export async function runFrozenInstall(
  projectRoot: string,
  options?: { signal?: AbortSignal } | AbortSignal
): Promise<void> {
  const signal = options instanceof AbortSignal ? options : options?.signal;
  signal?.throwIfAborted();

  if (process.env.ACTIONDOCK_AUTO_INSTALL === "false") {
    return;
  }

  const pkgJsonPath = join(projectRoot, "package.json");
  if (!existsSync(pkgJsonPath)) {
    return;
  }

  const hasBunLock = existsSync(join(projectRoot, "bun.lock")) || existsSync(join(projectRoot, "bun.lockb"));
  const hasNpmLock = existsSync(join(projectRoot, "package-lock.json")) || existsSync(join(projectRoot, "npm-shrinkwrap.json"));

  let pm: "npm" | "bun" = "npm";
  let args: string[] = ["install", "--ignore-scripts"];

  if (hasBunLock) {
    pm = "bun";
    args = ["install", "--frozen-lockfile", "--ignore-scripts"];
  } else if (hasNpmLock) {
    pm = "npm";
    args = ["ci", "--ignore-scripts"];
  }

  const env: Record<string, string | undefined> = {
    ...process.env,
    npm_config_allow_scripts: "",
    NPM_CONFIG_ALLOW_SCRIPTS: "",
    npm_config_ignore_scripts: "true",
    NPM_CONFIG_IGNORE_SCRIPTS: "true",
  };

  let proc;
  try {
    proc = await runPackageManager(pm, args, {
      cwd: projectRoot,
      env,
      signal,
    });
  } catch (err: any) {
    if (signal?.aborted || err?.name === "AbortError") {
      throw err;
    }
    const errorMsg = err?.message || "Unknown error";
    throw new ActionDockError(
      PROJECT_RECOVERY_REQUIRED,
      `PROJECT_RECOVERY_REQUIRED: Frozen install failed during recovery in ${projectRoot}: ${errorMsg}`,
      { stage: "recovery-install", projectRoot, manager: pm, cause: err }
    );
  }

  if (proc.status !== 0) {
    const errorMsg = (proc.stderr || proc.stdout || "Unknown error").trim();
    throw new ActionDockError(
      PROJECT_RECOVERY_REQUIRED,
      `PROJECT_RECOVERY_REQUIRED: Frozen install failed during recovery in ${projectRoot}: ${errorMsg}`,
      { stage: "recovery-install", projectRoot, manager: pm, status: proc.status, stderr: proc.stderr, stdout: proc.stdout }
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
        rmSync(txDir, { recursive: true, force: true });
      } finally {
        releaseLock();
      }
    };

    const rollback = async (options?: { frozenInstall?: boolean }): Promise<void> => {
      if (isFinalized) return;
      isFinalized = true;

      try {
        for (const rec of fileRecords) {
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
          await runFrozenInstall(projectRoot);
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
 */
export async function recoverPendingTransactions(
  projectRoot: string,
  options?: { frozenInstall?: boolean; allowInstall?: boolean; signal?: AbortSignal }
): Promise<string[]> {
  options?.signal?.throwIfAborted();

  const txBaseDir = join(projectRoot, ".actiondock", "transactions");
  if (!existsSync(txBaseDir)) {
    return [];
  }

  let releaseLock: (() => void) | undefined;
  try {
    releaseLock = acquireProjectLock(projectRoot);
  } catch (err: any) {
    if (err?.code === "PROJECT_BUSY") {
      return [];
    }
    throw err;
  }

  try {
    options?.signal?.throwIfAborted();
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
        options?.signal?.throwIfAborted();

        if (
          options?.frozenInstall !== false &&
          (options?.allowInstall === false || process.env.ACTIONDOCK_AUTO_INSTALL === "false")
        ) {
          throw new ActionDockError(
            PROJECT_RECOVERY_REQUIRED,
            `PROJECT_RECOVERY_REQUIRED: Project at '${projectRoot}' has pending transactions requiring recovery install, but installation is disabled (--no-install or ACTIONDOCK_AUTO_INSTALL=false).`
          );
        }

        const snapshotDir = join(txDir, "snapshot");
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
          await runFrozenInstall(projectRoot, { signal: options?.signal });
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
    releaseLock?.();
  }
}
