import { realpathSync, statSync } from "node:fs";
import { basename, dirname, extname, isAbsolute, join, resolve } from "node:path";
import {
  ActionDockError,
  DEPENDENCY_INSTALL_FAILED,
} from "../errors";
import type { ProcessDriver } from "../process/driver";
import {
  executeCommand,
  type CommandExecutionResult,
  type ExecuteCommandOptions,
} from "../process/command-executor";

export type { CommandExecutionResult };

export interface ResolvePackageManagerOptions {
  cwd?: string;
  env?: Record<string, string | undefined>;
  platform?: NodeJS.Platform;
  execPath?: string;
}

export interface PackageManagerInvocation {
  executable: string;
  args: string[];
}

export interface RunPackageManagerOptions extends ExecuteCommandOptions {
  platform?: NodeJS.Platform;
  execPath?: string;
}

function isFile(filePath: string): boolean {
  try {
    return statSync(filePath).isFile();
  } catch (error: any) {
    if (error?.code === "ENOENT" || error?.code === "ENOTDIR") {
      return false;
    }
    throw new ActionDockError(
      DEPENDENCY_INSTALL_FAILED,
      `Failed to inspect file at '${filePath}': ${error?.message ?? String(error)}`,
      { stage: "resolve", path: filePath, cause: error }
    );
  }
}

/**
 * 规范化 Windows 环境变量字典。
 *
 * 核心契约：
 * - 保持与 Node.js Windows child_process 相同的字典序排序与大小写去重语义；
 * - 先由字典序首位键决定该大小写分组的最终获胜键；
 * - 若获胜键的值为 undefined，则该变量视为未设置（同组后续键不可顶替）；
 * - 仅保留值非 undefined 的有效键值对，杜绝后续执行器剔除 undefined 时残留失效同名键。
 */
function normalizeWindowsEnvironment(
  env: Record<string, string | undefined>
): Record<string, string> {
  const keys: string[] = [];
  for (const key in env) {
    keys.push(key);
  }
  keys.sort();

  const seenUpper = new Set<string>();
  const normalized: Record<string, string> = {};

  for (const key of keys) {
    const upper = key.toUpperCase();
    if (seenUpper.has(upper)) {
      continue;
    }
    seenUpper.add(upper);
    const value = env[key];
    if (value !== undefined) {
      normalized[key] = value;
    }
  }

  return normalized;
}

function getNormalizedEnvValue(
  env: Record<string, string>,
  targetKey: string
): string | undefined {
  const targetUpper = targetKey.toUpperCase();
  for (const [key, value] of Object.entries(env)) {
    if (key.toUpperCase() === targetUpper) {
      return value;
    }
  }
  return undefined;
}

function resolvePathExt(rawPathExt: string | undefined): string[] {
  if (!rawPathExt || rawPathExt.trim() === "") {
    return [".COM", ".EXE", ".BAT", ".CMD"];
  }
  const list = rawPathExt
    .split(";")
    .map((e) => e.trim())
    .filter(Boolean)
    .map((e) => (e.startsWith(".") ? e : `.${e}`));
  return list.length > 0 ? list : [".COM", ".EXE", ".BAT", ".CMD"];
}

function findMatchingExecutable(
  dir: string,
  manager: string,
  ext: string
): string | null {
  // Windows 文件系统大小写不敏感：优先尝试小写拼写，使返回路径与磁盘上常见的小写文件名一致；
  // 再回退 PATHEXT 原样与全大写拼写，仅影响返回路径的外现大小写，不改变命中顺序。
  const lowerCandidate = join(dir, `${manager}${ext.toLowerCase()}`);
  if (isFile(lowerCandidate)) {
    return lowerCandidate;
  }

  const directCandidate = join(dir, `${manager}${ext}`);
  if (directCandidate !== lowerCandidate && isFile(directCandidate)) {
    return directCandidate;
  }

  const upperCandidate = join(dir, `${manager}${ext.toUpperCase()}`);
  if (
    upperCandidate !== directCandidate &&
    upperCandidate !== lowerCandidate &&
    isFile(upperCandidate)
  ) {
    return upperCandidate;
  }

  return null;
}

function findNpmCliInDirectory(targetDir: string): string | null {
  const candidates = [
    join(targetDir, "node_modules", "npm", "bin", "npm-cli.js"),
    join(targetDir, "..", "node_modules", "npm", "bin", "npm-cli.js"),
    join(targetDir, "..", "lib", "node_modules", "npm", "bin", "npm-cli.js"),
    join(targetDir, "..", "npm", "bin", "npm-cli.js"),
    join(targetDir, "npm", "bin", "npm-cli.js"),
  ];

  for (const candidate of candidates) {
    if (isFile(candidate)) {
      return candidate;
    }
  }
  return null;
}

/**
 * 解析包管理器在目标平台上的确定性启动规范。
 *
 * 核心设计契约：
 * - 保持参数边界与数组结构（保留 argv 边界，路径中的空格、引号、&、% 与 ! 原样保留）；
 * - shell: false 语义，杜绝命令注入与 Node.js DEP0190 警告；
 * - POSIX 平台保留正常 PATH 命令执行，兼容已有 fake npm 脚本；
 * - Windows 平台查找遵循 PATH 目录顺序及 PATHEXT 后缀顺序（默认 .COM;.EXE;.BAT;.CMD）；
 * - PATH 所选工具为唯一事实源，显式传入 env 必须被尊重，绝不从 process.env 漏回其它 PATH；
 * - Windows 平台原生程序（.exe, .com）直接保留该可执行文件与原数组 args，无需绕过原生版本管理器；
 * - Windows 平台 Bun 仅支持原生程序，遇到 cmd/bat 包装脚本明确报错，无工具时严禁退回名称；
 * - Windows 平台 npm.cmd/bat：优先其真实目录布局定位标准 npm-cli.js，由 execPath (Node) 无 shell 启动；
 * - 仅支持标准可定位 CLI 布局，非标准 wrapper 显式报错，无有效 PATH 工具显式报错。
 */
export function resolvePackageManagerInvocation(
  manager: "npm" | "bun",
  args: readonly string[],
  options?: ResolvePackageManagerOptions
): PackageManagerInvocation {
  const platform = options?.platform ?? process.platform;
  const execPath = options?.execPath ?? process.execPath;

  if (platform !== "win32") {
    return {
      executable: manager,
      args: [...args],
    };
  }

  const envSource = options?.env !== undefined ? options.env : process.env;
  const effectiveEnv = normalizeWindowsEnvironment(envSource);
  const rawPath = getNormalizedEnvValue(effectiveEnv, "PATH") ?? "";
  const rawPathExt = getNormalizedEnvValue(effectiveEnv, "PATHEXT");
  const pathExtList = resolvePathExt(rawPathExt);

  const cwd = options?.cwd ?? process.cwd();
  const pathDirs: string[] = [];

  for (const rawEntry of rawPath.split(";")) {
    let entry = rawEntry.trim();
    if (!entry) continue;
    if (entry.startsWith('"') && entry.endsWith('"') && entry.length >= 2) {
      entry = entry.slice(1, -1).trim();
    }
    if (!entry) continue;
    pathDirs.push(isAbsolute(entry) ? entry : resolve(cwd, entry));
  }

  let selectedPath: string | null = null;
  for (const dir of pathDirs) {
    for (const ext of pathExtList) {
      const match = findMatchingExecutable(dir, manager, ext);
      if (match) {
        selectedPath = match;
        break;
      }
    }
    if (selectedPath) {
      break;
    }
  }

  if (!selectedPath) {
    throw new ActionDockError(
      DEPENDENCY_INSTALL_FAILED,
      `Cannot locate ${manager} on Windows: '${manager}' was not found in PATH (${rawPath || "empty"}).`,
      { stage: "resolve", manager, path: rawPath }
    );
  }

  const selectedExt = extname(selectedPath).toLowerCase();
  const isNative = selectedExt === ".exe" || selectedExt === ".com";

  if (isNative) {
    return {
      executable: selectedPath,
      args: [...args],
    };
  }

  if (manager === "bun") {
    throw new ActionDockError(
      DEPENDENCY_INSTALL_FAILED,
      `Unsupported bun wrapper at '${selectedPath}': only native executable (.exe, .com) is supported on Windows. Non-standard wrappers cannot be executed without shell.`,
      { stage: "resolve", manager: "bun", path: selectedPath }
    );
  }

  // Windows npm 非原生分支仅支持 .cmd 与 .bat
  if (selectedExt !== ".cmd" && selectedExt !== ".bat") {
    throw new ActionDockError(
      DEPENDENCY_INSTALL_FAILED,
      `Unsupported npm wrapper extension '${selectedExt}' at '${selectedPath}': only native binaries (.exe, .com) or standard Windows batch scripts (.cmd, .bat) are supported.`,
      { stage: "resolve", manager: "npm", path: selectedPath }
    );
  }

  // Windows npm .cmd / .bat wrapper 解析
  let realWrapperPath: string;
  try {
    realWrapperPath = realpathSync(selectedPath);
  } catch (error: any) {
    throw new ActionDockError(
      DEPENDENCY_INSTALL_FAILED,
      `Failed to resolve realpath for npm wrapper at '${selectedPath}': ${error?.message ?? String(error)}`,
      { stage: "resolve", manager: "npm", path: selectedPath, cause: error }
    );
  }

  let foundCli: string | null = null;

  if (basename(realWrapperPath).toLowerCase() === "npm-cli.js" && isFile(realWrapperPath)) {
    foundCli = realWrapperPath;
  }

  if (!foundCli) {
    const realDir = dirname(realWrapperPath);
    foundCli = findNpmCliInDirectory(realDir);
  }

  if (!foundCli) {
    throw new ActionDockError(
      DEPENDENCY_INSTALL_FAILED,
      `Unsupported npm wrapper at '${selectedPath}': cannot locate npm-cli.js in standard installation layout. Non-standard npm wrappers cannot be executed without shell.`,
      { stage: "resolve", manager: "npm", path: selectedPath }
    );
  }

  return {
    executable: execPath,
    args: [foundCli, ...args],
  };
}

/**
 * 统一执行包管理器命令。
 *
 * 运维规范：
 * - 结合 resolvePackageManagerInvocation 完成无 shell 真实命令定位；
 * - 通过统一 ProcessDriver 底座执行命令，保留取消、超时、输出流监听与进程树收敛；
 * - 内部可信工具执行保持标准非阻塞异步。
 */
export async function runPackageManager(
  manager: "npm" | "bun",
  args: readonly string[],
  options?: RunPackageManagerOptions
): Promise<CommandExecutionResult> {
  const platform = options?.platform ?? process.platform;
  const normalizedEnv =
    platform === "win32" && options?.env !== undefined
      ? normalizeWindowsEnvironment(options.env)
      : options?.env;

  const invocation = resolvePackageManagerInvocation(manager, args, {
    cwd: options?.cwd,
    env: normalizedEnv,
    platform: options?.platform,
    execPath: options?.execPath,
  });

  return executeCommand(invocation.executable, invocation.args, {
    cwd: options?.cwd,
    env: normalizedEnv,
    signal: options?.signal,
    timeoutMs: options?.timeoutMs,
    maxOutputBytes: options?.maxOutputBytes,
    onOutput: options?.onOutput,
    driver: options?.driver,
  });
}
