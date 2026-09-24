import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import {
  ActionDockError,
  ACTION_PACKAGE_VERSION_CONFLICT,
  PACKAGE_NOT_FOUND,
  UNDECLARED_ACTION_DEPENDENCY,
} from "../errors";
import { computeManifestDigest, parseJsonWithoutDuplicates } from "../project/digest";
import { loadLockfile, type ActionDockLockfile } from "../project/lockfile";
import { loadPlaybooks, loadProjectConfig } from "../project/loader";
import { loadManifest, MANIFEST_FILE_NAME } from "../project/manifest";
import type { ActionDockManifest, PlaybookDefinition } from "../project/types";
import { listLinkedPackages } from "../registry/registry";
import { createPackageIdentity, type PackageIdentity } from "../runtime/identity";
import { parseSemVer, type SemVer } from "../utils";
import { PackageDiscovery, type DiscoveredPackage, type PackageDiscoveryOptions } from "./discovery";

// 维持既有对外导出面：SemVer 与 parseSemVer 的单一事实源已上移 utils，此处转引保持兼容。
export type { SemVer };
export { parseSemVer };

/**
 * 校验两个语义化版本范围是否兼容并能收敛为单一解析版本。
 * 遵循设计规范：直接或传递版本范围无法收敛时拒绝并抛出 ACTION_PACKAGE_VERSION_CONFLICT。
 */
export function areVersionsCompatible(v1: string, v2: string): boolean {
  if (v1 === v2 || v1 === "*" || v2 === "*" || !v1 || !v2) {
    return true;
  }

  const clean1 = v1.trim().replace(/^[\^~=]/, "");
  const clean2 = v2.trim().replace(/^[\^~=]/, "");

  const sem1 = parseSemVer(clean1);
  const sem2 = parseSemVer(clean2);

  if (!sem1 || !sem2) {
    return v1 === v2;
  }

  if (sem1.major !== sem2.major) {
    return false;
  }

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
export class ActionPackageVersionConflictError extends ActionDockError {
  readonly packageId: string;
  readonly conflicts: Array<{ requester: string; rangeOrVersion: string }>;

  constructor(packageId: string, conflicts: Array<{ requester: string; rangeOrVersion: string }>) {
    const details = conflicts.map((c) => `'${c.requester}' 要求 '${c.rangeOrVersion}'`).join(", ");
    super(
      ACTION_PACKAGE_VERSION_CONFLICT,
      `ACTION_PACKAGE_VERSION_CONFLICT: 逻辑包 '${packageId}' 存在不可收敛的版本冲突: ${details}`
    );
    this.name = "ActionPackageVersionConflictError";
    this.packageId = packageId;
    this.conflicts = conflicts;
    Object.setPrototypeOf(this, ActionPackageVersionConflictError.prototype);
  }
}

/**
 * 未声明依赖调用拦截错误。
 */
export class UndeclaredActionDependencyError extends ActionDockError {
  readonly targetRef: string;
  readonly caller?: string;

  constructor(targetRef: string, caller?: string, reason?: string) {
    const msg = caller
      ? `UNDECLARED_ACTION_DEPENDENCY: Action '${caller}' 未在 'uses' 中声明对 '${targetRef}' 的跨包依赖`
      : `UNDECLARED_ACTION_DEPENDENCY: 根调用 Action '${targetRef}' 被拒绝: 目标包既非 actiondock.json 直接依赖，亦未被可见 Playbook 委托${reason ? ` (${reason})` : ""}`;
    super(UNDECLARED_ACTION_DEPENDENCY, msg);
    this.name = "UndeclaredActionDependencyError";
    this.targetRef = targetRef;
    this.caller = caller;
    Object.setPrototypeOf(this, UndeclaredActionDependencyError.prototype);
  }
}

/**
 * 判定单一 uses 声明项是否命中目标 Action（跨包调用授权单一事实源）。
 *
 * 匹配语义（安全铁律，逐字不变）：
 * - 完全限定名：`<targetPackageId>/<targetActionId>`；
 * - 包级通配符：`<targetPackageId>/*`；
 * - 裸包名：`<targetPackageId>`。
 *
 * DefaultPackageGraph.canCascadeCall 与 InvocationPolicy.checkUsesAuthorization
 * 必须统一经由本谓词判定，禁止在调用点另建重复表达式分叉。
 */
export function isUsesDeclared(
  use: string,
  targetPackageId: string,
  targetActionId: string
): boolean {
  return (
    use === `${targetPackageId}/${targetActionId}` ||
    use === `${targetPackageId}/*` ||
    use === targetPackageId
  );
}

/**
 * 包图拓扑节点定义。
 */
export interface PackageNode {
  /** 包唯一身份标识值对象 */
  readonly identity: PackageIdentity;
  /** 逻辑包唯一标识符（等同于 identity.id） */
  readonly packageId: string;
  /** 包根目录绝对物理路径 */
  readonly root: string;
  /** 包清单规范 */
  readonly manifest: ActionDockManifest;
  /** 包清单摘要哈希 */
  readonly manifestDigest: string;
  /** 包版本号 */
  readonly version: string;
  /** npm 包名或引用规格 */
  readonly npmPackage: string;
  /** 直接依赖包标识集合 */
  readonly directDependencies: Set<string>;
  /** 传递依赖闭包标识集合 */
  readonly transitiveDependencies: Set<string>;
  /** 是否为直接依赖 */
  readonly isDirect?: boolean;
  /** 是否为当前工程根包 */
  readonly isRoot?: boolean;
}

/**
 * 完整包依赖拓扑图 PackageGraph 契约。
 */
export interface PackageGraph {
  /** 当前工程根包身份（若存在） */
  readonly root?: PackageIdentity;
  /** 根包标识（快捷访问） */
  readonly rootPackageId?: string;
  /** 全局或当前工程全部包节点映射（按 packageId 索引） */
  readonly packages: Map<string, PackageNode>;
  /** 根包直接依赖包标识集合 */
  readonly directDependencyIds: ReadonlySet<string>;
  /** 根包传递依赖闭包标识集合 */
  readonly transitiveDependencyIds: ReadonlySet<string>;
  /** 可见 Playbook 映射 */
  readonly visiblePlaybooks: Map<string, PlaybookDefinition>;
  /** 可见 Playbook 委托点名的 Action 集合 */
  readonly delegatedActions: ReadonlySet<string>;

  /**
   * 按包标识获取指定节点。
   */
  getPackage(id: string): PackageNode | undefined;

  /**
   * 按包标识获取指定节点（统一契约）。
   */
  getNode(id: string): PackageNode | undefined;

  /**
   * 判定是否存在指定包节点。
   */
  hasPackage(id: string): boolean;

  /**
   * 判定目标 Action 是否允许作为根调用发起。
   */
  canRootCall(targetPackageId: string, targetActionId: string): boolean;

  /**
   * 校验根调用权限，不合法时抛出 UndeclaredActionDependencyError。
   */
  assertRootCallAllowed(targetPackageId: string, targetActionId: string): void;

  /**
   * 判定跨包级联调用是否合法。
   */
  canCascadeCall(
    callerPackageId: string,
    callerActionId: string,
    targetPackageId: string,
    targetActionId: string
  ): boolean;

  /**
   * 校验跨包级联调用权限，不合法时抛出 UndeclaredActionDependencyError。
   */
  assertCascadeCallAllowed(
    callerPackageId: string,
    callerActionId: string,
    targetPackageId: string,
    targetActionId: string
  ): void;
}

/**
 * 默认包依赖图实现。
 */
export class DefaultPackageGraph implements PackageGraph {
  readonly packages: Map<string, PackageNode>;
  readonly root?: PackageIdentity;
  readonly visiblePlaybooks: Map<string, PlaybookDefinition>;
  readonly delegatedActions: ReadonlySet<string>;

  constructor(
    packages: Map<string, PackageNode>,
    root?: PackageIdentity,
    visiblePlaybooks?: Map<string, PlaybookDefinition>,
    delegatedActions?: ReadonlySet<string>
  ) {
    this.packages = packages;
    this.root = root;
    this.visiblePlaybooks = visiblePlaybooks ?? new Map();
    this.delegatedActions = delegatedActions ?? new Set();
  }

  get rootPackageId(): string | undefined {
    return this.root?.id;
  }

  get directDependencyIds(): ReadonlySet<string> {
    if (!this.root) return new Set();
    const rootNode = this.packages.get(this.root.id);
    return rootNode ? rootNode.directDependencies : new Set();
  }

  get transitiveDependencyIds(): ReadonlySet<string> {
    if (!this.root) return new Set();
    const rootNode = this.packages.get(this.root.id);
    return rootNode ? rootNode.transitiveDependencies : new Set();
  }

  getPackage(id: string): PackageNode | undefined {
    return this.packages.get(id);
  }

  getNode(id: string): PackageNode | undefined {
    return this.packages.get(id);
  }

  hasPackage(id: string): boolean {
    return this.packages.has(id);
  }

  canRootCall(targetPackageId: string, targetActionId: string): boolean {
    if (this.root && targetPackageId === this.root.id) {
      return true;
    }
    if (this.directDependencyIds.has(targetPackageId)) {
      return true;
    }
    const qualifiedRef = `${targetPackageId}/${targetActionId}`;
    if (this.delegatedActions.has(qualifiedRef)) {
      return true;
    }
    return false;
  }

  assertRootCallAllowed(targetPackageId: string, targetActionId: string): void {
    if (!this.canRootCall(targetPackageId, targetActionId)) {
      throw new UndeclaredActionDependencyError(`${targetPackageId}/${targetActionId}`);
    }
  }

  canCascadeCall(
    callerPackageId: string,
    callerActionId: string,
    targetPackageId: string,
    targetActionId: string
  ): boolean {
    if (callerPackageId === targetPackageId) {
      return true;
    }

    const callerPkg = this.packages.get(callerPackageId);
    if (!callerPkg) {
      return false;
    }

    const callerActionEntry = callerPkg.manifest.actions?.[callerActionId];
    const usesList = callerActionEntry?.uses || [];

    return usesList.some((u) => isUsesDeclared(u, targetPackageId, targetActionId));
  }

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

/**
 * 包图构建器配置选项。
 */
export interface PackageGraphBuilderOptions {
  /** 预先发现的包集合，若未提供则通过 PackageDiscovery 自动发现 */
  packages?: DiscoveredPackage[];
  /** 根工程根目录或根包标识（与 projectRoot 互为别名） */
  root?: string;
  /** 当前工程根目录绝对或相对物理路径 */
  projectRoot?: string;
  /** 显式根清单 */
  manifest?: ActionDockManifest;
  /** 锁文件规范对象（若未显式提供且 projectRoot 存在，则尝试自动读取 actiondock.lock.json） */
  lockfile?: ActionDockLockfile;
  /** 是否允许扫描与链接开发软链接包（默认根据 discoveryOptions 判定） */
  allowDevLinks?: boolean;
  /** 自定义 ActionDock 主目录路径（用于定位全局链接注册表） */
  customHome?: string;
  /** 显式包根目录映射字典或数组 */
  packageRoots?: Record<string, string> | string[];
  /** 包发现配置（构建器内部调用 PackageDiscovery 时生效） */
  discoveryOptions?: PackageDiscoveryOptions;
  /** 快照代次唯一标识（可选，默认生成 UUID） */
  generationId?: string;
}

/**
 * 构建包节点公共字段（单一事实源：模式 A/B/C 共用，避免节点构造字面量三处拷贝）。
 */
function createPackageNodeFields(params: {
  id: string;
  root: string;
  manifest: ActionDockManifest;
  npmPackage: string;
  isDirect: boolean;
  isRoot: boolean;
  identity?: PackageIdentity;
  generation?: string;
}): {
  identity: PackageIdentity;
  packageId: string;
  root: string;
  manifest: ActionDockManifest;
  manifestDigest: string;
  version: string;
  npmPackage: string;
  directDependencies: Set<string>;
  transitiveDependencies: Set<string>;
  isDirect: boolean;
  isRoot: boolean;
} {
  const digest = computeManifestDigest(params.manifest);
  const identity =
    params.identity ??
    createPackageIdentity({
      id: params.id,
      instanceId: `${params.id}:${params.root}`,
      generation: params.generation ?? "",
    });
  return {
    identity,
    packageId: params.id,
    root: params.root,
    manifest: params.manifest,
    manifestDigest: digest,
    version: params.manifest.version || "0.1.0",
    npmPackage: params.npmPackage,
    directDependencies: new Set<string>(),
    transitiveDependencies: new Set<string>(),
    isDirect: params.isDirect,
    isRoot: params.isRoot,
  };
}

/**
 * 从各包清单的 dependencies 中补全直接依赖边（仅计入图中已存在的包）。
 */
function linkDirectDependencies(nodes: Map<string, PackageNode>): void {
  for (const node of nodes.values()) {
    if (node.manifest.dependencies && typeof node.manifest.dependencies === "object") {
      for (const depId of Object.keys(node.manifest.dependencies)) {
        if (nodes.has(depId)) {
          node.directDependencies.add(depId);
        }
      }
    }
  }
}

/**
 * 以 BFS 计算每个节点的传递依赖闭包（单一事实源，自带环防护）。
 */
function computeTransitiveDependencies(nodes: Map<string, PackageNode>): void {
  for (const node of nodes.values()) {
    const q = Array.from(node.directDependencies);
    const visited = new Set<string>(node.directDependencies);
    while (q.length > 0) {
      const curr = q.shift()!;
      node.transitiveDependencies.add(curr);
      const depNode = nodes.get(curr);
      if (depNode) {
        for (const next of depNode.directDependencies) {
          if (next !== node.identity.id && !visited.has(next)) {
            visited.add(next);
            q.push(next);
          }
        }
      }
    }
  }
}

/**
 * 聚合根包与其直接依赖包的可见 Playbook 及委托点名的 Action（单一事实源）。
 */
function collectVisiblePlaybooks(
  rootNode: PackageNode | undefined,
  nodes: Map<string, PackageNode>
): { visiblePlaybooks: Map<string, PlaybookDefinition>; delegatedActions: Set<string> } {
  const visiblePlaybooks = new Map<string, PlaybookDefinition>();
  const delegatedActions = new Set<string>();
  if (rootNode && rootNode.root && existsSync(rootNode.root)) {
    try {
      const rootPbs = loadPlaybooks(rootNode.root, undefined, rootNode.manifest);
      for (const [id, pb] of rootPbs.entries()) {
        visiblePlaybooks.set(id, pb);
        visiblePlaybooks.set(`${rootNode.packageId}/${id}`, pb);
      }
    } catch {
      // 忽略根包 Playbook 加载异常
    }

    for (const depId of rootNode.directDependencies) {
      if (depId === rootNode.packageId) continue;
      const depNode = nodes.get(depId);
      if (depNode && depNode.root && existsSync(depNode.root)) {
        try {
          const depPbs = loadPlaybooks(depNode.root, undefined, depNode.manifest);
          for (const [id, pb] of depPbs.entries()) {
            visiblePlaybooks.set(`${depId}/${id}`, pb);
          }
        } catch {
          // 忽略依赖包 Playbook 加载异常
        }
      }
    }
  }

  for (const pb of visiblePlaybooks.values()) {
    if (Array.isArray(pb.actions)) {
      for (const actRef of pb.actions) {
        if (typeof actRef === "string" && actRef.trim()) {
          delegatedActions.add(actRef.trim());
        }
      }
    }
  }

  return { visiblePlaybooks, delegatedActions };
}

/**
 * 包依赖拓扑图构建器 PackageGraphBuilder。
 * 输入发现的包集合或工程根目录，统一实施版本冲突检测、lockfile 校验与拓扑图构建。
 */
export class PackageGraphBuilder {
  private readonly options: PackageGraphBuilderOptions;

  constructor(options: PackageGraphBuilderOptions = {}) {
    this.options = options;
  }

  /**
   * 同步构建包依赖拓扑图（模式 A：显式包集合）。
   */
  private buildFromPackages(nodes: Map<string, PackageNode>, generation: string): PackageGraph {
    for (const pkg of this.options.packages!) {
      const fields = createPackageNodeFields({
        id: pkg.id,
        root: pkg.root,
        manifest: pkg.manifest,
        npmPackage: pkg.id,
        isDirect: Boolean(pkg.isCurrentProject),
        isRoot: Boolean(pkg.isCurrentProject),
        identity: pkg.identity,
        generation,
      });
      nodes.set(pkg.id, fields);
    }

    let rootIdentity: PackageIdentity | undefined;
    if (this.options.root) {
      if (nodes.has(this.options.root)) {
        rootIdentity = nodes.get(this.options.root)!.identity;
      } else {
        const absRoot = resolve(this.options.root);
        for (const node of nodes.values()) {
          if (resolve(node.root) === absRoot) {
            rootIdentity = node.identity;
            break;
          }
        }
      }
    }

    if (!rootIdentity) {
      for (const node of nodes.values()) {
        if (node.isRoot) {
          rootIdentity = node.identity;
          break;
        }
      }
    }

    if (rootIdentity) {
      const rootNode = nodes.get(rootIdentity.id);
      if (rootNode) {
        (rootNode as any).isRoot = true;
        (rootNode as any).isDirect = true;
      }
    }

    linkDirectDependencies(nodes);
    computeTransitiveDependencies(nodes);

    const effectiveRootNode = rootIdentity ? nodes.get(rootIdentity.id) : undefined;
    const { visiblePlaybooks, delegatedActions } = collectVisiblePlaybooks(effectiveRootNode, nodes);
    return new DefaultPackageGraph(nodes, rootIdentity, visiblePlaybooks, delegatedActions);
  }

  /**
   * 同步构建包依赖拓扑图（模式 C：全局包发现）。
   */
  private buildFromGlobalDiscovery(nodes: Map<string, PackageNode>, generation: string): PackageGraph {
    const discOpts: PackageDiscoveryOptions = {
      ...this.options.discoveryOptions,
      customHome: this.options.discoveryOptions?.customHome ?? this.options.customHome,
      scanLinkedPackages:
        this.options.discoveryOptions?.scanLinkedPackages ?? this.options.allowDevLinks ?? true,
    };
    const discovered = new PackageDiscovery(discOpts).discoverSync();
    for (const pkg of discovered) {
      const fields = createPackageNodeFields({
        id: pkg.id,
        root: pkg.root,
        manifest: pkg.manifest,
        npmPackage: pkg.id,
        isDirect: Boolean(pkg.isCurrentProject),
        isRoot: Boolean(pkg.isCurrentProject),
        generation,
      });
      nodes.set(pkg.id, fields);
    }

    return new DefaultPackageGraph(nodes);
  }

  /**
   * 同步构建包依赖拓扑图。
   */
  public buildSync(): PackageGraph {
    const projectRoot = this.options.projectRoot || this.options.root;
    const absProjectRoot = projectRoot ? resolve(projectRoot) : undefined;
    const generation = this.options.generationId || crypto.randomUUID();
    const nodes = new Map<string, PackageNode>();

    // 模式 A：显式包集合模式（由 Host.rebuildGraphAndCatalog 或测试直接传入已发现包）
    if (this.options.packages) {
      return this.buildFromPackages(nodes, generation);
    }

    // 模式 B：单工程或根目录依赖解析闭包构建
    if (absProjectRoot) {
      let rootManifest: ActionDockManifest | undefined = this.options.manifest;
      if (!rootManifest && existsSync(absProjectRoot)) {
        try {
          rootManifest = loadManifest(absProjectRoot) || loadProjectConfig(absProjectRoot);
        } catch {
          // 忽略清单加载异常
        }
      }
      if (!rootManifest) {
        rootManifest = {
          id: basename(absProjectRoot),
          version: "0.1.0",
        };
      }

      const rootPackageId = rootManifest.id;
      const rootIdentity = createPackageIdentity({
        id: rootPackageId,
        instanceId: `${rootPackageId}:${absProjectRoot}`,
        generation,
      });

      const rootNode: PackageNode = {
        ...createPackageNodeFields({
          id: rootPackageId,
          root: absProjectRoot,
          manifest: rootManifest,
          npmPackage: rootPackageId,
          isDirect: true,
          isRoot: true,
          identity: rootIdentity,
        }),
      };
      nodes.set(rootPackageId, rootNode);

      const lockfile =
        this.options.lockfile ?? loadLockfile(absProjectRoot);

      const devLinkMap = new Map<string, string>();
      const scanLinked = Boolean(
        this.options.discoveryOptions?.scanLinkedPackages ?? this.options.allowDevLinks
      );
      if (scanLinked) {
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

      const versionRequirements = new Map<string, Array<{ requester: string; rangeOrVersion: string }>>();
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

      const queue: Array<{
        pkgId: string;
        requester: string;
        rangeOrSpec: string;
        isDirect: boolean;
      }> = [];

      for (const [depId, spec] of Object.entries(rootManifest.dependencies || {})) {
        rootNode.directDependencies.add(depId);
        recordRequirement(depId, rootPackageId, spec);
        queue.push({
          pkgId: depId,
          requester: rootPackageId,
          rangeOrSpec: spec,
          isDirect: true,
        });
      }

      const packageRootsRecord =
        this.options.packageRoots && !Array.isArray(this.options.packageRoots)
          ? (this.options.packageRoots as Record<string, string>)
          : undefined;

      while (queue.length > 0) {
        const item = queue.shift()!;
        if (nodes.has(item.pkgId)) {
          const existingNode = nodes.get(item.pkgId)!;
          const pkgVer = existingNode.version || existingNode.manifest.version || "0.1.0";
          const reqs = versionRequirements.get(item.pkgId) || [];
          for (const req of reqs) {
            if (!areVersionsCompatible(req.rangeOrVersion, pkgVer)) {
              throw new ActionPackageVersionConflictError(item.pkgId, [
                req,
                { requester: item.pkgId, rangeOrVersion: pkgVer },
              ]);
            }
          }
          continue;
        }

        let pkgDir: string | null = null;
        const locked = lockfile?.packages?.[item.pkgId];

        if (packageRootsRecord?.[item.pkgId]) {
          pkgDir = packageRootsRecord[item.pkgId];
        } else if (devLinkMap.has(item.pkgId)) {
          pkgDir = devLinkMap.get(item.pkgId)!;
        } else {
          const candidateNames: string[] = [];
          if (locked?.npmPackage) {
            candidateNames.push(locked.npmPackage);
          }
          candidateNames.push(item.rangeOrSpec);
          candidateNames.push(item.pkgId);

          let cur = absProjectRoot;
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
          throw new ActionDockError(
            PACKAGE_NOT_FOUND,
            `PACKAGE_NOT_FOUND: Package '${item.pkgId}' required by '${item.requester}' is not installed in ${absProjectRoot}. Please run 'ad add ${item.rangeOrSpec}'.`
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

        if (locked?.manifestDigest && locked.manifestDigest !== actualDigest) {
          throw new Error(
            `Manifest digest mismatch for package '${item.pkgId}': expected '${locked.manifestDigest}', got '${actualDigest}'. Re-resolution required.`
          );
        }

        const pkgVersion = depManifest.version || locked?.version || "0.1.0";
        const reqs = versionRequirements.get(item.pkgId) || [];
        for (const req of reqs) {
          if (!areVersionsCompatible(req.rangeOrVersion, pkgVersion)) {
            throw new ActionPackageVersionConflictError(item.pkgId, [
              req,
              { requester: item.pkgId, rangeOrVersion: pkgVersion },
            ]);
          }
        }

        const identity = createPackageIdentity({
          id: item.pkgId,
          instanceId: `${item.pkgId}:${pkgDir}`,
          generation,
        });

        const newNode: PackageNode = {
          ...createPackageNodeFields({
            id: item.pkgId,
            root: pkgDir,
            manifest: depManifest,
            npmPackage: locked?.npmPackage || item.rangeOrSpec,
            isDirect: item.isDirect,
            isRoot: false,
            identity,
          }),
        };
        nodes.set(item.pkgId, newNode);

        for (const [subDepId, subSpec] of Object.entries(depManifest.dependencies || {})) {
          recordRequirement(subDepId, item.pkgId, subSpec);
          if (!nodes.has(subDepId)) {
            queue.push({
              pkgId: subDepId,
              requester: item.pkgId,
              rangeOrSpec: subSpec,
              isDirect: false,
            });
          }
        }
      }

      if (scanLinked) {
        for (const [devPkgId, devPkgDir] of devLinkMap.entries()) {
          if (devPkgId !== rootPackageId && !nodes.has(devPkgId) && existsSync(devPkgDir)) {
            const manifestPath = join(devPkgDir, MANIFEST_FILE_NAME);
            if (!existsSync(manifestPath)) continue;
            try {
              const manifestRaw = readFileSync(manifestPath, "utf-8");
              const devManifest = parseJsonWithoutDuplicates<ActionDockManifest>(manifestRaw);
              nodes.set(
                devPkgId,
                createPackageNodeFields({
                  id: devPkgId,
                  root: devPkgDir,
                  manifest: devManifest,
                  npmPackage: devPkgId,
                  isDirect: true,
                  isRoot: false,
                  generation,
                })
              );
              rootNode.directDependencies.add(devPkgId);
            } catch {
              // 忽略解析失败的链接包
            }
          }
        }
      }

      linkDirectDependencies(nodes);
      computeTransitiveDependencies(nodes);

      const { visiblePlaybooks, delegatedActions } = collectVisiblePlaybooks(rootNode, nodes);
      return new DefaultPackageGraph(nodes, rootIdentity, visiblePlaybooks, delegatedActions);
    }

    // 模式 C：全局包发现构建
    return this.buildFromGlobalDiscovery(nodes, generation);
  }

  /**
   * 异步构建包依赖拓扑图。
   */
  public async build(): Promise<PackageGraph> {
    return this.buildSync();
  }
}
