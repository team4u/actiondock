import { existsSync, readdirSync, realpathSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, delimiter, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { ActionDockError, INVALID_PACKAGE_ID, PATH_TRAVERSAL } from "../errors";

export { isLoopbackHost } from "./net";
export { isProcessAlive } from "./process";

/**
 * 语义化版本元数据结构。
 */
export interface SemVer {
  major: number;
  minor: number;
  patch: number;
  prerelease?: string;
}

/**
 * 解析基础 SemVer 版本字符串（单一事实源）。
 * 仅接受可选 v/= 前缀的严格三段式语义化版本，可携带预发布后缀；
 * 其余形态（两段式、非数值等）返回 null，由调用方自行兜底。
 */
export function parseSemVer(v: string): SemVer | null {
  const match = v.trim().replace(/^[v=]/, "").match(/^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/);
  if (!match) return null;
  return {
    major: parseInt(match[1], 10),
    minor: parseInt(match[2], 10),
    patch: parseInt(match[3], 10),
    prerelease: match[4],
  };
}

/**
 * 目录遍历条目描述。
 */
export interface TraverseDirectoryEntry {
  /** 相对遍历根目录的 POSIX 风格路径 */
  relPath: string;
  /** 条目绝对路径 */
  fullPath: string;
  /** 是否为目录 */
  isDir: boolean;
}

/**
 * 目录遍历配置选项。
 */
export interface TraverseDirectoryOptions {
  /**
   * 条目忽略谓词：返回 true 的相对路径（含目录自身）不进入结果，目录不再下钻。
   * 各调用方的业务忽略规则（如 node_modules、测试文件）以谓词传入保持现有行为。
   */
  ignore?: (relPath: string, isDir: boolean) => boolean;
  /** 是否在结果中包含目录条目（默认仅返回文件） */
  includeDirs?: boolean;
  /** 目录不可读时的错误回调（默认静默跳过该目录） */
  onReadError?: (dir: string, err: unknown) => void;
}

/**
 * 递归遍历目录的单一事实源实现（同步）。
 *
 * 防护策略（以归档与摘要收集链路的历史行为为准）：
 * - 软链接越界防护：条目真实路径越出遍历根目录边界时直接跳过；
 * - 循环防护：以真实路径去重，重复访问即跳过（含根目录自身入集合）；
 * - 无法 stat 或损坏的条目直接跳过，不中断整体遍历；
 * - 同级条目按名称排序，保证遍历顺序稳定。
 *
 * 根目录自身不作为条目返回；目录条目（includeDirs 开启时）先于其子条目输出。
 */
export function traverseDirectory(
  root: string,
  options: TraverseDirectoryOptions = {}
): TraverseDirectoryEntry[] {
  const results: TraverseDirectoryEntry[] = [];
  const visited = new Set<string>();

  const resolvedRoot = resolve(root);
  try {
    visited.add(existsSync(resolvedRoot) ? realpathSync(resolvedRoot) : resolvedRoot);
  } catch {
    // 根目录真实路径解析异常时退化为不携带根真实路径的循环拦截
  }

  const walk = (dir: string): void => {
    let names: string[];
    try {
      names = readdirSync(dir).sort();
    } catch (err) {
      options.onReadError?.(dir, err);
      return;
    }
    for (const name of names) {
      const fullPath = join(dir, name);
      const relPath = relative(resolvedRoot, fullPath).split(sep).join("/");

      let isDir: boolean;
      try {
        isDir = statSync(fullPath).isDirectory();
      } catch {
        // 无法访问或损坏的文件/符号链接直接跳过
        continue;
      }

      if (options.ignore?.(relPath, isDir)) {
        continue;
      }

      // 软链接越界防护：条目真实路径越出根目录边界时直接跳过
      let real: string;
      try {
        real = existsSync(fullPath) ? realpathSync(fullPath) : fullPath;
      } catch {
        continue;
      }
      try {
        assertPathWithinRoot(resolvedRoot, real, "traverse path");
      } catch {
        continue;
      }

      // 循环防护：真实路径重复出现即跳过
      if (visited.has(real)) {
        continue;
      }
      visited.add(real);

      if (isDir) {
        if (options.includeDirs) {
          results.push({ relPath, fullPath, isDir: true });
        }
        walk(fullPath);
      } else {
        results.push({ relPath, fullPath, isDir: false });
      }
    }
  };

  walk(resolvedRoot);
  return results;
}


/**
 * 跨运行时安全查找可执行文件绝对物理路径。
 *
 * 注意：本函数为同步实现，内部同步遍历 PATH 逐个探测物理文件存在性；
 * 当前全部调用方（doctor 体检与测试 CLI 桥）均为同步链路，serve 链路未使用本函数，
 * 因此暂不提供异步版本。若后续异步链路需要，应另行新增异步实现而非改造本函数。
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
    throw new ActionDockError(
      INVALID_PACKAGE_ID,
      `Invalid packageId '${packageId}': must match ${PACKAGE_ID_REGEX} and not contain path traversal characters`
    );
  }
}

/**
 * Resolves a path to its canonical physical location.
 * If the path exists, calls realpathSync.
 * If not, traverses upward to find the nearest existing ancestor, resolves its symlink,
 * and appends the non-existent relative segments.
 */
export function canonicalizePath(targetPath: string): string {
  let curr = resolve(targetPath);
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
      return missingSegments.length > 0
        ? resolve(realCurr, ...missingSegments)
        : realCurr;
    } catch {
      return resolve(targetPath);
    }
  }

  return resolve(targetPath);
}

/**
 * 校验相对路径是否越出根目录边界。
 * 只有当相对路径为绝对路径、等于 ".." 或以 "..[/\\]" 起始时才判定为越界，
 * 避免形如 ..cache、..cache/file 等在根目录内部的文件或目录被误判越界。
 */
export function isPathOutsideBoundary(rel: string): boolean {
  return (
    isAbsolute(rel) ||
    rel === ".." ||
    rel.startsWith(".." + sep) ||
    rel.startsWith("../") ||
    rel.startsWith("..\\")
  );
}

/**
 * Ensures that a given path stays strictly within the specified root boundary,
 * preventing relative directory escape (..) and symlink jailbreak.
 * Traverses upward to the nearest existing ancestor directory to resolve symlinks
 * symmetrically for both root and target paths.
 */
export function assertPathWithinRoot(
  rootDir: string,
  targetPath: string,
  fieldName = "path"
): void {
  const resolvedRoot = resolve(rootDir);
  const resolvedTarget = resolve(rootDir, targetPath);
  const rel = relative(resolvedRoot, resolvedTarget);

  if (isPathOutsideBoundary(rel)) {
    throw new ActionDockError(
      PATH_TRAVERSAL,
      `'${fieldName}' escapes boundary '${rootDir}': ${targetPath}`
    );
  }

  const canonicalRoot = canonicalizePath(resolvedRoot);
  const canonicalTarget = canonicalizePath(resolvedTarget);

  const relReal = relative(canonicalRoot, canonicalTarget);
  if (isPathOutsideBoundary(relReal)) {
    throw new ActionDockError(
      PATH_TRAVERSAL,
      `'${fieldName}' symlink resolves outside boundary '${rootDir}': ${targetPath}`
    );
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
