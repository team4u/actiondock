import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { getActionDockHome } from "../utils";
import type { LocationLink, LocationRegistryData } from "./types";

export class LocationRegistry {
  private filePath: string;

  constructor(customHome?: string) {
    const baseDir = getActionDockHome(customHome);
    this.filePath = join(baseDir, ".actiondock", "registry.json");
  }

  public getFilePath(): string {
    return this.filePath;
  }

  public load(): LocationRegistryData {
    if (!existsSync(this.filePath)) {
      return { schemaVersion: 1, links: [] };
    }
    try {
      const raw = readFileSync(this.filePath, "utf-8");
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object") {
        return { schemaVersion: 1, links: [] };
      }

      // 处理 2.0 旧格式向 1 迁移
      if (parsed.schemaVersion === 1 && Array.isArray(parsed.links)) {
        return parsed as LocationRegistryData;
      }

      const links: LocationLink[] = [];
      if (parsed.workspaces && typeof parsed.workspaces === "object") {
        for (const [wsPath, ws] of Object.entries(parsed.workspaces as Record<string, any>)) {
          links.push({
            type: "workspace",
            path: resolve(wsPath),
            linkedAt: ws.linkedAt || new Date().toISOString(),
            depth: 3,
          });
        }
      }

      if (parsed.packages && typeof parsed.packages === "object") {
        for (const [_, pkg] of Object.entries(parsed.packages as Record<string, any>)) {
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
    } catch {
      return { schemaVersion: 1, links: [] };
    }
  }

  public save(data: LocationRegistryData): void {
    const dir = dirname(this.filePath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    const tempPath = `${this.filePath}.${process.pid}.${Date.now()}.tmp`;
    writeFileSync(tempPath, JSON.stringify(data, null, 2) + "\n", "utf-8");
    renameSync(tempPath, this.filePath);
  }

  public addLink(path: string, options: { type?: "package" | "workspace"; depth?: number } = {}): LocationLink {
    const absPath = resolve(path);
    const registry = this.load();
    const type = options.type || "package";
    const depth = options.depth ?? (type === "workspace" ? 3 : undefined);

    const existingIndex = registry.links.findIndex((l) => l.path === absPath);
    const link: LocationLink = {
      type,
      path: absPath,
      linkedAt: new Date().toISOString(),
      depth,
    };

    if (existingIndex >= 0) {
      registry.links[existingIndex] = link;
    } else {
      registry.links.push(link);
    }

    this.save(registry);
    return link;
  }

  public removeLink(targetPathOrId: string): LocationLink | null {
    const registry = this.load();
    const absPath = resolve(targetPathOrId);

    const idx = registry.links.findIndex(
      (l) => l.path === absPath || l.path.endsWith(`/${targetPathOrId}`)
    );

    if (idx >= 0) {
      const [removed] = registry.links.splice(idx, 1);
      this.save(registry);
      return removed;
    }
    return null;
  }

  public prune(): LocationLink[] {
    const registry = this.load();
    const valid: LocationLink[] = [];
    const removed: LocationLink[] = [];

    for (const link of registry.links) {
      if (existsSync(link.path)) {
        valid.push(link);
      } else {
        removed.push(link);
      }
    }

    if (removed.length > 0) {
      registry.links = valid;
      this.save(registry);
    }

    return removed;
  }
}
