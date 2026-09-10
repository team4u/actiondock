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
function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * 获取工程修改排他锁文件（.actiondock/project.lock）。
 * 防止并发命令交叉写文件导致损坏。
 */
export function acquireProjectLock(projectRoot: string): () => void {
  const metaDir = join(projectRoot, ".actiondock");
  if (!existsSync(metaDir)) {
    mkdirSync(metaDir, { recursive: true });
  }

  const lockPath = join(metaDir, "project.lock");

  if (existsSync(lockPath)) {
    try {
      const lockData = JSON.parse(readFileSync(lockPath, "utf-8"));
      if (lockData.pid && isPidAlive(lockData.pid)) {
        throw new Error(
          `Project modification lock is held by PID ${lockData.pid}. Another command is running in ${projectRoot}.`
        );
      }
    } catch (err: any) {
      if (err.message?.includes("held by PID")) {
        throw err;
      }
    }
    // 旧进程已终止，安全清理过期残留锁
    try {
      unlinkSync(lockPath);
    } catch {
      // 忽略解绑异常
    }
  }

  writeFileSync(
    lockPath,
    JSON.stringify({ pid: process.pid, createdAt: Date.now() }, null, 2),
    "utf-8"
  );

  let released = false;
  return () => {
    if (released) return;
    released = true;
    try {
      if (existsSync(lockPath)) {
        unlinkSync(lockPath);
      }
    } catch {
      // 忽略释放异常
    }
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
}

/**
 * 依据事务日志恢复所有待恢复的悬空事务快照，并在成功后执行冻结安装。
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

  // 清理可能遗留的工程排他锁
  const lockPath = join(projectRoot, ".actiondock", "project.lock");
  if (existsSync(lockPath)) {
    try {
      unlinkSync(lockPath);
    } catch {
      // 忽略解绑异常
    }
  }

  return recoveredIds;
}
