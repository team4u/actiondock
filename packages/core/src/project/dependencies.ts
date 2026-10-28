import { existsSync, globSync, readFileSync, realpathSync } from "node:fs";
import { findPackageJSON } from "node:module";
import { dirname, join, matchesGlob, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  ActionDockError,
  ACTION_CANCELLED,
  DEPENDENCIES_NOT_READY,
  DEPENDENCY_INSTALL_FAILED,
  PROJECT_RECOVERY_REQUIRED,
} from "../errors";
import type { ProcessDriver } from "../process/driver";
import type { CommandExecutionResult } from "../process/command-executor";
import {
  runPackageManager,
} from "./package-manager";
import { acquireProjectLock, hasPendingTransactions } from "./transactions";

export interface EnsureProjectDependenciesOptions {
  /** 是否允许自动安装（默认依据 process.env.ACTIONDOCK_AUTO_INSTALL !== "false"） */
  install?: boolean;
  /** 取消信号 */
  signal?: AbortSignal;
  /** 进度输出回调，默认输出至 process.stderr */
  onProgress?: (message: string) => void;
  /** 自定义安装超时（毫秒），默认 5 分钟 (300,000 ms) */
  timeoutMs?: number;
  /** 可选注入的底层进程驱动（用于确定性测试） */
  processDriver?: ProcessDriver;
}

export interface EnsureProjectDependenciesResult {
  /** 是否触发并完成了安装 */
  installed: boolean;
  /** 实际安装根目录 */
  installRoot?: string;
  /** 使用的包管理器（若进行了安装） */
  packageManager?: "npm" | "bun";
}

function resolvePackageDirectory(packageRoot: string): string {
  const path = resolve(packageRoot);
  try {
    return realpathSync(path);
  } catch (error: any) {
    throw new ActionDockError(
      DEPENDENCIES_NOT_READY,
      `Cannot resolve project directory '${path}': ${error?.message || String(error)}`,
      { path, cause: error }
    );
  }
}

function readWorkspacePatterns(pkg: Record<string, any>, path: string): string[] {
  if (pkg.workspaces === undefined) return [];
  const patterns = Array.isArray(pkg.workspaces) ? pkg.workspaces : pkg.workspaces?.packages;
  if (!Array.isArray(patterns) || patterns.some((pattern) => typeof pattern !== "string" || pattern.length === 0)) {
    throw new ActionDockError(
      DEPENDENCIES_NOT_READY,
      `Invalid workspaces field in '${path}': expected an array of non-empty patterns or an object with a packages array.`,
      { path }
    );
  }
  return patterns;
}

/**
 * 校验指定相对路径是否匹配 npm workspaces 通配符规则。
 *
 * 契约：
 * - 支持正向规则与负向排除规则（以 ! 开头）；
 * - 路径与规则统一规范化（去除前导 ./ 与末尾 /）；
 * - 正向规则匹配且未被负向排除时判定为匹配。
 */
function matchesWorkspacePatterns(patterns: string[], relPath: string): boolean {
  const normRel = relPath.replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/+$/, "");

  let matched = false;
  for (const raw of patterns) {
    if (typeof raw !== "string") continue;
    let p = raw.replace(/\\/g, "/").trim();
    if (p.startsWith("./")) p = p.slice(2);
    if (p.endsWith("/")) p = p.slice(0, -1);

    const isNeg = p.startsWith("!");
    const cleanPattern = isNeg ? p.slice(1).replace(/^\.\//, "").replace(/\/+$/, "") : p;

    if (isNeg) {
      if (matchesGlob(normRel, cleanPattern)) {
        return false;
      }
    } else {
      if (matchesGlob(normRel, cleanPattern)) {
        matched = true;
      }
    }
  }

  return matched;
}

/**
 * 检查目标工程链、安装根及声明工作区成员中是否存在已有的 node_modules 目录。
 *
 * 契约：
 * - 若安装根或从 packageRoot 到 installRoot 路径链上已存在 node_modules，返回其完整路径；
 * - 若为工作区，检索已声明工作区成员目录下是否已存在 node_modules，避免冷安装（如 npm ci）破坏性清除子包已有依赖；
 * - 若不存在任何已有依赖目录，返回 null。
 */
function findExistingNodeModules(
  installRoot: string,
  packageRoot: string,
  isWorkspace: boolean,
  patterns: string[] = []
): string | null {
  const rootNm = join(installRoot, "node_modules");
  if (existsSync(rootNm)) {
    return rootNm;
  }

  const rootAbs = resolve(installRoot);
  let curr = resolve(packageRoot);
  while (curr.startsWith(rootAbs)) {
    const nm = join(curr, "node_modules");
    if (existsSync(nm)) {
      return nm;
    }
    if (curr === rootAbs) break;
    const parent = dirname(curr);
    if (parent === curr) break;
    curr = parent;
  }

  if (isWorkspace && patterns.length > 0) {
    for (const raw of patterns) {
      if (typeof raw !== "string") continue;
      let p = raw.replace(/\\/g, "/").trim();
      if (p.startsWith("./")) p = p.slice(2);
      if (p.endsWith("/")) p = p.slice(0, -1);
      if (p.startsWith("!")) continue;

      try {
        const globPattern = `${p}/node_modules`;
        const matches = globSync(globPattern, { cwd: installRoot });
        for (const match of matches) {
          const matchPath = join(installRoot, match);
          const memberRel = dirname(match).replace(/\\/g, "/");
          if (matchesWorkspacePatterns(patterns, memberRel) && existsSync(matchPath)) {
            return matchPath;
          }
        }
      } catch (error: any) {
        throw new ActionDockError(
          DEPENDENCIES_NOT_READY,
          `Cannot inspect workspace dependency directories in '${installRoot}': ${error?.message || String(error)}`,
          { installRoot, pattern: p, cause: error }
        );
      }
    }
  }

  return null;
}

/**
 * 解析并确定目标工程的实际安装根目录。
 *
 * 归属规则：
 * - 位于 node_modules 目录内的包（包括经符号链接指向物理 node_modules 的情形），直接跳过（不在其内部再执行安装）；
 * - 无 package.json 的工程，直接跳过（保留无外部依赖合法工程的运行路径）；
 * - 工作区子包：校验上级 package.json.workspaces 归属，确属工作区子包时使用工作区根目录；
 * - 仅接受实际 workspace 声明归属，不因祖先存在锁文件误认工作区根；
 * - 校验 package.json 及 workspaces 声明类型，严禁吞没 JSON 解析与 I/O 异常；
 * - 独立包：使用自身 package.json 所在目录作为安装根。
 */
export function resolveInstallRoot(packageRoot: string): {
  installRoot?: string;
  isWorkspace: boolean;
  skip: boolean;
  reason?: string;
  workspacePatterns?: string[];
} {
  const requestedRoot = resolve(packageRoot);
  const absRoot = resolvePackageDirectory(requestedRoot);

  const isInsideNodeModules = (p: string) => {
    const parts = p.replace(/\\/g, "/").split("/");
    return parts.includes("node_modules");
  };

  if (isInsideNodeModules(requestedRoot) || isInsideNodeModules(absRoot)) {
    return { isWorkspace: false, skip: true, reason: "Inside node_modules" };
  }

  const pkgJsonPath = join(absRoot, "package.json");
  if (!existsSync(pkgJsonPath)) {
    return { isWorkspace: false, skip: true, reason: "No package.json" };
  }

  let pkgJson: any;
  try {
    const raw = readFileSync(pkgJsonPath, "utf-8");
    pkgJson = JSON.parse(raw);
  } catch (err: any) {
    throw new ActionDockError(
      DEPENDENCIES_NOT_READY,
      `Failed to read or parse package.json at '${pkgJsonPath}': ${err?.message || String(err)}`,
      { path: pkgJsonPath, cause: err }
    );
  }

  if (!pkgJson || typeof pkgJson !== "object" || Array.isArray(pkgJson)) {
    throw new ActionDockError(
      DEPENDENCIES_NOT_READY,
      `Invalid package.json at '${pkgJsonPath}': root must be a JSON object.`,
      { path: pkgJsonPath }
    );
  }

  const ownPatterns = readWorkspacePatterns(pkgJson, pkgJsonPath);
  let current = dirname(absRoot);
  while (true) {
    const candidatePkgJson = join(current, "package.json");
    if (existsSync(candidatePkgJson)) {
      let candidateParsed: any;
      try {
        const raw = readFileSync(candidatePkgJson, "utf-8");
        candidateParsed = JSON.parse(raw);
      } catch (err: any) {
        throw new ActionDockError(
          DEPENDENCIES_NOT_READY,
          `Failed to read or parse workspace package.json at '${candidatePkgJson}': ${err?.message || String(err)}`,
          { path: candidatePkgJson, cause: err }
        );
      }

      if (
        !candidateParsed ||
        typeof candidateParsed !== "object" ||
        Array.isArray(candidateParsed)
      ) {
        throw new ActionDockError(
          DEPENDENCIES_NOT_READY,
          `Invalid package.json at '${candidatePkgJson}': root must be a JSON object.`,
          { path: candidatePkgJson }
        );
      }

      const patterns = readWorkspacePatterns(candidateParsed, candidatePkgJson);
      if (patterns.length > 0 && matchesWorkspacePatterns(patterns, relative(current, absRoot))) {
        return {
          installRoot: current,
          isWorkspace: true,
          skip: false,
          workspacePatterns: patterns,
        };
      }
    }

    const parent = dirname(current);
    if (parent === current) {
      break;
    }
    current = parent;
  }

  return { installRoot: absRoot, isWorkspace: ownPatterns.length > 0, skip: false, workspacePatterns: ownPatterns };
}

/**
 * 检查当前包声明的必需直接生产依赖是否已在 node_modules 中物化。
 *
 * 判定设计契约：
 * - 仅检查 package.json 中的 dependencies 生产依赖；
 * - 校验 dependencies 与 optionalDependencies 的记录对象结构，杜绝数组或无效数据；
 * - 使用 Object.hasOwn 判定可选依赖排除，防止原型属性污染及误判；
 * - optionalDependencies 缺失不视为必须安装；同名条目在 optionalDependencies 中声明时覆盖 dependencies；
 * - 使用 node:module.findPackageJSON 仅探测依赖包元数据是否存在，不代表完整依赖加载健康；
 * - 仅模块未找到（ERR_MODULE_NOT_FOUND）归类为 missing，读取权限与损坏配置等错误必须向外显式抛出；
 * - 无需检查全部传递依赖。
 */
export function checkDependenciesMaterialized(packageRoot: string): {
  ready: boolean;
  missing: string[];
  requiredCount: number;
} {
  const absRoot = resolvePackageDirectory(packageRoot);
  const pkgJsonPath = join(absRoot, "package.json");
  if (!existsSync(pkgJsonPath)) {
    return { ready: true, missing: [], requiredCount: 0 };
  }

  let pkgJson: Record<string, any>;
  try {
    const raw = readFileSync(pkgJsonPath, "utf-8");
    pkgJson = JSON.parse(raw);
  } catch (err: any) {
    throw new ActionDockError(
      DEPENDENCIES_NOT_READY,
      `Failed to read or parse package.json at '${pkgJsonPath}': ${err?.message || String(err)}`,
      { path: pkgJsonPath, cause: err }
    );
  }

  if (!pkgJson || typeof pkgJson !== "object" || Array.isArray(pkgJson)) {
    throw new ActionDockError(
      DEPENDENCIES_NOT_READY,
      `Invalid package.json at '${pkgJsonPath}': root must be a JSON object.`,
      { path: pkgJsonPath }
    );
  }

  if (pkgJson.dependencies !== undefined) {
    if (
      typeof pkgJson.dependencies !== "object" ||
      pkgJson.dependencies === null ||
      Array.isArray(pkgJson.dependencies)
    ) {
      throw new ActionDockError(
        DEPENDENCIES_NOT_READY,
        `Invalid 'dependencies' field in '${pkgJsonPath}': expected an object record.`,
        { path: pkgJsonPath }
      );
    }
  }

  if (pkgJson.optionalDependencies !== undefined) {
    if (
      typeof pkgJson.optionalDependencies !== "object" ||
      pkgJson.optionalDependencies === null ||
      Array.isArray(pkgJson.optionalDependencies)
    ) {
      throw new ActionDockError(
        DEPENDENCIES_NOT_READY,
        `Invalid 'optionalDependencies' field in '${pkgJsonPath}': expected an object record.`,
        { path: pkgJsonPath }
      );
    }
  }

  const dependencies: Record<string, string> = pkgJson.dependencies ?? {};
  const optionalDependencies: Record<string, string> = pkgJson.optionalDependencies ?? {};
  for (const [field, entries] of [["dependencies", dependencies], ["optionalDependencies", optionalDependencies]] as const) {
    for (const [name, specifier] of Object.entries(entries)) {
      if (typeof specifier !== "string" || specifier.length === 0) {
        throw new ActionDockError(
          DEPENDENCIES_NOT_READY,
          `Invalid '${field}.${name}' in '${pkgJsonPath}': dependency specifier must be a non-empty string.`,
          { path: pkgJsonPath, field, dependency: name }
        );
      }
    }
  }

  const requiredDeps = Object.keys(dependencies).filter(
    (dep) => !Object.hasOwn(optionalDependencies, dep)
  );

  if (requiredDeps.length === 0) {
    return { ready: true, missing: [], requiredCount: 0 };
  }

  const missing: string[] = [];
  const baseHref = pathToFileURL(pkgJsonPath).href;

  for (const dep of requiredDeps) {
    try {
      const found = findPackageJSON(dep, baseHref);
      if (!found) {
        missing.push(dep);
      }
    } catch (err: any) {
      if (err?.code === "ERR_MODULE_NOT_FOUND" || err?.code === "MODULE_NOT_FOUND") {
        missing.push(dep);
      } else {
        throw new ActionDockError(
          DEPENDENCIES_NOT_READY,
          `Failed to resolve dependency '${dep}' from '${pkgJsonPath}': ${err?.message || String(err)}`,
          { dependency: dep, path: pkgJsonPath, cause: err }
        );
      }
    }
  }

  return {
    ready: missing.length === 0,
    missing,
    requiredCount: requiredDeps.length,
  };
}

/**
 * 确保项目所需生产依赖处于就绪状态。
 *
 * 核心设计原则：
 * - 仅在所需必需生产依赖未物化、且安装根及工作区未探测到已有依赖目录时自动触发首次依赖安装；
 * - 已有 node_modules 但依赖缺失或损坏时不自动重建，抛出 DEPENDENCIES_NOT_READY 并提供修复指引；
 * - 明确禁止安装时（--no-install 或 ACTIONDOCK_AUTO_INSTALL=false），抛出 DEPENDENCIES_NOT_READY；
 * - 存在未恢复的悬空事务时，抛出 PROJECT_RECOVERY_REQUIRED；
 * - 取消信号生效时抛出 ACTION_CANCELLED；
 * - 受工程排他锁保护，并发冲突时抛出 PROJECT_BUSY。
 *
 * @param packageRoot 目标包根目录
 * @param options 执行选项
 */
export async function ensureProjectDependencies(
  requestedPackageRoot: string,
  options: EnsureProjectDependenciesOptions = {}
): Promise<EnsureProjectDependenciesResult> {
  const rootResolution = resolveInstallRoot(requestedPackageRoot);
  if (rootResolution.skip || !rootResolution.installRoot) {
    return { installed: false };
  }

  const packageRoot = resolvePackageDirectory(requestedPackageRoot);
  const installRoot = rootResolution.installRoot;

  // 1. 快速检查：若必需生产依赖已物化，直接返回无需持锁
  const initialStatus = checkDependenciesMaterialized(packageRoot);
  if (initialStatus.ready) {
    return { installed: false, installRoot };
  }

  // 2. 依赖未就绪场景判定
  const existingNm = findExistingNodeModules(
    installRoot,
    packageRoot,
    rootResolution.isWorkspace,
    rootResolution.workspacePatterns
  );
  const allowInstall =
    options.install !== false && process.env.ACTIONDOCK_AUTO_INSTALL !== "false";

  if (existingNm) {
    throw new ActionDockError(
      DEPENDENCIES_NOT_READY,
      `Dependencies in '${packageRoot}' are not ready. Missing direct production dependencies: ${initialStatus.missing.join(", ")}. Existing node_modules found in '${existingNm}', but required packages are missing or damaged. Please run 'npm install' or 'bun install' manually in '${installRoot}'.`,
      {
        stage: "existing-node-modules-check",
        installRoot,
        packageRoot,
        existingNodeModules: existingNm,
        missingDependencies: initialStatus.missing,
        hint: `Run 'npm install' or 'bun install' manually in '${installRoot}'.`,
      }
    );
  }

  if (!allowInstall) {
    throw new ActionDockError(
      DEPENDENCIES_NOT_READY,
      `Dependencies in '${packageRoot}' are not ready. Missing direct production dependencies: ${initialStatus.missing.join(", ")}. Automatic installation is disabled (--no-install or ACTIONDOCK_AUTO_INSTALL=false). Please run 'npm install' or 'bun install' in '${installRoot}'.`,
      {
        stage: "first-install-check",
        installRoot,
        packageRoot,
        missingDependencies: initialStatus.missing,
        hint: `Run 'npm install' or 'bun install' in '${installRoot}'.`,
      }
    );
  }

  // 3. 检查悬空事务与提前取消
  if (options.signal?.aborted) {
    throw new ActionDockError(
      ACTION_CANCELLED,
      "Dependency installation was cancelled before starting."
    );
  }

  if (hasPendingTransactions(installRoot)) {
    throw new ActionDockError(
      PROJECT_RECOVERY_REQUIRED,
      `PROJECT_RECOVERY_REQUIRED: Project at '${installRoot}' has pending transactions requiring recovery before installing dependencies.`
    );
  }

  // 4. 获取工程排他锁并在锁内复核状态
  const releaseLock = acquireProjectLock(installRoot);

  try {
    if (options.signal?.aborted) {
      throw new ActionDockError(
        ACTION_CANCELLED,
        "Dependency installation was cancelled before starting."
      );
    }

    if (hasPendingTransactions(installRoot)) {
      throw new ActionDockError(
        PROJECT_RECOVERY_REQUIRED,
        `PROJECT_RECOVERY_REQUIRED: Project at '${installRoot}' has pending transactions requiring recovery before installing dependencies.`
      );
    }

    const lockedStatus = checkDependenciesMaterialized(packageRoot);
    if (lockedStatus.ready) {
      return { installed: false, installRoot };
    }

    const lockedExistingNm = findExistingNodeModules(
      installRoot,
      packageRoot,
      rootResolution.isWorkspace,
      rootResolution.workspacePatterns
    );
    if (lockedExistingNm) {
      throw new ActionDockError(
        DEPENDENCIES_NOT_READY,
        `Dependencies in '${packageRoot}' are not ready. Existing node_modules found in '${lockedExistingNm}' after lock acquisition, but required packages are missing. Run 'npm install' or 'bun install' manually in '${installRoot}'.`,
        {
          stage: "locked-node-modules-check",
          installRoot,
          packageRoot,
          existingNodeModules: lockedExistingNm,
          missingDependencies: lockedStatus.missing,
          hint: `Run 'npm install' or 'bun install' manually in '${installRoot}'.`,
        }
      );
    }

    // 5. 依赖声明与包管理器决策
    const hasPnpmLock = existsSync(join(installRoot, "pnpm-lock.yaml"));
    const hasYarnLock = existsSync(join(installRoot, "yarn.lock"));
    const hasNpmLock =
      existsSync(join(installRoot, "package-lock.json")) ||
      existsSync(join(installRoot, "npm-shrinkwrap.json"));
    const hasBunLock =
      existsSync(join(installRoot, "bun.lock")) || existsSync(join(installRoot, "bun.lockb"));

    const lockTypes: string[] = [];
    if (hasNpmLock) lockTypes.push("npm");
    if (hasBunLock) lockTypes.push("bun");
    if (hasPnpmLock) lockTypes.push("pnpm");
    if (hasYarnLock) lockTypes.push("yarn");

    // 检测多锁文件冲突（即便设置 ACTIONDOCK_INSTALLER 也严禁忽略明确锁文件冲突）
    if (lockTypes.length > 1) {
      throw new ActionDockError(
        DEPENDENCY_INSTALL_FAILED,
        `Conflicting lockfiles found in '${installRoot}' (${lockTypes.join(", ")} lockfiles exist). Please clean up conflicting lockfiles.`,
        { stage: "planner", installRoot, conflictingManagers: lockTypes }
      );
    }

    // 识别 package.json.packageManager
    let declaredPm: string | undefined;
    const rootPkgJsonPath = join(installRoot, "package.json");
    if (existsSync(rootPkgJsonPath)) {
      try {
        const rootPkg = JSON.parse(readFileSync(rootPkgJsonPath, "utf-8"));
        if (typeof rootPkg?.packageManager === "string") {
          const match = rootPkg.packageManager.trim().match(/^([a-z0-9_-]+)/i);
          if (match) {
            declaredPm = match[1].toLowerCase();
          }
        }
      } catch (error: any) {
        throw new ActionDockError(
          DEPENDENCIES_NOT_READY,
          `Cannot read package manager declaration at '${rootPkgJsonPath}': ${error?.message || String(error)}`,
          { path: rootPkgJsonPath, cause: error }
        );
      }
    }

    if (declaredPm === "pnpm" || (hasPnpmLock && lockTypes.length === 1)) {
      throw new ActionDockError(
        DEPENDENCIES_NOT_READY,
        `Detected pnpm project (${hasPnpmLock ? "pnpm-lock.yaml found" : `packageManager: '${declaredPm}'`}) in '${installRoot}'. Automatic installation only supports npm and bun. Please install dependencies manually using pnpm.`,
        { stage: "planner", installRoot, manager: "pnpm" }
      );
    }

    if (declaredPm === "yarn" || (hasYarnLock && lockTypes.length === 1)) {
      throw new ActionDockError(
        DEPENDENCIES_NOT_READY,
        `Detected yarn project (${hasYarnLock ? "yarn.lock found" : `packageManager: '${declaredPm}'`}) in '${installRoot}'. Automatic installation only supports npm and bun. Please install dependencies manually using yarn.`,
        { stage: "planner", installRoot, manager: "yarn" }
      );
    }

    if (declaredPm && declaredPm !== "npm" && declaredPm !== "bun") {
      throw new ActionDockError(
        DEPENDENCY_INSTALL_FAILED,
        `Unsupported packageManager '${declaredPm}' declared in '${rootPkgJsonPath}'. Automatic installation only supports npm and bun.`,
        { stage: "planner", installRoot, manager: declaredPm }
      );
    }

    if (declaredPm && lockTypes.length === 1) {
      const lockPm = lockTypes[0];
      if (declaredPm !== lockPm) {
        throw new ActionDockError(
          DEPENDENCY_INSTALL_FAILED,
          `Declared packageManager '${declaredPm}' conflicts with existing ${lockPm} lockfile in '${installRoot}'.`,
          { stage: "planner", installRoot, declaredManager: declaredPm, lockManager: lockPm }
        );
      }
    }

    const envInstaller = process.env.ACTIONDOCK_INSTALLER?.trim();
    if (envInstaller) {
      if (envInstaller !== "npm" && envInstaller !== "bun") {
        throw new ActionDockError(
          DEPENDENCY_INSTALL_FAILED,
          `Unsupported ACTIONDOCK_INSTALLER '${envInstaller}'. Allowed values: npm, bun.`
        );
      }
      if (lockTypes.length === 1 && envInstaller !== lockTypes[0]) {
        throw new ActionDockError(
          DEPENDENCY_INSTALL_FAILED,
          `Explicit ACTIONDOCK_INSTALLER '${envInstaller}' conflicts with existing ${lockTypes[0]} lockfile in '${installRoot}'.`,
          { stage: "planner", installRoot, envInstaller, lockManager: lockTypes[0] }
        );
      }
      if (declaredPm && envInstaller !== declaredPm) {
        throw new ActionDockError(
          DEPENDENCY_INSTALL_FAILED,
          `Explicit ACTIONDOCK_INSTALLER '${envInstaller}' conflicts with declared packageManager '${declaredPm}' in '${installRoot}'.`,
          { stage: "planner", installRoot, envInstaller, declaredManager: declaredPm }
        );
      }
    }

    let pm: "npm" | "bun";
    let hasLock = false;

    if (envInstaller) {
      pm = envInstaller as "npm" | "bun";
      hasLock = pm === "npm" ? hasNpmLock : hasBunLock;
    } else if (declaredPm) {
      pm = declaredPm as "npm" | "bun";
      hasLock = pm === "npm" ? hasNpmLock : hasBunLock;
    } else if (hasBunLock) {
      pm = "bun";
      hasLock = true;
    } else if (hasNpmLock) {
      pm = "npm";
      hasLock = true;
    } else {
      pm = "npm";
      hasLock = false;
    }

    let args: string[];
    if (pm === "npm") {
      if (hasLock) {
        args = ["ci", "--omit=dev", "--ignore-scripts"];
      } else {
        args = ["install", "--omit=dev", "--ignore-scripts"];
      }
    } else {
      if (hasLock) {
        args = ["install", "--production", "--frozen-lockfile", "--ignore-scripts"];
      } else {
        args = ["install", "--production", "--ignore-scripts"];
      }
    }

    const reportProgress = (msg: string) => {
      try {
        if (options.onProgress) {
          options.onProgress(msg);
        } else {
          process.stderr.write(msg);
        }
      } catch (error: any) {
        throw new ActionDockError(
          DEPENDENCY_INSTALL_FAILED,
          `Cannot report dependency installation progress: ${error?.message || String(error)}`,
          { stage: "progress", installRoot, manager: pm, cause: error }
        );
      }
    };

    reportProgress(
      `[actiondock] Installing dependencies in ${installRoot} (${pm} ${args.join(" ")})...\n`
    );

    const timeoutMs = options.timeoutMs ?? 300_000;
    const env: Record<string, string | undefined> = {
      ...process.env,
      npm_config_allow_scripts: "",
      NPM_CONFIG_ALLOW_SCRIPTS: "",
      npm_config_ignore_scripts: "true",
      NPM_CONFIG_IGNORE_SCRIPTS: "true",
    };

    let procResult: CommandExecutionResult;
    try {
      procResult = await runPackageManager(pm, args, {
        cwd: installRoot,
        env,
        timeoutMs,
        signal: options.signal,
        driver: options.processDriver,
        onOutput: (_stream, text) => {
          reportProgress(text);
        },
      });
    } catch (err: any) {
      if (err?.code === "PROCESS_CANCELLED" || err?.name === "AbortError" || options.signal?.aborted) {
        throw new ActionDockError(
          ACTION_CANCELLED,
          `Dependency installation in '${installRoot}' was cancelled by signal.`,
          { stage: "install", manager: pm, cwd: installRoot, cause: err }
        );
      }
      if (err?.code === "PROCESS_TIMEOUT") {
        throw new ActionDockError(
          DEPENDENCY_INSTALL_FAILED,
          `Dependency installation timed out after ${timeoutMs}ms in '${installRoot}'.`,
          { stage: "install", manager: pm, cwd: installRoot, timeoutMs, cause: err }
        );
      }
      if (err instanceof ActionDockError && err.code === DEPENDENCY_INSTALL_FAILED) {
        throw err;
      }
      throw new ActionDockError(
        DEPENDENCY_INSTALL_FAILED,
        `Dependency installation failed in '${installRoot}': ${err?.message || String(err)}`,
        { stage: "install", manager: pm, cwd: installRoot, cause: err }
      );
    }

    if (procResult.status !== 0) {
      if (procResult.status === 130 || procResult.signal === "SIGINT" || options.signal?.aborted) {
        throw new ActionDockError(
          ACTION_CANCELLED,
          `Dependency installation in '${installRoot}' was cancelled by signal.`,
          { stage: "install", manager: pm, cwd: installRoot, status: procResult.status, signal: procResult.signal }
        );
      }
      const errMsg = (procResult.stderr || procResult.stdout || `Exit code ${procResult.status}`).trim();
      throw new ActionDockError(
        DEPENDENCY_INSTALL_FAILED,
        `Dependency installation failed in '${installRoot}':\n${errMsg}`,
        {
          stage: "install",
          installRoot,
          manager: pm,
          status: procResult.status,
          stderr: procResult.stderr,
          stdout: procResult.stdout,
        }
      );
    }

    // 6. 安装后检验：必需直接生产依赖元数据已物化
    const postStatus = checkDependenciesMaterialized(packageRoot);
    if (!postStatus.ready) {
      throw new ActionDockError(
        DEPENDENCY_INSTALL_FAILED,
        `Dependencies in '${packageRoot}' are still not resolvable after installation: ${postStatus.missing.join(", ")}`,
        {
          stage: "post-install-verify",
          installRoot,
          packageRoot,
          missingDependencies: postStatus.missing,
        }
      );
    }

    return { installed: true, installRoot, packageManager: pm };
  } finally {
    releaseLock();
  }
}
