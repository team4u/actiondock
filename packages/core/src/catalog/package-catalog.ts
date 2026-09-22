import { randomUUID } from "node:crypto";
import { findProjectRoot } from "../project/loader";
import { PackageDiscovery } from "./discovery";
import type { CatalogPackageEntry, CatalogSnapshot } from "./types";

/**
 * 兼容包目录快照构建器 PackageCatalog。
 * 内部已收敛至 PackageDiscovery 作为包发现的唯一事实源。
 */
export class PackageCatalog {
  private readonly customHome?: string;

  constructor(customHome?: string) {
    this.customHome = customHome;
  }

  public buildSnapshot(cwd: string = process.cwd()): CatalogSnapshot {
    const currentRoot = findProjectRoot(cwd) || undefined;
    const discovery = new PackageDiscovery({
      currentProjectRoot: currentRoot,
      customHome: this.customHome,
    });

    const discovered = discovery.discoverSync();
    const packages = new Map<string, CatalogPackageEntry>();

    for (const pkg of discovered) {
      packages.set(pkg.id, {
        id: pkg.id,
        packageInstanceId: `${pkg.id}:${pkg.root}`,
        projectRoot: pkg.root,
        config: pkg.manifest,
        isWorkspaceChild: pkg.isWorkspaceChild,
      });
    }

    return {
      generationId: randomUUID(),
      createdAt: new Date().toISOString(),
      packages,
    };
  }
}
