import { existsSync, realpathSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { findProjectRoot, loadProjectConfig } from "../project/loader";
import { discoverProjects } from "../registry/registry";
import { LocationRegistry } from "./location-registry";
import type { CatalogPackageEntry, CatalogSnapshot } from "./types";

export class PackageCatalog {
  private registry: LocationRegistry;

  constructor(registry?: LocationRegistry) {
    this.registry = registry || new LocationRegistry();
  }

  public buildSnapshot(cwd: string = process.cwd()): CatalogSnapshot {
    const packages = new Map<string, CatalogPackageEntry>();
    const seenRealPaths = new Map<string, string>(); // realPath -> packageId
    const seenPackageIds = new Map<string, string>(); // packageId -> realPath

    const registerPackage = (root: string, isChild: boolean = false) => {
      const abs = resolve(root);
      if (!existsSync(abs)) return;
      const real = realpathSync(abs);

      if (seenRealPaths.has(real)) {
        return; // 符号链接归一化去重
      }

      try {
        const config = loadProjectConfig(abs);
        if (seenPackageIds.has(config.id)) {
          const existingPath = seenPackageIds.get(config.id);
          if (existingPath !== real) {
            throw new Error(
              `PACKAGE_ID_CONFLICT: Package ID '${config.id}' is declared by multiple directories: '${existingPath}' and '${real}'`
            );
          }
        }

        const entry: CatalogPackageEntry = {
          id: config.id,
          packageInstanceId: `${config.id}:${real}`,
          projectRoot: abs,
          config,
          isWorkspaceChild: isChild,
        };

        packages.set(config.id, entry);
        seenRealPaths.set(real, config.id);
        seenPackageIds.set(config.id, real);
      } catch (e: any) {
        if (e.message?.startsWith("PACKAGE_ID_CONFLICT")) {
          throw e;
        }
        // 忽略无效项目
      }
    };

    // 优先包含当前工作目录所在项目
    const currentRoot = findProjectRoot(cwd);
    if (currentRoot) {
      registerPackage(currentRoot);
    }

    // 扫描注册表中的位置
    const regData = this.registry.load();
    for (const link of regData.links) {
      if (!existsSync(link.path)) continue;

      if (link.type === "package") {
        registerPackage(link.path);
      } else if (link.type === "workspace") {
        const subprojects = discoverProjects(link.path, link.depth ?? 3);
        for (const sub of subprojects) {
          registerPackage(sub, true);
        }
      }
    }

    return {
      generationId: randomUUID(),
      createdAt: new Date().toISOString(),
      packages,
    };
  }
}
