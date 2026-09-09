import type { ActionDefinition, ActionRef } from "@actiondock/sdk";
import { ActionResolver } from "../catalog/action-resolver";
import { DefaultExecutionService } from "../execution/service";
import { loadActions, loadProjectConfig } from "../project/loader";
import type { ProjectConfig } from "../project/types";
import { resolvePackageRoot } from "../registry/registry";
import { ExecutionManager } from "../runtime/execution-manager";
import { createGlobalStorage, createStorage } from "../storage";
import type { RuntimeStorage } from "../storage/types";

/**
 * 服务端运行时注册表（ServerRuntimeRegistry）。
 * 
 * 职责：
 * 1. 在长期运行的 HTTP 服务端（`ad serve` / `ad mcp serve`）中，跨请求缓存并池化管理 SQLite 数据库存储连接。
 * 2. 集中维护活跃的在途任务执行句柄（ExecutionManager）。
 * 3. 服务端停止或优雅关机（Graceful Shutdown）时，统一中断在途任务并安全关闭所有数据库连接。
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

  /**
   * 订阅指定 runId 的事件（用于 SSE 流式推送）。
   */
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

  /**
   * 向指定 runId 的订阅者广播事件。
   */
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

  /**
   * 获取或懒加载指定 Package 的缓存 RuntimeStorage 实例。
   * 
   * @param packageId 所属 Package ID
   * @param _projectRoot 项目根目录（保持签名兼容）
   * @returns 缓存或新创建的 RuntimeStorage 实例
   */
  public getStorage(packageId: string, _projectRoot?: string): RuntimeStorage {
    const key = packageId;
    let storage = this.storages.get(key);
    if (!storage) {
      storage = createStorage(packageId, { customHome: this.customHome });
      this.storages.set(key, storage);
    }
    return storage;
  }

  /**
   * 获取或懒加载统一 ExecutionService 实例。
   */
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

  /**
   * 获取或懒加载全局共享持久化存储实例（~/.actiondock/global.db）。
   * 实现全局数据库单例池化，避免重复创建连接泄漏。
   * 
   * @param customHome 自定义家目录路径（可选）
   */
  public getGlobalStorage(customHome?: string): RuntimeStorage {
    if (!this.globalStorage) {
      this.globalStorage = createGlobalStorage(customHome ?? this.customHome);
    }
    return this.globalStorage;
  }

  /**
   * 获取当前缓存的所有活跃 RuntimeStorage 实例列表。
   */
  public getAllStorages(): RuntimeStorage[] {
    return Array.from(this.storages.values());
  }

  /**
   * 跨所有已建立的存储连接全局查找指定 runId 的运行记录。
   * 
   * @param runId 目标运行 ID
   */
  public findRun(runId: string) {
    for (const storage of this.storages.values()) {
      const run = storage.getRun(runId);
      if (run) {
        return { storage, run };
      }
    }
    return undefined;
  }

  /**
   * 优雅关机：中断所有在途异步任务并安全关闭所有 SQLite 存储连接。
   */
  public async close(options: { graceMs?: number } = {}): Promise<void> {
    const graceMs = options.graceMs ?? 5000;

    // 1. 关闭并等待所有 ExecutionService 任务收尾
    const serviceClosePromises = Array.from(this.executionServices.values()).map((svc) =>
      svc.close({ graceMs })
    );
    await Promise.all(serviceClosePromises);
    this.executionServices.clear();

    // 2. 批量向所有在途任务发送取消信号并等待收尾
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

    // 3. 依次安全关闭所有 SQLite 数据库连接
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
