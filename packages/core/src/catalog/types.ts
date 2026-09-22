import type { ActionContract } from "@actiondock/sdk";
import type { ProjectConfig } from "../project/types";

export * from "./discovery";
export * from "./graph";
export * from "./action-catalog";
export * from "./resolve-action";
export * from "./resolve-playbook";

/**
 * 解析后的包实例快照。
 */
export interface CatalogPackageEntry {
  /** 逻辑包标识 */
  id: string;
  /** 包物理实例唯一标识 */
  packageInstanceId: string;
  /** 项目根目录绝对路径 */
  projectRoot: string;
  /** 项目配置 */
  config: ProjectConfig;
  /** 是否来自工作区自动发现 */
  isWorkspaceChild?: boolean;
}

/**
 * 运行时目录与包快照。
 */
export interface CatalogSnapshot {
  /** 快照代次唯一标识 */
  generationId: string;
  /** 生成快照时间 */
  createdAt: string;
  /** 已发现的包集合（按 packageId 索引） */
  packages: Map<string, CatalogPackageEntry>;
}

/**
 * 索引中的 Action 描述符。
 */
export interface IndexedAction {
  /** 所属逻辑包 ID */
  packageId: string;
  /** 动作 ID */
  actionId: string;
  /** 契约元数据 */
  contract: ActionContract;
  /** 实现入口相对路径 */
  entry: string;
  /** 包根目录绝对路径 */
  projectRoot: string;
}

export type { ModuleLoader } from "../runtime/module-loader";
