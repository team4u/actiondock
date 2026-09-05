import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { loadManifest } from "../project/manifest";
import type { CatalogSnapshot, IndexedAction } from "./types";

export class ActionIndex {
  private actions = new Map<string, IndexedAction[]>(); // actionId -> IndexedAction[]

  constructor(snapshot: CatalogSnapshot) {
    this.indexSnapshot(snapshot);
  }

  private indexSnapshot(snapshot: CatalogSnapshot): void {
    for (const [packageId, pkg] of snapshot.packages) {
      const manifest = loadManifest(pkg.projectRoot);
      if (manifest && manifest.actions) {
        for (const [actionId, item] of Object.entries(manifest.actions)) {
          const indexed: IndexedAction = {
            packageId,
            actionId,
            contract: {
              id: actionId,
              description: item.description,
              inputSchema: item.inputSchema,
              outputSchema: item.outputSchema,
              uses: item.uses,
              tags: item.tags,
              annotations: item.annotations as any,
            },
            entry: item.entry,
            projectRoot: pkg.projectRoot,
          };
          this.add(indexed);
        }
      } else {
        // 向后兼容回退：若未提供清单，扫描 actions 目录生成基础索引
        const actionsDir = join(pkg.projectRoot, pkg.config.actionsDir || "actions");
        if (existsSync(actionsDir)) {
          try {
            const files = readdirSync(actionsDir);
            for (const file of files) {
              if (file.endsWith(".ts") || file.endsWith(".js")) {
                const actionId = file.replace(/\.(ts|js)$/, "");
                const indexed: IndexedAction = {
                  packageId,
                  actionId,
                  contract: {
                    id: actionId,
                  },
                  entry: join(pkg.config.actionsDir || "actions", file),
                  projectRoot: pkg.projectRoot,
                };
                this.add(indexed);
              }
            }
          } catch {
            // 忽略读取目录异常
          }
        }
      }
    }
  }

  private add(action: IndexedAction): void {
    let list = this.actions.get(action.actionId);
    if (!list) {
      list = [];
      this.actions.set(action.actionId, list);
    }
    list.push(action);
  }

  public list(packageId?: string): IndexedAction[] {
    const all: IndexedAction[] = [];
    for (const [_, list] of this.actions) {
      for (const action of list) {
        if (!packageId || action.packageId === packageId) {
          all.push(action);
        }
      }
    }
    return all;
  }

  public find(actionId: string, packageId?: string): IndexedAction[] {
    const matches = this.actions.get(actionId) || [];
    if (packageId) {
      return matches.filter((a) => a.packageId === packageId);
    }
    return matches;
  }
}
