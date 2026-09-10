import { existsSync } from "node:fs";
import { resolve } from "node:path";
import {
  getRegistryFilePath,
  linkPackage,
  loadRegistry,
  loadRegistryAsync,
  pruneRegistry,
  saveRegistry,
  unlinkPackage,
} from "../registry/registry";
import { withRegistryLock } from "../registry/lock";
import { writeRegistryLocked } from "../registry/registry";
import type { LinkedPackageEntry, LinkedWorkspaceEntry } from "../registry/types";
import { loadProjectConfig } from "../project/loader";
import { ACTIONDOCK_VERSION } from "../version";
import type { LocationLink, LocationRegistryData } from "./types";

export class LocationRegistry {
  private customHome?: string;
  private filePath: string;

  constructor(customHome?: string) {
    this.customHome = customHome;
    this.filePath = getRegistryFilePath(customHome);
  }

  public getFilePath(): string {
    return this.filePath;
  }

  public load(): LocationRegistryData {
    const reg = loadRegistry(this.customHome);
    const links: LocationLink[] = [];
    if (reg.workspaces) {
      for (const [wsPath, ws] of Object.entries(reg.workspaces)) {
        links.push({
          type: "workspace",
          path: resolve(ws.path || wsPath),
          linkedAt: ws.linkedAt || new Date().toISOString(),
          depth: 3,
        });
      }
    }
    if (reg.packages) {
      for (const pkg of Object.values(reg.packages)) {
        if (!pkg.workspaceRoot && pkg.path) {
          links.push({
            type: "package",
            path: resolve(pkg.path),
            linkedAt: pkg.linkedAt || new Date().toISOString(),
          });
        }
      }
    }
    return { schemaVersion: 1, links };
  }

  public async save(data: LocationRegistryData): Promise<void> {
    // 读改写整体收敛在注册表锁内完成，写入直接走锁内原子落盘，
    // 避免嵌套调用 saveRegistry 造成的同路径锁重入死等
    await withRegistryLock(this.filePath, async () => {
      const current = await loadRegistryAsync(this.customHome);
      const newPackages: Record<string, LinkedPackageEntry> = {};
      const newWorkspaces: Record<string, LinkedWorkspaceEntry> = {};

      for (const link of data.links) {
        const absPath = resolve(link.path);
        if (link.type === "workspace") {
          newWorkspaces[absPath] = {
            path: absPath,
            linkedAt: link.linkedAt || new Date().toISOString(),
          };
        } else {
          const existing = Object.values(current.packages || {}).find((p) => resolve(p.path) === absPath);
          if (existing) {
            newPackages[existing.id] = existing;
          } else if (existsSync(absPath)) {
            try {
              const config = loadProjectConfig(absPath);
              newPackages[config.id] = {
                id: config.id,
                name: config.name || config.id,
                version: config.version || "0.0.0",
                path: absPath,
                linkedAt: link.linkedAt || new Date().toISOString(),
              };
            } catch {
              // 项目损坏或配置非法：跳过该链接条目，避免保存整体失败
            }
          }
        }
      }

      await writeRegistryLocked(
        {
          version: ACTIONDOCK_VERSION,
          packages: newPackages,
          workspaces: newWorkspaces,
        },
        this.customHome
      );
    });
  }

  public async addLink(path: string, options: { type?: "package" | "workspace"; depth?: number } = {}): Promise<LocationLink> {
    const type = options.type || "package";
    if (type === "workspace") {
      const res = await linkPackage(path, this.customHome, { recursive: true });
      return {
        type: "workspace",
        path: resolve(path),
        linkedAt: res.linkedAt,
        depth: options.depth ?? 3,
      };
    } else {
      const res = await linkPackage(path, this.customHome, { recursive: false });
      return {
        type: "package",
        path: resolve(path),
        linkedAt: res.linkedAt,
      };
    }
  }

  public async removeLink(targetPathOrId: string): Promise<LocationLink | null> {
    const unres = await unlinkPackage(targetPathOrId, this.customHome);
    if (!unres || (!unres.removedPackage && !unres.packagesCount)) {
      return null;
    }
    return {
      type: unres.type,
      path: unres.path,
      linkedAt: new Date().toISOString(),
    };
  }

  public async prune(): Promise<LocationLink[]> {
    const pruneRes = await pruneRegistry(this.customHome);
    const removed: LocationLink[] = [];
    for (const pkg of pruneRes.prunedPackages) {
      removed.push({
        type: "package",
        path: pkg.path,
        linkedAt: pkg.linkedAt,
      });
    }
    for (const ws of pruneRes.prunedWorkspaces) {
      removed.push({
        type: "workspace",
        path: ws.path,
        linkedAt: ws.linkedAt,
      });
    }
    return removed;
  }
}
