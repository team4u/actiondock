import {
  getRegistryFilePath,
  getRegistryStatus,
  linkPackage,
  listLinkedPackages,
  listLinkedWorkspaces,
  loadRegistry,
  loadRegistryAsync,
  pruneRegistry,
  saveRegistry,
  unlinkPackage,
} from "./registry";
import type {
  GlobalRegistryData,
  LinkedPackageEntry,
  LinkedWorkspaceEntry,
  LinkResult,
  PruneResult,
  RegistryStatusReport,
  UnlinkResult,
} from "./types";

/**
 * 用户显式注册位置存储契约。
 * 职责严格限制为存储与读取用户显式 link/unlink 的物理位置（packages 与 workspaces）。
 */
export interface RegistryStore {
  readonly customHome?: string;
  getFilePath(): string;
  load(): GlobalRegistryData;
  loadAsync(): Promise<GlobalRegistryData>;
  save(data: GlobalRegistryData): Promise<void>;
  listPackages(): LinkedPackageEntry[];
  listWorkspaces(): LinkedWorkspaceEntry[];
  link(path: string, options?: { recursive?: boolean }): Promise<LinkResult>;
  unlink(idOrPath: string): Promise<UnlinkResult | null>;
  prune(): Promise<PruneResult>;
  getStatus(): RegistryStatusReport;
}

/**
 * 默认注册表物理位置存储实现。
 * 直接基于文件系统注册表文件（~/.actiondock/registry.json）读写；
 * 全部方法均为向 registry.ts 自由函数透传 customHome 的零逻辑转发，
 * 收敛为单行委托以消除重复样板。
 */
export class DefaultRegistryStore implements RegistryStore {
  readonly customHome?: string;

  constructor(customHome?: string) {
    this.customHome = customHome;
  }

  getFilePath(): string {
    return getRegistryFilePath(this.customHome);
  }
  load(): GlobalRegistryData {
    return loadRegistry(this.customHome);
  }
  loadAsync(): Promise<GlobalRegistryData> {
    return loadRegistryAsync(this.customHome);
  }
  save(data: GlobalRegistryData): Promise<void> {
    return saveRegistry(data, this.customHome);
  }
  listPackages(): LinkedPackageEntry[] {
    return listLinkedPackages(this.customHome);
  }
  listWorkspaces(): LinkedWorkspaceEntry[] {
    return listLinkedWorkspaces(this.customHome);
  }
  link(path: string, options?: { recursive?: boolean }): Promise<LinkResult> {
    return linkPackage(path, this.customHome, options);
  }
  unlink(idOrPath: string): Promise<UnlinkResult | null> {
    return unlinkPackage(idOrPath, this.customHome);
  }
  prune(): Promise<PruneResult> {
    return pruneRegistry(this.customHome);
  }
  getStatus(): RegistryStatusReport {
    return getRegistryStatus(this.customHome);
  }
}
