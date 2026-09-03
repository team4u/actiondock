import { ExecutionManager } from "../runtime/execution-manager";
import { createStorage } from "../storage";
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
  private storages = new Map<string, RuntimeStorage>();
  public executionManager: ExecutionManager;

  constructor() {
    this.executionManager = new ExecutionManager();
  }

  /**
   * 获取或懒加载指定 Package 和 projectRoot 的缓存 RuntimeStorage 实例。
   * 
   * @param packageId 所属 Package ID
   * @param projectRoot 项目根目录（可选）
   * @returns 缓存或新创建的 RuntimeStorage 实例
   */
  public getStorage(packageId: string, projectRoot?: string): RuntimeStorage {
    const key = `${projectRoot || ""}:${packageId}`;
    let storage = this.storages.get(key);
    if (!storage) {
      storage = createStorage(packageId, { projectRoot });
      this.storages.set(key, storage);
    }
    return storage;
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
  public close(): void {
    // 1. 批量向所有在途任务发送取消信号
    for (const handle of this.executionManager.list()) {
      handle.cancel("Server shutting down");
    }
    this.executionManager.clear();

    // 2. 依次安全关闭所有 SQLite 数据库连接
    for (const storage of this.storages.values()) {
      try {
        storage.close();
      } catch {
        // 忽略关机过程中的单个存储关闭异常
      }
    }
    this.storages.clear();
  }
}
