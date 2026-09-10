import { existsSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { basename, delimiter, dirname, isAbsolute, join, relative, resolve } from "node:path";

/**
 * 跨运行时安全查找可执行文件绝对物理路径。
 */
export function findExecutable(command: string): string | null {
  if (typeof (globalThis as any).Bun !== "undefined" && typeof (globalThis as any).Bun.which === "function") {
    try {
      const bPath = (globalThis as any).Bun.which(command);
      if (bPath) return bPath;
    } catch {
      // ignore
    }
  }

  const hasPathSep = command.includes("/") || command.includes("\\");
  if (hasPathSep) {
    return existsSync(command) ? command : null;
  }

  const pathEnv = process.env.PATH || "";
  const dirs = pathEnv.split(delimiter);
  const isWindows = process.platform === "win32";
  const pathext = isWindows
    ? (process.env.PATHEXT || ".COM;.EXE;.BAT;.CMD").split(";")
    : [""];

  for (const dir of dirs) {
    if (!dir) continue;
    for (const ext of pathext) {
      const candidate = join(dir, isWindows && !command.includes(".") ? command + ext : command);
      if (existsSync(candidate)) {
        return candidate;
      }
    }
  }

  return null;
}

/**
 * Parses duration strings like "500ms", "30s", "5m", "1h", "1d" or pure numbers into milliseconds.
 */
export function parseDuration(input?: string): number | undefined {
  if (!input || !input.trim()) {
    return undefined;
  }

  const str = input.trim();
  if (/^\d+$/.test(str)) {
    return parseInt(str, 10);
  }

  const match = str.match(/^(\d+(?:\.\d+)?)\s*(ms|s|m|h|d)$/i);
  if (!match) {
    throw new Error(
      `Invalid duration format: '${input}'. Supported formats: 500ms, 30s, 5m, 1h`
    );
  }

  const val = parseFloat(match[1]);
  const unit = match[2].toLowerCase();

  switch (unit) {
    case "ms":
      return Math.round(val);
    case "s":
      return Math.round(val * 1000);
    case "m":
      return Math.round(val * 60 * 1000);
    case "h":
      return Math.round(val * 60 * 60 * 1000);
    case "d":
      return Math.round(val * 24 * 60 * 60 * 1000);
    default:
      return undefined;
  }
}

/**
 * Extracts a concise slug from a package or action identifier (e.g. '@scope/pkg' -> 'pkg', 'team.action' -> 'action').
 */
export function getPackageSlug(id: string): string {
  if (id.includes("/")) {
    return id.split("/").pop()!;
  }
  if (id.includes(".")) {
    return id.split(".").pop()!;
  }
  return id;
}

/**
 * Resolves the root ActionDock user home directory based on customHome, ACTIONDOCK_HOME, or user homedir.
 */
export function getActionDockHome(customHome?: string): string {
  return customHome || process.env.ACTIONDOCK_HOME || homedir();
}

export const PACKAGE_ID_REGEX = /^[a-z0-9][a-z0-9.-]*$/;

/**
 * Validates packageId to ensure it adheres to valid naming conventions and prevents path traversal.
 */
export function assertValidPackageId(packageId: string): void {
  if (packageId === "__global__" || packageId === ":memory:") {
    return;
  }
  const isScopedLegacy = /^@[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/.test(packageId);
  if (
    !packageId ||
    typeof packageId !== "string" ||
    packageId.includes("..") ||
    (!PACKAGE_ID_REGEX.test(packageId) && !isScopedLegacy)
  ) {
    throw new Error(
      `Invalid packageId '${packageId}': must match ${PACKAGE_ID_REGEX} and not contain path traversal characters`
    );
  }
}

/**
 * Ensures that a given path stays strictly within the specified root boundary,
 * preventing relative directory escape (..) and symlink jailbreak.
 * Traverses upward to the nearest existing ancestor directory to resolve symlinks
 * even for non-existent paths.
 */
export function assertPathWithinRoot(
  rootDir: string,
  targetPath: string,
  fieldName = "path"
): void {
  const resolvedRoot = resolve(rootDir);
  const resolvedTarget = resolve(rootDir, targetPath);
  const rel = relative(resolvedRoot, resolvedTarget);

  if (rel.startsWith("..") || isAbsolute(rel)) {
    throw new Error(`'${fieldName}' escapes boundary '${rootDir}': ${targetPath}`);
  }

  let realRoot = resolvedRoot;
  try {
    if (existsSync(resolvedRoot)) {
      realRoot = realpathSync(resolvedRoot);
    }
  } catch {
    realRoot = resolvedRoot;
  }

  // Find nearest existing ancestor directory (or the path itself if it exists)
  let curr = resolvedTarget;
  const missingSegments: string[] = [];

  while (!existsSync(curr)) {
    const parent = dirname(curr);
    if (parent === curr) {
      break;
    }
    missingSegments.unshift(basename(curr));
    curr = parent;
  }

  if (existsSync(curr)) {
    try {
      const realCurr = realpathSync(curr);
      const canonicalTarget =
        missingSegments.length > 0
          ? resolve(realCurr, ...missingSegments)
          : realCurr;
      const relReal = relative(realRoot, canonicalTarget);
      if (relReal.startsWith("..") || isAbsolute(relReal)) {
        throw new Error(
          `'${fieldName}' symlink resolves outside boundary '${rootDir}': ${targetPath}`
        );
      }
    } catch (err: any) {
      if (err.message?.includes("escapes") || err.message?.includes("outside")) {
        throw err;
      }
    }
  }
}

/**
 * Backwards-compatible alias for assertPathWithinRoot targeting project roots.
 */
export function assertWithinProjectRoot(
  projectRoot: string,
  subDir: string,
  fieldName: string
): void {
  if (isAbsolute(subDir)) {
    throw new Error(`'${fieldName}' cannot be an absolute path: ${subDir}`);
  }
  assertPathWithinRoot(projectRoot, subDir, fieldName);
}
