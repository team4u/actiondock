import { getActionDockHome } from "../utils";
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
 * 直接基于文件系统注册表文件（~/.actiondock/registry.json）读写。
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

  async save(data: GlobalRegistryData): Promise<void> {
    await saveRegistry(data, this.customHome);
  }

  listPackages(): LinkedPackageEntry[] {
    return listLinkedPackages(this.customHome);
  }

  listWorkspaces(): LinkedWorkspaceEntry[] {
    return listLinkedWorkspaces(this.customHome);
  }

  async link(path: string, options?: { recursive?: boolean }): Promise<LinkResult> {
    return linkPackage(path, this.customHome, options);
  }

  async unlink(idOrPath: string): Promise<UnlinkResult | null> {
    return unlinkPackage(idOrPath, this.customHome);
  }

  async prune(): Promise<PruneResult> {
    return pruneRegistry(this.customHome);
  }

  getStatus(): RegistryStatusReport {
    return getRegistryStatus(this.customHome);
  }
}
