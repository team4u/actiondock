import type { ActionContract, ActionDefinition, ActionRef, ResolvedActionRef } from "@actiondock/sdk";
import type { ProjectConfig } from "../project/types";

/**
 * 注册的位置条目类型。
 */
export type LocationType = "package" | "workspace";

/**
 * 位置注册表中的单条链接记录。
 */
export interface LocationLink {
  /** 位置类型：单包或工作区 */
  type: LocationType;
  /** 目录绝对物理路径 */
  path: string;
  /** 注册时间（ISO 8601） */
  linkedAt: string;
  /** 扫描最大深度（工作区模式有效，默认 3） */
  depth?: number;
}

/**
 * 物理位置注册表文件（~/.actiondock/registry.json）格式。
 */
export interface LocationRegistryData {
  schemaVersion: 1;
  links: LocationLink[];
}

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

/**
 * 模块加载器接口。
 */
export interface ModuleLoader {
  load<T>(file: string, options: {
    projectRoot: string;
    tsconfigPath?: string;
  }): Promise<T>;
}
