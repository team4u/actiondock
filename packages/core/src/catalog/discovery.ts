import { existsSync, realpathSync } from "node:fs";
import { resolve } from "node:path";
import { loadProjectConfig } from "../project/loader";
import { loadManifest } from "../project/manifest";
import type { ActionDockManifest } from "../project/types";
import { DefaultRegistryStore, type RegistryStore } from "../registry/store";
import { discoverProjectConfigs } from "../registry/scan";

/**
 * 发现的包基本信息规范。
 */
export interface DiscoveredPackage {
  /** 逻辑包唯一标识符 */
  readonly id: string;
  /** 包物理根目录绝对路径 */
  readonly root: string;
  /** 包清单定义 */
  readonly manifest: ActionDockManifest;
  /** 是否来自工作区目录扫描发现 */
  readonly isWorkspaceChild?: boolean;
  /** 是否为当前工作目录工程 */
  readonly isCurrentProject?: boolean;
  /** 是否来自显式链接的外部包 */
  readonly isLinked?: boolean;
}

/**
 * 包发现配置选项。
 */
export interface PackageDiscoveryOptions {
  /** 当前项目根路径（可选） */
  currentProjectRoot?: string;
  /** 自定义 ActionDock 主目录路径（用于定位注册表） */
  customHome?: string;
  /** 显式注入的注册表存储实例（可选，默认使用 DefaultRegistryStore） */
  registryStore?: RegistryStore;
  /** 附加显式包根目录集合 */
  packageRoots?: string[];
  /** 附加显式工作区根目录集合 */
  workspaceRoots?: string[];
  /** 工作区目录扫描最大深度（默认 3） */
  workspaceScanDepth?: number;
  /** 是否扫描已注册链接包（默认为 true） */
  scanLinkedPackages?: boolean;
}

/**
 * 包发现单一事实源 PackageDiscovery。
 * 负责聚合当前工程、用户显式注册包位置与工作区根目录，输出已发现包集合。
 * 纯粹负责发现物理位置并去重冲突检测，严禁进行依赖鉴权或动作调用拦截。
 */
export class PackageDiscovery {
  private readonly options: PackageDiscoveryOptions;

  constructor(options: PackageDiscoveryOptions = {}) {
    this.options = options;
  }

  /**
   * 同步发现所有可用包基本信息集合。
   */
  public discoverSync(): DiscoveredPackage[] {
    const packages = new Map<string, DiscoveredPackage>();
    const registryStore =
      this.options.registryStore || new DefaultRegistryStore(this.options.customHome);
    const scanLinked = this.options.scanLinkedPackages !== false;

    const registerPackage = (
      pathOrRoot: string,
      flags: { isCurrentProject?: boolean; isWorkspaceChild?: boolean; isLinked?: boolean }
    ) => {
      const abs = resolve(pathOrRoot);
      if (!existsSync(abs)) return;
      const real = realpathSync(abs);

      if (packages.has(real)) {
        const existing = packages.get(real)!;
        if (flags.isCurrentProject && !existing.isCurrentProject) {
          packages.set(real, { ...existing, isCurrentProject: true });
        }
        return;
      }

      let manifest: ActionDockManifest;
      try {
        manifest = loadManifest(abs) || loadProjectConfig(abs);
      } catch (err: any) {
        if (flags.isCurrentProject) {
          throw err;
        }
        console.warn(
          `[PackageDiscovery] Skipping invalid package at '${abs}': ${err?.message || String(err)}`
        );
        return;
      }

      for (const existing of packages.values()) {
        if (existing.id === manifest.id) {
          const existingReal = realpathSync(existing.root);
          if (existingReal !== real) {
            throw new Error(
              `PACKAGE_ID_CONFLICT: Package ID '${manifest.id}' is declared by multiple directories: '${existing.root}' and '${abs}'`
            );
          }
        }
      }

      packages.set(real, {
        id: manifest.id,
        root: abs,
        manifest,
        ...flags,
      });
    };

    // 1. 当前工程根路径
    if (this.options.currentProjectRoot) {
      registerPackage(this.options.currentProjectRoot, { isCurrentProject: true });
    }

    // 2. 显式包路径
    if (this.options.packageRoots) {
      for (const p of this.options.packageRoots) {
        registerPackage(p, { isLinked: true });
      }
    }

    // 3. 注册表登记位置
    if (scanLinked) {
      try {
        const regData = registryStore.load();
        if (regData.packages) {
          for (const pkg of Object.values(regData.packages)) {
            if (pkg.path) {
              registerPackage(pkg.path, { isLinked: true });
            }
          }
        }
        if (regData.workspaces) {
          for (const wsPath of Object.keys(regData.workspaces)) {
            if (existsSync(wsPath)) {
              const configs = discoverProjectConfigs(
                wsPath,
                this.options.workspaceScanDepth ?? 3
              );
              for (const item of configs) {
                registerPackage(item.root, { isWorkspaceChild: true });
              }
            }
          }
        }
      } catch (err: any) {
        console.warn(
          `[PackageDiscovery] Failed to load registry locations: ${err?.message || String(err)}`
        );
      }
    }

    // 4. 显式附加工作区根目录
    if (this.options.workspaceRoots) {
      for (const wsPath of this.options.workspaceRoots) {
        if (existsSync(wsPath)) {
          const configs = discoverProjectConfigs(
            wsPath,
            this.options.workspaceScanDepth ?? 3
          );
          for (const item of configs) {
            registerPackage(item.root, { isWorkspaceChild: true });
          }
        }
      }
    }

    return Array.from(packages.values());
  }

  /**
   * 异步发现所有可用包基本信息集合。
   */
  public async discover(): Promise<DiscoveredPackage[]> {
    return this.discoverSync();
  }
}
