import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  closeSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  rmSync,
  unlinkSync,
  writeFileSync,
  writeSync,
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
 * 检查项目修改锁 .actiondock/project.lock 是否存在且持有者 PID 处于存活状态。
 *
 * @param projectRoot 项目根目录
 * @param excludeSelf 是否排除当前进程本身（默认为 true，即仅当其他活跃进程持锁时判定为锁被占用）
 */
export function isProjectLockHeld(projectRoot: string, excludeSelf = true): boolean {
  const lockPath = join(projectRoot, ".actiondock", "project.lock");
  if (!existsSync(lockPath)) {
    return false;
  }
  try {
    const raw = readFileSync(lockPath, "utf-8");
    const lockData = JSON.parse(raw);
    if (lockData && typeof lockData.pid === "number") {
      if (excludeSelf && lockData.pid === process.pid) {
        return false;
      }
      return isPidAlive(lockData.pid);
    }
  } catch {
    // 忽略读取解析异常
  }
  return false;
}

/**
 * 获取工程修改排他锁文件（.actiondock/project.lock）。
 * 采用 openSync("wx") 原子排他创建、持有 sessionToken 与 PID、stale 锁检测重试循环与基于 sessionToken 的释放函数。
 * 防止并发命令交叉写文件导致损坏。
 *
 * @param projectRoot 项目根目录
 * @param options 锁配置参数
 */
export function acquireProjectLock(
  projectRoot: string,
  options: { sessionToken?: string } = {}
): () => void {
  const metaDir = join(projectRoot, ".actiondock");
  if (!existsSync(metaDir)) {
    mkdirSync(metaDir, { recursive: true });
  }

  const lockPath = join(metaDir, "project.lock");
  const takeoverPath = `${lockPath}.takeover`;
  const sessionToken = options.sessionToken || randomUUID();
  const currentPid = process.pid;
  const lockData = {
    pid: currentPid,
    sessionToken,
    createdAt: Date.now(),
  };
  const content = JSON.stringify(lockData, null, 2);

  while (true) {
    try {
      const fd = openSync(lockPath, "wx", 0o600);
      try {
        writeSync(fd, content);
      } finally {
        closeSync(fd);
      }
      break;
    } catch (err: any) {
      if (err && err.code === "EEXIST") {
        let existing: { pid?: number; sessionToken?: string; createdAt?: number } | undefined;
        try {
          const raw = readFileSync(lockPath, "utf-8");
          if (raw.trim().length > 0) {
            existing = JSON.parse(raw);
          }
        } catch {
          // 损坏或并发写入中的锁文件
        }

        if (existing && typeof existing.pid === "number") {
          if (isPidAlive(existing.pid)) {
            throw new Error(
              `Project modification lock is held by PID ${existing.pid}. Another command is running in ${projectRoot}.`
            );
          }
        }

        // 持有者 PID 已死亡（或损坏的锁文件），属于陈旧锁，进行原子接管竞争
        let takeoverFd: number | null = null;
        try {
          takeoverFd = openSync(takeoverPath, "wx", 0o600);
        } catch (takeoverErr: any) {
          if (takeoverErr && takeoverErr.code === "EEXIST") {
            try {
              const raw = readFileSync(takeoverPath, "utf-8");
              if (raw.trim().length > 0) {
                const info = JSON.parse(raw);
                if (info && typeof info.pid === "number" && !isPidAlive(info.pid)) {
                  unlinkSync(takeoverPath);
                }
              }
            } catch {
              // 忽略陈旧接管锁清理异常
            }
          }
          continue;
        }

        try {
          try {
            writeSync(takeoverFd, JSON.stringify({ pid: currentPid, createdAt: Date.now() }));
          } catch {
            // 忽略写入异常
          }

          let recheck: { pid?: number; sessionToken?: string } | undefined;
          try {
            const recheckRaw = readFileSync(lockPath, "utf-8");
            if (recheckRaw.trim().length > 0) {
              recheck = JSON.parse(recheckRaw);
            }
          } catch {
            // 忽略二次读取异常
          }

          if (recheck && typeof recheck.pid === "number" && isPidAlive(recheck.pid)) {
            throw new Error(
              `Project modification lock is held by PID ${recheck.pid}. Another command is running in ${projectRoot}.`
            );
          }

          try {
            unlinkSync(lockPath);
          } catch {
            // 忽略解绑异常
          }
        } finally {
          try {
            unlinkSync(takeoverPath);
          } catch {
            // 忽略解绑异常
          }
          closeSync(takeoverFd);
        }

        continue;
      }
      throw err;
    }
  }

  let released = false;
  return () => {
    if (released) return;
    released = true;
    try {
      if (existsSync(lockPath)) {
        const raw = readFileSync(lockPath, "utf-8");
        const onDisk = JSON.parse(raw);
        if (onDisk && onDisk.sessionToken === sessionToken) {
          unlinkSync(lockPath);
        }
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
  } catch {
    // 获取失败（有活跃进程在执行），安全退出并返回空数组
    return [];
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
