import type { ActionDefinition, ActionRef } from "@actiondock/sdk";
import { ActionResolver } from "../catalog/action-resolver";
import { DefaultExecutionService } from "../execution/service";
import { loadActions, loadProjectConfig } from "../project/loader";
import type { ProjectConfig } from "../project/types";
import { resolvePackageRoot } from "../registry/registry";
import { ExecutionManager } from "./execution-manager";
import { createGlobalStorage, createStorage } from "../storage";
import type { RuntimeStorage } from "../storage/types";

/**
 * 服务端运行时注册表（ServerRuntimeRegistry - 兼容保留）。
 * @deprecated 待 MCP 包完成 ActionDockHost 改造后将彻底移除。
 */
export class ServerRuntimeRegistry {
  private customHome?: string;
  private storages = new Map<string, RuntimeStorage>();
  private globalStorage?: RuntimeStorage;
  private listeners = new Map<string, Set<(event: { type: string; data: any }) => void>>();
  private executionServices = new Map<string, DefaultExecutionService>();
  public executionManager: ExecutionManager;

  constructor(customHome?: string) {
    this.customHome = customHome;
    this.executionManager = new ExecutionManager();
  }

  public subscribe(runId: string, listener: (event: { type: string; data: any }) => void): () => void {
    let set = this.listeners.get(runId);
    if (!set) {
      set = new Set();
      this.listeners.set(runId, set);
    }
    set.add(listener);
    return () => {
      set?.delete(listener);
      if (set && set.size === 0) {
        this.listeners.delete(runId);
      }
    };
  }

  public emit(runId: string, event: { type: string; data: any }): void {
    const set = this.listeners.get(runId);
    if (set) {
      for (const listener of set) {
        try {
          listener(event);
        } catch {
          // 忽略单个监听器错误
        }
      }
    }
  }

  public getStorage(packageId: string, _projectRoot?: string): RuntimeStorage {
    const key = packageId;
    let storage = this.storages.get(key);
    if (!storage) {
      storage = createStorage(packageId, { customHome: this.customHome });
      this.storages.set(key, storage);
    }
    return storage;
  }

  public getExecutionService(
    packageId: string,
    projectRoot?: string,
    projectConfig?: ProjectConfig,
    options?: {
      storage?: RuntimeStorage;
      actions?: Map<string, ActionDefinition>;
      configOverrides?: Record<string, unknown>;
    }
  ): DefaultExecutionService {
    const key = `${projectRoot || ""}:${packageId}`;
    let service = this.executionServices.get(key);
    if (!service) {
      const storage = options?.storage ?? this.getStorage(packageId, projectRoot);
      const globalStorage = this.getGlobalStorage();
      service = new DefaultExecutionService({
        packageId,
        storage,
        globalStorage,
        projectRoot,
        projectConfig,
        configOverrides: options?.configOverrides,
        actions: options?.actions,
        actionResolver: (ref: ActionRef | string) => {
          const parsed = typeof ref === "string" ? ActionResolver.parseRef(ref) : ref;
          if (parsed.packageId && parsed.packageId !== packageId) {
            return undefined;
          }
          if (options?.actions?.has(parsed.actionId)) {
            return options.actions.get(parsed.actionId);
          }
          return undefined;
        },
        getStorageForPackage: (pkgId, root) => this.getStorage(pkgId, root),
        packageContextResolver: async (targetPkgId) => {
          const targetRoot = resolvePackageRoot(targetPkgId, undefined, this.customHome);
          if (targetRoot) {
            const targetConfig = loadProjectConfig(targetRoot);
            const targetStorage = this.getStorage(targetPkgId, targetRoot);
            const targetActions = await loadActions(targetRoot, targetConfig.actionsDir, { autoInstall: false });
            return {
              projectRoot: targetRoot,
              projectConfig: targetConfig,
              storage: targetStorage,
              actions: targetActions,
            };
          }
          return undefined;
        },
      });
      this.executionServices.set(key, service);
    }
    return service;
  }

  public getGlobalStorage(customHome?: string): RuntimeStorage {
    if (!this.globalStorage) {
      this.globalStorage = createGlobalStorage(customHome ?? this.customHome);
    }
    return this.globalStorage;
  }

  public getAllStorages(): RuntimeStorage[] {
    return Array.from(this.storages.values());
  }

  public findRun(runId: string) {
    for (const storage of this.storages.values()) {
      const run = storage.getRun(runId);
      if (run) {
        return { storage, run };
      }
    }
    return undefined;
  }

  public async close(options: { graceMs?: number } = {}): Promise<void> {
    const graceMs = options.graceMs ?? 5000;

    const serviceClosePromises = Array.from(this.executionServices.values()).map((svc) =>
      svc.close({ graceMs })
    );
    await Promise.all(serviceClosePromises);
    this.executionServices.clear();

    const activeHandles = this.executionManager.list();
    if (activeHandles.length > 0) {
      for (const handle of activeHandles) {
        handle.cancel("Server shutting down");
      }
      const waitTasks = Promise.all(activeHandles.map((h) => h.result.catch(() => {})));
      const timeout = new Promise((resolve) => setTimeout(resolve, graceMs));
      await Promise.race([waitTasks, timeout]);
    }
    this.executionManager.clear();

    for (const storage of this.storages.values()) {
      try {
        storage.close();
      } catch {
        // 忽略关机过程中的单个存储关闭异常
      }
    }
    this.storages.clear();

    if (this.globalStorage) {
      try {
        this.globalStorage.close();
      } catch {
        // 忽略关机过程中的全局存储关闭异常
      }
      this.globalStorage = undefined;
    }
  }
}
