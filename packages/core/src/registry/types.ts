/**
 * 本地软链接（Link）注册的 Package 实体记录。
 */
export interface LinkedPackageEntry {
  /** Package 唯一 ID */
  id: string;
  /** 展示名称 */
  name: string;
  /** 版本号 */
  version: string;
  /** 源码物理目录绝对路径 */
  path: string;
  /** 建立软链接的时间戳（ISO 8601） */
  linkedAt: string;
  /** 所属 Workspace 根目录（如果是通过 Workspace 自动关联的） */
  workspaceRoot?: string;
}

/**
 * 本地软链接（Link）注册的 Workspace 工作区目录记录。
 */
export interface LinkedWorkspaceEntry {
  /** 工作区物理目录绝对路径 */
  path: string;
  /** 建立软链接的时间戳（ISO 8601） */
  linkedAt: string;
}

/**
 * 全局 Registry 数据结构（~/.actiondock/registry.json）。
 */
export interface GlobalRegistryData {
  version: "2.0.0";
  packages: Record<string, LinkedPackageEntry>;
  workspaces?: Record<string, LinkedWorkspaceEntry>;
}

/**
 * Link 操作返回结果。
 */
export interface LinkResult {
  id: string;
  name: string;
  version: string;
  path: string;
  linkedAt: string;
  isWorkspace?: boolean;
  entries: LinkedPackageEntry[];
  workspace?: LinkedWorkspaceEntry;
}

/**
 * Unlink 操作返回结果。
 */
export interface UnlinkResult {
  type: "package" | "workspace";
  id: string;
  path: string;
  packagesCount?: number;
  removedPackage?: LinkedPackageEntry;
  removedWorkspace?: LinkedWorkspaceEntry;
}

/**
 * Action 归属项目解析结果。
 */
export interface ResolvedActionProject {
  /** 所在项目的根目录绝对路径 */
  projectRoot: string;
  /** 所属 Package ID */
  packageId: string;
  /** 匹配到的 Action ID */
  actionId: string;
}

/**
 * Playbook 归属项目解析结果。
 */
export interface ResolvedPlaybookProject {
  /** 所在项目的根目录绝对路径 */
  projectRoot: string;
  /** 所属 Package ID */
  packageId: string;
  /** 匹配到的 Playbook ID */
  playbookId: string;
  /** Playbook 实体数据 */
  playbook: import("../project/types").PlaybookDefinition;
}

