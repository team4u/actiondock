import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import type { ActionDockManifest } from "../project/types";
import { createPackageIdentity, type PackageIdentity } from "../runtime/identity";
import { PackageDiscovery, type DiscoveredPackage, type PackageDiscoveryOptions } from "./discovery";

/**
 * 包图拓扑节点定义。
 */
export interface PackageNode {
  /** 包唯一身份标识值对象 */
  readonly identity: PackageIdentity;
  /** 包根目录绝对物理路径 */
  readonly root: string;
  /** 包清单规范 */
  readonly manifest: ActionDockManifest;
  /** 直接依赖包标识集合 */
  readonly directDependencies: Set<string>;
  /** 传递依赖闭包标识集合 */
  readonly transitiveDependencies: Set<string>;
  /** 是否为当前工程根包 */
  readonly isRoot?: boolean;
}

/**
 * 完整包依赖拓扑图 PackageGraph 契约。
 */
export interface PackageGraph {
  /** 当前工程根包身份（若存在） */
  readonly root?: PackageIdentity;
  /** 全局或当前工程全部包节点映射（按 packageId 索引） */
  readonly packages: Map<string, PackageNode>;

  /**
   * 按包标识获取指定节点。
   */
  getPackage(id: string): PackageNode | undefined;

  /**
   * 判定是否存在指定包节点。
   */
  hasPackage(id: string): boolean;
}

/**
 * 默认包依赖图实现。
 */
export class DefaultPackageGraph implements PackageGraph {
  readonly packages: Map<string, PackageNode>;
  readonly root?: PackageIdentity;

  constructor(
    packages: Map<string, PackageNode>,
    root?: PackageIdentity
  ) {
    this.packages = packages;
    this.root = root;
  }

  getPackage(id: string): PackageNode | undefined {
    return this.packages.get(id);
  }

  hasPackage(id: string): boolean {
    return this.packages.has(id);
  }
}

/**
 * 包图构建器配置选项。
 */
export interface PackageGraphBuilderOptions {
  /** 预先发现的包集合，若未提供则通过 PackageDiscovery 自动发现 */
  packages?: DiscoveredPackage[];
  /** 根工程根目录或根包标识 */
  root?: string;
  /** 包发现配置（构建器内部调用 PackageDiscovery 时生效） */
  discoveryOptions?: PackageDiscoveryOptions;
  /** 快照代次唯一标识（可选，默认生成 UUID） */
  generationId?: string;
}

/**
 * 包依赖拓扑图构建器 PackageGraphBuilder。
 * 输入发现的包集合，构建 directDependencies 与 transitiveDependencies 依赖拓扑图。
 */
export class PackageGraphBuilder {
  private readonly options: PackageGraphBuilderOptions;

  constructor(options: PackageGraphBuilderOptions = {}) {
    this.options = options;
  }

  /**
   * 同步构建包依赖拓扑图。
   */
  public buildSync(): PackageGraph {
    const discovered =
      this.options.packages ||
      new PackageDiscovery(this.options.discoveryOptions).discoverSync();
    const generation = this.options.generationId || randomUUID();

    const nodes = new Map<string, PackageNode>();

    for (const pkg of discovered) {
      const identity = createPackageIdentity({
        id: pkg.id,
        instanceId: `${pkg.id}:${pkg.root}`,
        generation,
      });

      nodes.set(pkg.id, {
        identity,
        root: pkg.root,
        manifest: pkg.manifest,
        directDependencies: new Set<string>(),
        transitiveDependencies: new Set<string>(),
        isRoot: Boolean(pkg.isCurrentProject),
      });
    }

    // 1. 构建直接依赖
    for (const node of nodes.values()) {
      if (node.manifest.dependencies && typeof node.manifest.dependencies === "object") {
        for (const depId of Object.keys(node.manifest.dependencies)) {
          if (nodes.has(depId)) {
            node.directDependencies.add(depId);
          }
        }
      }
    }

    // 2. 广度优先遍历计算传递依赖闭包
    for (const node of nodes.values()) {
      const queue = Array.from(node.directDependencies);
      const visited = new Set<string>(node.directDependencies);

      while (queue.length > 0) {
        const curr = queue.shift()!;
        node.transitiveDependencies.add(curr);
        const depNode = nodes.get(curr);
        if (depNode) {
          for (const next of depNode.directDependencies) {
            if (next !== node.identity.id && !visited.has(next)) {
              visited.add(next);
              queue.push(next);
            }
          }
        }
      }
    }

    // 3. 确定根节点身份
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
      }
    }

    return new DefaultPackageGraph(nodes, rootIdentity);
  }

  /**
   * 异步构建包依赖拓扑图。
   */
  public async build(): Promise<PackageGraph> {
    return this.buildSync();
  }
}
