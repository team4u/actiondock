import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { ActionContract, ActionRef } from "@actiondock/sdk";
import type { PackageIdentity } from "../runtime/identity";
import type { PackageGraph } from "./graph";
import { parseActionRef } from "./resolve-action";

/**
 * 动作目录候选条目规范。
 */
export interface ActionCandidate {
  /** 所属包唯一逻辑标识 */
  readonly packageId: string;
  /** 所属包唯一身份标识值对象 */
  readonly packageIdentity: PackageIdentity;
  /** 动作唯一标识符 */
  readonly actionId: string;
  /** 动作契约元数据定义 */
  readonly contract: ActionContract;
  /** 动作执行入口相对文件路径 */
  readonly entry: string;
  /** 所属包根目录绝对物理路径 */
  readonly packageRoot: string;
}

/**
 * 动作目录索引 ActionCatalog 契约。
 */
export interface ActionCatalog {
  /**
   * 按动作引用查找候选动作列表。
   * 若指定了 packageId，仅匹配对应包；若未指定 packageId，返回全部同名候选。
   */
  find(ref: ActionRef | string): ActionCandidate[];

  /**
   * 获取已索引候选动作集合（可选限定指定包）。
   */
  list(packageId?: string): ActionCandidate[];

  /**
   * 精确获取特定包内的特定动作候选。
   */
  get(packageId: string, actionId: string): ActionCandidate | undefined;
}

/**
 * 动作目录默认实现 DefaultActionCatalog。
 * 基于 PackageGraph 与包内 manifest/actions 构建 Action 索引。
 */
export class DefaultActionCatalog implements ActionCatalog {
  private readonly byPackageAndAction = new Map<string, ActionCandidate>();
  private readonly byActionId = new Map<string, ActionCandidate[]>();
  private readonly byPackageId = new Map<string, ActionCandidate[]>();
  private readonly graph: PackageGraph;
  private readonly actionsProvider?: (packageId: string) => Map<string, any> | undefined;

  constructor(
    graph: PackageGraph,
    actionsProvider?: (packageId: string) => Map<string, any> | undefined
  ) {
    this.graph = graph;
    this.actionsProvider = actionsProvider;
    this.indexGraph(graph, actionsProvider);
  }

  private checkDynamicAction(packageId: string, actionId: string): ActionCandidate | undefined {
    if (!this.actionsProvider) return undefined;
    const provided = this.actionsProvider(packageId);
    if (!provided) return undefined;
    const act = provided.get(actionId);
    if (!act) return undefined;
    const node = this.graph.packages.get(packageId);
    if (!node) return undefined;
    const candidate: ActionCandidate = {
      packageId,
      packageIdentity: node.identity,
      actionId,
      contract: {
        id: actionId,
        description: (act as any)?.description,
        inputSchema: (act as any)?.inputSchema,
        outputSchema: (act as any)?.outputSchema,
        uses: (act as any)?.uses,
        tags: (act as any)?.tags,
        annotations: (act as any)?.annotations,
      },
      entry: (act as any)?.entry || "",
      packageRoot: node.root || "",
    };
    this.addCandidate(candidate);
    return candidate;
  }

  private addCandidate(candidate: ActionCandidate): void {
    const qualifiedKey = `${candidate.packageId}/${candidate.actionId}`;
    this.byPackageAndAction.set(qualifiedKey, candidate);

    let forAction = this.byActionId.get(candidate.actionId);
    if (!forAction) {
      forAction = [];
      this.byActionId.set(candidate.actionId, forAction);
    }
    forAction.push(candidate);

    let forPackage = this.byPackageId.get(candidate.packageId);
    if (!forPackage) {
      forPackage = [];
      this.byPackageId.set(candidate.packageId, forPackage);
    }
    forPackage.push(candidate);
  }

  private indexGraph(
    graph: PackageGraph,
    actionsProvider?: (packageId: string) => Map<string, any> | undefined
  ): void {
    for (const node of graph.packages.values()) {
      const packageId = node.identity.id;
      const manifest = node.manifest;

      // 1. 清单显式 actions 声明优先索引
      if (manifest?.actions && typeof manifest.actions === "object") {
        for (const [actionId, item] of Object.entries(manifest.actions)) {
          const entry = (item as any)?.entry || join(manifest.actionsDir || "actions", `${actionId}.ts`);
          const candidate: ActionCandidate = {
            packageId,
            packageIdentity: node.identity,
            actionId,
            contract: {
              id: actionId,
              description: (item as any)?.description,
              inputSchema: (item as any)?.inputSchema,
              outputSchema: (item as any)?.outputSchema,
              uses: (item as any)?.uses,
              tags: (item as any)?.tags,
              annotations: (item as any)?.annotations,
            },
            entry,
            packageRoot: node.root,
          };
          this.addCandidate(candidate);
        }
      }

      // 2. 内存动态注入动作索引（测试或 Host 注册场景）
      if (actionsProvider) {
        const dynActions = actionsProvider(packageId);
        if (dynActions && typeof dynActions.entries === "function") {
          for (const [actionId, act] of dynActions.entries()) {
            const qualifiedKey = `${packageId}/${actionId}`;
            if (!this.byPackageAndAction.has(qualifiedKey)) {
              const contract = (act as any)?.contract || { id: actionId };
              const candidate: ActionCandidate = {
                packageId,
                packageIdentity: node.identity,
                actionId,
                contract,
                entry: "",
                packageRoot: node.root,
              };
              this.addCandidate(candidate);
            }
          }
        }
      }

      // 3. actions 目录回退扫描
      const actionsDir = join(node.root, manifest?.actionsDir || "actions");
      if (existsSync(actionsDir)) {
        try {
          const files = readdirSync(actionsDir);
          for (const file of files) {
            if (file.endsWith(".ts") || file.endsWith(".js")) {
              if (file.endsWith(".d.ts") || file.endsWith(".test.ts") || file.endsWith(".spec.ts")) {
                continue;
              }
              const actionId = file.replace(/\.(ts|js)$/, "");
              const qualifiedKey = `${packageId}/${actionId}`;
              if (!this.byPackageAndAction.has(qualifiedKey)) {
                const candidate: ActionCandidate = {
                  packageId,
                  packageIdentity: node.identity,
                  actionId,
                  contract: { id: actionId },
                  entry: join(manifest?.actionsDir || "actions", file),
                  packageRoot: node.root,
                };
                this.addCandidate(candidate);
              }
            }
          }
        } catch {
          // 忽略扫描目录异常
        }
      }
    }
  }

  public find(ref: ActionRef | string): ActionCandidate[] {
    const parsed = parseActionRef(ref);
    if (parsed.packageId) {
      const item = this.get(parsed.packageId, parsed.actionId);
      return item ? [item] : [];
    }
    if (this.actionsProvider) {
      for (const node of this.graph.packages.values()) {
        const key = `${node.identity.id}/${parsed.actionId}`;
        if (!this.byPackageAndAction.has(key)) {
          this.checkDynamicAction(node.identity.id, parsed.actionId);
        }
      }
    }
    return this.byActionId.get(parsed.actionId) || [];
  }

  public list(packageId?: string): ActionCandidate[] {
    if (packageId) {
      if (this.actionsProvider) {
        const provided = this.actionsProvider(packageId);
        if (provided) {
          for (const actionId of provided.keys()) {
            if (!this.byPackageAndAction.has(`${packageId}/${actionId}`)) {
              this.checkDynamicAction(packageId, actionId);
            }
          }
        }
      }
      return this.byPackageId.get(packageId) || [];
    }
    if (this.actionsProvider) {
      for (const node of this.graph.packages.values()) {
        const provided = this.actionsProvider(node.identity.id);
        if (provided) {
          for (const actionId of provided.keys()) {
            if (!this.byPackageAndAction.has(`${node.identity.id}/${actionId}`)) {
              this.checkDynamicAction(node.identity.id, actionId);
            }
          }
        }
      }
    }
    return Array.from(this.byPackageAndAction.values());
  }

  public get(packageId: string, actionId: string): ActionCandidate | undefined {
    return (
      this.byPackageAndAction.get(`${packageId}/${actionId}`) ||
      this.checkDynamicAction(packageId, actionId)
    );
  }
}
