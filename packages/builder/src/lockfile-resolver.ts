import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { assertPathWithinRoot } from "@actiondock/core/project";
import { PlannerError } from "./errors";
import type { LockfileInfo } from "./types";

/**
 * 支持的包管理器锁文件候选列表。
 */
export const KNOWN_LOCKFILES = [
  "package-lock.json",
  "npm-shrinkwrap.json",
  "bun.lockb",
  "bun.lock",
  "pnpm-lock.yaml",
  "yarn.lock",
];

/**
 * 读取并计算项目锁文件元数据及 SHA-256 摘要。
 */
export function computeLockfileInfo(projectRoot: string, preferredLockfile?: string): LockfileInfo | undefined {
  if (preferredLockfile) {
    const lockPath = resolve(projectRoot, preferredLockfile);
    assertPathWithinRoot(projectRoot, lockPath, "lockfile");
    if (existsSync(lockPath) && statSync(lockPath).isFile()) {
      const content = readFileSync(lockPath);
      const sha256 = createHash("sha256").update(content).digest("hex");
      return {
        name: basename(lockPath),
        path: lockPath,
        sha256,
      };
    }
    throw new PlannerError(
      `Specified lockfile not found on disk: ${preferredLockfile}`,
      "LOCKFILE_NOT_FOUND"
    );
  }

  for (const lockFileName of KNOWN_LOCKFILES) {
    const lockPath = join(projectRoot, lockFileName);
    if (existsSync(lockPath)) {
      try {
        if (statSync(lockPath).isFile()) {
          const content = readFileSync(lockPath);
          const sha256 = createHash("sha256").update(content).digest("hex");
          return {
            name: lockFileName,
            path: lockPath,
            sha256,
          };
        }
      } catch (err: any) {
        // 存在但不可读：显式报错而非静默跳过，否则构建在无锁文件摘要状态下继续，可复现性校验形同虚设
        throw new PlannerError(
          `Lockfile '${lockFileName}' exists but could not be read in ${projectRoot}: ${err?.message || String(err)}`,
          "LOCKFILE_READ_ERROR"
        );
      }
    }
  }

  return undefined;
}
