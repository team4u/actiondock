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
}

/**
 * 全局 Registry 数据结构（~/.actiondock/registry.json）。
 */
export interface GlobalRegistryData {
  version: "2.0.0";
  packages: Record<string, LinkedPackageEntry>;
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
