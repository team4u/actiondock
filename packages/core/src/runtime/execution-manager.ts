import type { ExecutionHandle } from "./runner";

/**
 * In-memory manager for active / in-flight Action execution handles.
 */
export class ExecutionManager {
  private active = new Map<string, ExecutionHandle>();

  /**
   * Register an active execution handle. Automatically unregisters when the execution completes.
   */
  public register(handle: ExecutionHandle): void {
    this.active.set(handle.runId, handle);
    handle.result.finally(() => {
      this.active.delete(handle.runId);
    });
  }

  /**
   * Retrieve an active execution handle by runId.
   */
  public get(runId: string): ExecutionHandle | undefined {
    return this.active.get(runId);
  }

  /**
   * Cancel an active execution by runId.
   * Returns true if handle was found and cancelled, false otherwise.
   */
  public cancel(runId: string, reason?: string): boolean {
    const handle = this.active.get(runId);
    if (!handle) {
      return false;
    }
    return handle.cancel(reason);
  }

  /**
   * Remove an execution handle from the active set manually.
   */
  public remove(runId: string): void {
    this.active.delete(runId);
  }

  /**
   * List all currently active execution handles.
   */
  public list(): ExecutionHandle[] {
    return Array.from(this.active.values());
  }

  /**
   * Clear all active execution handles.
   */
  public clear(): void {
    this.active.clear();
  }
}
