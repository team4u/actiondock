import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { listLinkedPackages } from "../registry/registry";
import { computeManifestDigest, parseJsonWithoutDuplicates } from "./digest";
import { loadLockfile, type ActionDockLockfile } from "./lockfile";
import { loadPlaybooks } from "./loader";
import { loadManifest, MANIFEST_FILE_NAME } from "./manifest";
import type { ActionDockManifest, PlaybookDefinition } from "./types";

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
 * 解析基础 SemVer 版本字符串。
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
 * 校验两个语义化版本范围是否兼容并能收敛为单一解析版本。
 * 遵循设计规范：直接或传递版本范围无法收敛时拒绝并抛出 ACTION_PACKAGE_VERSION_CONFLICT。
 */
export function areVersionsCompatible(v1: string, v2: string): boolean {
  if (v1 === v2 || v1 === "*" || v2 === "*" || !v1 || !v2) {
    return true;
  }

  // 处理前缀范围符（如 ^1.0.0, ~1.0.0）
  const clean1 = v1.trim().replace(/^[\^~=]/, "");
  const clean2 = v2.trim().replace(/^[\^~=]/, "");

  const sem1 = parseSemVer(clean1);
  const sem2 = parseSemVer(clean2);

  if (!sem1 || !sem2) {
    // 非标准 SemVer 时按字面匹配
    return v1 === v2;
  }

  // 若存在主版本号不一致，则严格视为不兼容
  if (sem1.major !== sem2.major) {
    return false;
  }

  // 若带波浪号（~1.2.0），次版本号必须一致
  if (v1.startsWith("~") || v2.startsWith("~")) {
    if (sem1.minor !== sem2.minor) {
      return false;
    }
  }

  return true;
}

/**
 * 版本冲突错误。
 */
export class ActionPackageVersionConflictError extends Error {
  readonly code = "ACTION_PACKAGE_VERSION_CONFLICT";
  readonly packageId: string;
  readonly conflicts: Array<{ requester: string; rangeOrVersion: string }>;

  constructor(packageId: string, conflicts: Array<{ requester: string; rangeOrVersion: string }>) {
    const details = conflicts.map((c) => `'${c.requester}' 要求 '${c.rangeOrVersion}'`).join(", ");
    super(`ACTION_PACKAGE_VERSION_CONFLICT: 逻辑包 '${packageId}' 存在不可收敛的版本冲突: ${details}`);
    this.name = "ActionPackageVersionConflictError";
    this.packageId = packageId;
    this.conflicts = conflicts;
  }
}

/**
 * 未声明依赖调用拦截错误。
 */
export class UndeclaredActionDependencyError extends Error {
  readonly code = "UNDECLARED_ACTION_DEPENDENCY";
  readonly targetRef: string;
  readonly caller?: string;

  constructor(targetRef: string, caller?: string, reason?: string) {
    const msg = caller
      ? `UNDECLARED_ACTION_DEPENDENCY: Action '${caller}' 未在 'uses' 中声明对 '${targetRef}' 的跨包依赖`
      : `UNDECLARED_ACTION_DEPENDENCY: 根调用 Action '${targetRef}' 被拒绝: 目标包既非 actiondock.json 直接依赖，亦未被可见 Playbook 委托${reason ? ` (${reason})` : ""}`;
    super(msg);
    this.name = "UndeclaredActionDependencyError";
    this.targetRef = targetRef;
    this.caller = caller;
  }
}

/**
 * 已解析 Action 包信息。
 */
export interface ResolvedPackageInfo {
  packageId: string;
  npmPackage: string;
  version: string;
  packageRoot: string;
  manifest: ActionDockManifest;
  manifestDigest: string;
  isDirect: boolean;
  isRoot: boolean;
}

/**
 * 完整 Action 包依赖图结构。
 */
export interface DependencyGraph {
  rootPackageId: string;
  packages: Map<string, ResolvedPackageInfo>;
  directDependencyIds: Set<string>;
  transitiveDependencyIds: Set<string>;
  visiblePlaybooks: Map<string, PlaybookDefinition>;
  delegatedActions: Set<string>;
}

export interface ActionPackageResolverOptions {
  projectRoot: string;
  manifest?: ActionDockManifest;
  lockfile?: ActionDockLockfile;
  allowDevLinks?: boolean;
  customHome?: string;
  packageRoots?: Record<string, string>;
}

/**
 * 依赖解析器 ActionPackageResolver。
 * 负责从 actiondock.json.dependencies 与 actiondock.lock.json 建立包索引与依赖闭包，
 * 实施版本冲突检测与调用可见性鉴权。
 */
export class ActionPackageResolver {
  readonly projectRoot: string;
  private options: ActionPackageResolverOptions;
  private resolvedGraph?: DependencyGraph;

  constructor(options: ActionPackageResolverOptions) {
    this.projectRoot = resolve(options.projectRoot);
    this.options = { ...options, projectRoot: this.projectRoot };
  }

  /**
   * 同步解析依赖图。
   */
  resolveSync(): DependencyGraph {
    if (this.resolvedGraph) {
      return this.resolvedGraph;
    }

    const rootManifest: ActionDockManifest =
      this.options.manifest ||
      loadManifest(this.projectRoot) || {
        id: basename(this.projectRoot),
        version: "0.1.0",
      };

    const rootPackageId = rootManifest.id;
    const lockfile = this.options.lockfile ?? loadLockfile(this.projectRoot);

    const packages = new Map<string, ResolvedPackageInfo>();
    const directDependencyIds = new Set<string>();
    const transitiveDependencyIds = new Set<string>();
    const versionRequirements = new Map<string, Array<{ requester: string; rangeOrVersion: string }>>();

    // 记录根包自身
    const rootDigest = computeManifestDigest(rootManifest);
    packages.set(rootPackageId, {
      packageId: rootPackageId,
      npmPackage: rootPackageId,
      version: rootManifest.version || "0.1.0",
      packageRoot: this.projectRoot,
      manifest: rootManifest,
      manifestDigest: rootDigest,
      isDirect: true,
      isRoot: true,
    });
    directDependencyIds.add(rootPackageId);

    // 探测开发本地软链接覆盖
    const devLinkMap = new Map<string, string>();
    if (this.options.allowDevLinks) {
      try {
        const linked = listLinkedPackages(this.options.customHome);
        for (const entry of linked) {
          if (existsSync(entry.path)) {
            devLinkMap.set(entry.id, entry.path);
          }
        }
      } catch {
        // 忽略扫描外部链接包异常
      }
    }

    function recordRequirement(pkgId: string, requester: string, rangeOrVersion: string): void {
      const existing = versionRequirements.get(pkgId) || [];
      for (const req of existing) {
        if (!areVersionsCompatible(req.rangeOrVersion, rangeOrVersion)) {
          throw new ActionPackageVersionConflictError(pkgId, [
            req,
            { requester, rangeOrVersion },
          ]);
        }
      }
      existing.push({ requester, rangeOrVersion });
      versionRequirements.set(pkgId, existing);
    }

    // 广度优先遍历解析直接与间接依赖
    const queue: Array<{
      pkgId: string;
      requester: string;
      rangeOrSpec: string;
      isDirect: boolean;
    }> = [];

    for (const [depId, spec] of Object.entries(rootManifest.dependencies || {})) {
      directDependencyIds.add(depId);
      recordRequirement(depId, rootPackageId, spec);
      queue.push({
        pkgId: depId,
        requester: rootPackageId,
        rangeOrSpec: spec,
        isDirect: true,
      });
    }

    while (queue.length > 0) {
      const item = queue.shift()!;
      if (packages.has(item.pkgId)) {
        continue;
      }

      // 寻址包安装根目录
      let pkgDir: string | null = null;
      const locked = lockfile?.packages?.[item.pkgId];

      // 优先级：显式注入路径 -> 开发软链接覆盖 -> 锁文件记录 -> node_modules 探测
      if (this.options.packageRoots?.[item.pkgId]) {
        pkgDir = this.options.packageRoots[item.pkgId];
      } else if (devLinkMap.has(item.pkgId)) {
        pkgDir = devLinkMap.get(item.pkgId)!;
      } else {
        const candidateNames: string[] = [];
        if (locked?.npmPackage) {
          candidateNames.push(locked.npmPackage);
        }
        candidateNames.push(item.rangeOrSpec);
        candidateNames.push(item.pkgId);

        let cur = this.projectRoot;
        while (true) {
          for (const candName of candidateNames) {
            const candPath = join(cur, "node_modules", candName);
            if (existsSync(candPath) && existsSync(join(candPath, MANIFEST_FILE_NAME))) {
              pkgDir = candPath;
              break;
            }
          }
          if (pkgDir) break;
          const parent = dirname(cur);
          if (parent === cur) break;
          cur = parent;
        }
      }

      if (!pkgDir || !existsSync(pkgDir)) {
        throw new Error(
          `PACKAGE_NOT_FOUND: Package '${item.pkgId}' required by '${item.requester}' is not installed in ${this.projectRoot}. Please run 'ad add ${item.rangeOrSpec}'.`
        );
      }

      const manifestPath = join(pkgDir, MANIFEST_FILE_NAME);
      if (!existsSync(manifestPath)) {
        throw new Error(
          `Action package '${item.pkgId}' at '${pkgDir}' misses required manifest 'actiondock.json'`
        );
      }

      let manifestRaw: string;
      try {
        manifestRaw = readFileSync(manifestPath, "utf-8");
      } catch (err: any) {
        throw new Error(`Failed to read manifest for '${item.pkgId}': ${err.message}`);
      }

      const depManifest = parseJsonWithoutDuplicates<ActionDockManifest>(manifestRaw);
      const actualDigest = computeManifestDigest(depManifest);

      // 锁文件摘要校验
      if (locked?.manifestDigest && locked.manifestDigest !== actualDigest) {
        throw new Error(
          `Manifest digest mismatch for package '${item.pkgId}': expected '${locked.manifestDigest}', got '${actualDigest}'. Re-resolution required.`
        );
      }

      const pkgVersion = depManifest.version || locked?.version || "0.1.0";
      // 校验版本是否满足已知要求
      const reqs = versionRequirements.get(item.pkgId) || [];
      for (const req of reqs) {
        if (!areVersionsCompatible(req.rangeOrVersion, pkgVersion)) {
          throw new ActionPackageVersionConflictError(item.pkgId, [
            req,
            { requester: item.pkgId, rangeOrVersion: pkgVersion },
          ]);
        }
      }

      const info: ResolvedPackageInfo = {
        packageId: item.pkgId,
        npmPackage: locked?.npmPackage || item.rangeOrSpec,
        version: pkgVersion,
        packageRoot: pkgDir,
        manifest: depManifest,
        manifestDigest: actualDigest,
        isDirect: item.isDirect,
        isRoot: false,
      };

      packages.set(item.pkgId, info);
      if (!item.isDirect) {
        transitiveDependencyIds.add(item.pkgId);
      }

      // 继续搜寻传递依赖
      for (const [subDepId, subSpec] of Object.entries(depManifest.dependencies || {})) {
        recordRequirement(subDepId, item.pkgId, subSpec);
        if (!packages.has(subDepId)) {
          queue.push({
            pkgId: subDepId,
            requester: item.pkgId,
            rangeOrSpec: subSpec,
            isDirect: false,
          });
        }
      }
    }

    // 收集可见 Playbook 与被委托 Action
    const visiblePlaybooks = new Map<string, PlaybookDefinition>();
    const delegatedActions = new Set<string>();

    // 根包 Playbooks
    try {
      const rootPbs = loadPlaybooks(this.projectRoot);
      for (const [id, pb] of rootPbs.entries()) {
        visiblePlaybooks.set(id, pb);
        visiblePlaybooks.set(`${rootPackageId}/${id}`, pb);
      }
    } catch {
      // 忽略根包 Playbook 加载异常
    }

    // 直接依赖包 Playbooks
    for (const depId of directDependencyIds) {
      if (depId === rootPackageId) continue;
      const depPkg = packages.get(depId);
      if (depPkg) {
        try {
          const depPbs = loadPlaybooks(depPkg.packageRoot);
          for (const [id, pb] of depPbs.entries()) {
            visiblePlaybooks.set(`${depId}/${id}`, pb);
          }
        } catch {
          // 忽略依赖包 Playbook 加载异常
        }
      }
    }

    // 可见 Playbook 点名委托的 Action 收集
    for (const pb of visiblePlaybooks.values()) {
      if (Array.isArray(pb.actions)) {
        for (const actRef of pb.actions) {
          if (typeof actRef === "string" && actRef.trim()) {
            delegatedActions.add(actRef.trim());
          }
        }
      }
    }

    this.resolvedGraph = {
      rootPackageId,
      packages,
      directDependencyIds,
      transitiveDependencyIds,
      visiblePlaybooks,
      delegatedActions,
    };

    return this.resolvedGraph;
  }

  /**
   * 异步解析依赖图。
   */
  async resolve(): Promise<DependencyGraph> {
    return this.resolveSync();
  }

  /**
   * 判定目标 Action 是否允许作为根调用发起。
   * 规则：
   * - 目标属于当前根包；
   * - 目标属于 actiondock.json 直接依赖；
   * - 目标属于可见 Playbook 精确委托点名的 Action。
   */
  canRootCall(targetPackageId: string, targetActionId: string): boolean {
    const graph = this.resolveSync();
    if (targetPackageId === graph.rootPackageId) {
      return true;
    }
    if (graph.directDependencyIds.has(targetPackageId)) {
      return true;
    }
    const qualifiedRef = `${targetPackageId}/${targetActionId}`;
    if (graph.delegatedActions.has(qualifiedRef)) {
      return true;
    }
    return false;
  }

  /**
   * 校验根调用权限，不合法时抛出 UNDECLARED_ACTION_DEPENDENCY。
   */
  assertRootCallAllowed(targetPackageId: string, targetActionId: string): void {
    if (!this.canRootCall(targetPackageId, targetActionId)) {
      throw new UndeclaredActionDependencyError(`${targetPackageId}/${targetActionId}`);
    }
  }

  /**
   * 判定跨包级联调用是否合法。
   * 规则：调用者 Action 必须在 actiondock.json 的 uses 中显式声明对目标 Action 的依赖。
   */
  canCascadeCall(
    callerPackageId: string,
    callerActionId: string,
    targetPackageId: string,
    targetActionId: string
  ): boolean {
    if (callerPackageId === targetPackageId) {
      return true;
    }

    const graph = this.resolveSync();
    const callerPkg = graph.packages.get(callerPackageId);
    if (!callerPkg) {
      return false;
    }

    const callerActionEntry = callerPkg.manifest.actions?.[callerActionId];
    const usesList = callerActionEntry?.uses || [];
    const targetRef = `${targetPackageId}/${targetActionId}`;

    return usesList.some(
      (u) => u === targetRef || u === `${targetPackageId}/*` || u === targetPackageId
    );
  }

  /**
   * 校验跨包级联调用权限，不合法时抛出 UNDECLARED_ACTION_DEPENDENCY。
   */
  assertCascadeCallAllowed(
    callerPackageId: string,
    callerActionId: string,
    targetPackageId: string,
    targetActionId: string
  ): void {
    if (!this.canCascadeCall(callerPackageId, callerActionId, targetPackageId, targetActionId)) {
      throw new UndeclaredActionDependencyError(
        `${targetPackageId}/${targetActionId}`,
        `${callerPackageId}/${callerActionId}`
      );
    }
  }
}
