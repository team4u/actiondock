import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { computeManifestDigest, parseJsonWithoutDuplicates } from "./digest";
import { MANIFEST_FILE_NAME } from "./manifest";

export const LOCKFILE_NAME = "actiondock.lock.json";
export const LOCKFILE_VERSION = 2;

/**
 * 锁文件中记录的单一被锁定的 Action 包元数据。
 */
export interface LockedPackage {
  /** 逻辑包标识（如 someone.github-actions） */
  packageId: string;
  /** npm 包名（如 @someone/actiondock-github-actions） */
  npmPackage: string;
  /** 语义化版本号 */
  version: string;
  /** 解析版本或来源 */
  resolved: string;
  /** 完整性校验摘要（可选） */
  integrity?: string;
  /** 基于 RFC 8785 计算的清单确定性摘要 */
  manifestDigest: string;
  /** 该包声明的下级依赖映射 */
  dependencies?: Record<string, string>;
}

/**
 * ActionDock 锁文件契约（actiondock.lock.json）。
 */
export interface ActionDockLockfile {
  /** 锁文件规范版本（固定为 2） */
  lockfileVersion: 2;
  /** 已锁定解析的包字典映射 */
  packages: Record<string, LockedPackage>;
}

/**
 * 从指定工程根目录读取并解析 actiondock.lock.json 锁文件。
 * 若文件不存在则返回 null。
 */
export function loadLockfile(projectRoot: string): ActionDockLockfile | null {
  const filePath = join(projectRoot, LOCKFILE_NAME);
  if (!existsSync(filePath)) {
    return null;
  }

  let raw: string;
  try {
    raw = readFileSync(filePath, "utf-8");
  } catch (err: any) {
    throw new Error(`Failed to read lockfile at ${filePath}: ${err.message}`);
  }

  let parsed: any;
  try {
    parsed = parseJsonWithoutDuplicates(raw);
  } catch (err: any) {
    throw new Error(`Corrupted or duplicate keys in lockfile at ${filePath}: ${err.message}`);
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`Invalid lockfile format in ${filePath}: expected a JSON object`);
  }

  if (parsed.lockfileVersion !== LOCKFILE_VERSION) {
    throw new Error(
      `Unsupported lockfileVersion in ${filePath}: received '${parsed.lockfileVersion}', expected ${LOCKFILE_VERSION}`
    );
  }

  if (!parsed.packages || typeof parsed.packages !== "object" || Array.isArray(parsed.packages)) {
    throw new Error(`Invalid lockfile format in ${filePath}: 'packages' must be an object`);
  }

  return parsed as ActionDockLockfile;
}

/**
 * 将锁文件保存至工程根目录（actiondock.lock.json）。
 * 保证各包按键名升序排序，实现确定性输出。
 */
export function saveLockfile(projectRoot: string, lockfile: ActionDockLockfile): void {
  const filePath = join(projectRoot, LOCKFILE_NAME);
  const sortedPackages: Record<string, LockedPackage> = {};

  const sortedKeys = Object.keys(lockfile.packages || {}).sort();
  for (const key of sortedKeys) {
    const pkg = lockfile.packages[key];
    const sortedDeps: Record<string, string> | undefined = pkg.dependencies
      ? Object.keys(pkg.dependencies)
          .sort()
          .reduce((acc, depKey) => {
            acc[depKey] = pkg.dependencies![depKey];
            return acc;
          }, {} as Record<string, string>)
      : undefined;

    sortedPackages[key] = {
      packageId: pkg.packageId,
      npmPackage: pkg.npmPackage,
      version: pkg.version,
      resolved: pkg.resolved,
      integrity: pkg.integrity,
      manifestDigest: pkg.manifestDigest,
      dependencies: sortedDeps,
    };
  }

  const payload: ActionDockLockfile = {
    lockfileVersion: LOCKFILE_VERSION,
    packages: sortedPackages,
  };

  writeFileSync(filePath, JSON.stringify(payload, null, 2) + "\n", "utf-8");
}

/**
 * 校验锁文件结构的合法性及内容完整性。
 * 当提供 projectRoot 时，逐一比对各包实际 actiondock.json 的 RFC 8785 manifestDigest，
 * 若摘要不一致，校验失败并提示需要重新解析。
 */
export function validateLockfile(
  lockfile: unknown,
  options?: { projectRoot?: string }
): { valid: boolean; errors?: string[] } {
  if (!lockfile || typeof lockfile !== "object" || Array.isArray(lockfile)) {
    return { valid: false, errors: ["Lockfile must be an object"] };
  }

  const lf = lockfile as ActionDockLockfile;
  const errors: string[] = [];

  if (lf.lockfileVersion !== LOCKFILE_VERSION) {
    errors.push(`Lockfile 'lockfileVersion' must be ${LOCKFILE_VERSION} (received '${lf.lockfileVersion}')`);
  }

  if (!lf.packages || typeof lf.packages !== "object" || Array.isArray(lf.packages)) {
    errors.push("Lockfile 'packages' must be an object");
    return { valid: false, errors };
  }

  for (const [key, item] of Object.entries(lf.packages)) {
    if (!item || typeof item !== "object") {
      errors.push(`Package entry '${key}' must be an object`);
      continue;
    }

    if (!item.packageId || typeof item.packageId !== "string") {
      errors.push(`Package '${key}' missing required string property 'packageId'`);
    }

    if (!item.npmPackage || typeof item.npmPackage !== "string") {
      errors.push(`Package '${key}' missing required string property 'npmPackage'`);
    }

    if (!item.version || typeof item.version !== "string") {
      errors.push(`Package '${key}' missing required string property 'version'`);
    }

    if (!item.manifestDigest || typeof item.manifestDigest !== "string") {
      errors.push(`Package '${key}' missing required string property 'manifestDigest'`);
    }

    // 检查项目根目录下的实际清单摘要匹配性
    if (options?.projectRoot && item.manifestDigest) {
      let manifestPath: string | null = null;
      const rootManifestPath = join(options.projectRoot, MANIFEST_FILE_NAME);

      // 若为当前工程根包
      if (existsSync(rootManifestPath)) {
        try {
          const rootRaw = readFileSync(rootManifestPath, "utf-8");
          const rootParsed = parseJsonWithoutDuplicates<any>(rootRaw);
          if (rootParsed.id === item.packageId) {
            manifestPath = rootManifestPath;
          }
        } catch {
          // 忽略解析异常
        }
      }

      // 若为外部依赖包，从 node_modules 探测
      if (!manifestPath) {
        const candidateNpm = join(options.projectRoot, "node_modules", item.npmPackage, MANIFEST_FILE_NAME);
        const candidateId = join(options.projectRoot, "node_modules", item.packageId, MANIFEST_FILE_NAME);
        if (existsSync(candidateNpm)) {
          manifestPath = candidateNpm;
        } else if (existsSync(candidateId)) {
          manifestPath = candidateId;
        }
      }

      if (manifestPath && existsSync(manifestPath)) {
        try {
          const manifestRaw = readFileSync(manifestPath, "utf-8");
          const actualParsed = parseJsonWithoutDuplicates(manifestRaw);
          const actualDigest = computeManifestDigest(actualParsed);
          if (actualDigest !== item.manifestDigest) {
            errors.push(
              `Manifest digest mismatch for package '${item.packageId}': expected '${item.manifestDigest}', got '${actualDigest}'. Re-resolution required.`
            );
          }
        } catch (err: any) {
          errors.push(
            `Failed to verify manifest digest for package '${item.packageId}': ${err.message}`
          );
        }
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors: errors.length > 0 ? errors : undefined,
  };
}
