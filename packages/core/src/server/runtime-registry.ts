import { ExecutionManager } from "../runtime/execution-manager";
import { createStorage } from "../storage";
import type { RuntimeStorage } from "../storage/types";

/**
 * ServerRuntimeRegistry manages long-lived storage connections and in-memory execution handles
 * across multiple HTTP requests and background asynchronous tasks.
 */
export class ServerRuntimeRegistry {
  private storages = new Map<string, RuntimeStorage>();
  public executionManager: ExecutionManager;

  constructor() {
    this.executionManager = new ExecutionManager();
  }

  /**
   * Retrieves or creates a cached RuntimeStorage instance for a given package and projectRoot.
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
   * Returns all active storage instances.
   */
  public getAllStorages(): RuntimeStorage[] {
    return Array.from(this.storages.values());
  }

  /**
   * Finds a run across all known storages.
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
   * Closes all active executions and storage connections gracefully.
   */
  public close(): void {
    // Cancel active in-memory runs
    for (const handle of this.executionManager.list()) {
      handle.cancel("Server shutting down");
    }
    this.executionManager.clear();

    // Close all storage connections
    for (const storage of this.storages.values()) {
      try {
        storage.close();
      } catch {
        // ignore close errors during shutdown
      }
    }
    this.storages.clear();
  }
}
