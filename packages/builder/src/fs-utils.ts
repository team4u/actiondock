import { cpSync, existsSync, readdirSync, realpathSync, renameSync, rmSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { ACTIONDOCK_VERSION, assertPathWithinRoot } from "@actiondock/core";

/**
 * builder 包内共享的文件系统基础设施。
 * 消除 pack / build / exporter 三个业务模块中成体系的重复实现，
 * 保证目录扫描排序与原子移动等关键行为存在单一事实源。
 */

/**
 * 跨文件系统/分区的原子移动目录辅助函数。
 * 优先 rename，遇到瞬时性错误码按指数退避重试，最终回退为递归复制后删除。
 */
const TRANSIENT_MOVE_ERROR_CODES = new Set(["EPERM", "EBUSY", "EACCES", "ENOTEMPTY"]);
const MOVE_RETRY_ATTEMPTS = 5;

export async function moveDirAtomic(src: string, dest: string): Promise<void> {
  let lastErr: any;
  for (let attempt = 1; attempt <= MOVE_RETRY_ATTEMPTS; attempt++) {
    try {
      renameSync(src, dest);
      return;
    } catch (err: any) {
      lastErr = err;
      if (err?.code === "EXDEV") {
        // 跨文件系统/分区，立即转入跨设备原子搬迁流程
        break;
      }
      if (!TRANSIENT_MOVE_ERROR_CODES.has(err?.code)) {
        throw err;
      }
      await new Promise((r) => setTimeout(r, 50 * attempt));
    }
  }

  if (lastErr?.code !== "EXDEV") {
    throw lastErr;
  }

  // 跨设备场景：先复制到 dest 同父目录下的临时目录，再同设备 rename 保证 dest 提升的原子性
  const tempDest = `${dest}.tmp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  try {
    cpSync(src, tempDest, { recursive: true });
    for (let attempt = 1; attempt <= MOVE_RETRY_ATTEMPTS; attempt++) {
      try {
        renameSync(tempDest, dest);
        break;
      } catch (err: any) {
        if (attempt === MOVE_RETRY_ATTEMPTS || !TRANSIENT_MOVE_ERROR_CODES.has(err?.code)) {
          throw err;
        }
        await new Promise((r) => setTimeout(r, 50 * attempt));
      }
    }
    rmSync(src, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  } catch (err) {
    if (existsSync(tempDest)) {
      try {
        rmSync(tempDest, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
      } catch {
        // 忽略临时目录清理异常
      }
    }
    throw err;
  }
}

/**
 * 递归收集目录内全部文件的相对路径（正斜杠分隔）。
 * 收集完成后对最终 POSIX 相对路径统一排序，保证跨平台 digest 一致性；
 * 符号链接防护策略与 archive.ts collectEntries 对齐：越出根边界的软链接与循环软链接直接跳过。
 */
export function collectRelativeFiles(dir: string, baseDir = dir): string[] {
  const results = collectRelativeFilesUnsorted(dir, baseDir, new Set<string>());
  return results.sort();
}

function collectRelativeFilesUnsorted(dir: string, baseDir: string, visited: Set<string>): string[] {
  if (!existsSync(dir)) return [];
  if (visited.size === 0) {
    try {
      visited.add(existsSync(baseDir) ? realpathSync(baseDir) : baseDir);
    } catch {
      // 忽略根目录真实路径解析异常，退化为不携带根真实路径的循环拦截
    }
  }
  const results: string[] = [];
  let entries: string[];
  try {
    entries = readdirSync(dir).sort();
  } catch {
    return [];
  }
  for (const entry of entries) {
    const fullPath = join(dir, entry);
    try {
      assertPathWithinRoot(baseDir, fullPath, "collect files path");
    } catch {
      continue;
    }

    let real: string;
    try {
      real = existsSync(fullPath) ? realpathSync(fullPath) : fullPath;
    } catch {
      continue;
    }

    try {
      assertPathWithinRoot(baseDir, real, "collect files path");
    } catch {
      // 忽略并跳过指向 baseDir 外部的软链接，与归档防护策略保持一致
      continue;
    }

    if (visited.has(real)) {
      continue;
    }
    visited.add(real);

    try {
      const stat = statSync(fullPath);
      if (stat.isDirectory()) {
        results.push(...collectRelativeFilesUnsorted(fullPath, baseDir, visited));
      } else if (stat.isFile()) {
        results.push(relative(baseDir, fullPath).split(sep).join("/"));
      }
    } catch {
      // 忽略无法访问或损坏的文件/符号链接
      continue;
    }
  }
  return results;
}

/**
 * 获取内部 @actiondock/* 依赖的版本号规则。
 * 预发布版本采用精确锁定，正式版本采用 ^ 语义范围。
 */
export function getInternalDependencyVersion(version: string = ACTIONDOCK_VERSION): string {
  if (version.includes("-")) {
    return version;
  }
  return `^${version}`;
}

/**
 * 以新目录原子替换已存在的目标目录（含失败回滚保护）。
 * promotion 失败后优先 backup -> target 回滚；只有新 target 完整成功后才能删除 backup。
 */
export async function replaceDirAtomic(stagingDir: string, targetDir: string): Promise<void> {
  if (existsSync(targetDir)) {
    const backupDir = `${targetDir}.old-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    await moveDirAtomic(targetDir, backupDir);

    try {
      await moveDirAtomic(stagingDir, targetDir);
    } catch (promoteErr) {
      // staging 提升失败：清理可能残留的损坏目标目录，并将 backup 恢复至 targetDir
      if (existsSync(targetDir)) {
        try {
          rmSync(targetDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
        } catch {
          // 忽略清理残余异常
        }
      }
      try {
        await moveDirAtomic(backupDir, targetDir);
      } catch (rollbackErr: any) {
        throw new Error(
          `Failed to promote directory to '${targetDir}' (${promoteErr instanceof Error ? promoteErr.message : String(promoteErr)}), and rollback from backup '${backupDir}' also failed: ${rollbackErr?.message || String(rollbackErr)}`
        );
      }
      throw promoteErr;
    }

    // 只有新 target 完整成功后才能删除 backup
    rmSync(backupDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  } else {
    try {
      await moveDirAtomic(stagingDir, targetDir);
    } catch (err) {
      if (existsSync(targetDir)) {
        try {
          rmSync(targetDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
        } catch {
          // 忽略清理残余异常
        }
      }
      throw err;
    }
  }
}
