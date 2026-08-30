import type { ExecutionHandle } from "./runner";

/**
 * 内存中活跃执行句柄（In-flight Execution Handles）生命周期管理器。
 * 
 * 职责：
 * 1. 集中追踪正在执行的异步 Action 任务句柄。
 * 2. 任务完成（无论成功或失败）后通过 Promise.finally 自动注销，防止内存泄漏。
 * 3. 支持依据 runId 查询、遍历或主动发送取消信号（cancel）。
 */
export class ExecutionManager {
  private active = new Map<string, ExecutionHandle>();

  /**
   * 注册一个活跃的执行句柄。
   * 当底层 Promise 完成结算（resolve/reject）时，自动从活跃映射表中移除。
   * 
   * @param handle 执行句柄对象
   */
  public register(handle: ExecutionHandle): void {
    this.active.set(handle.runId, handle);
    handle.result.finally(() => {
      this.active.delete(handle.runId);
    });
  }

  /**
   * 根据 runId 检索正在执行的任务句柄。
   * 
   * @param runId 运行 ID
   * @returns 匹配的 ExecutionHandle 或 undefined
   */
  public get(runId: string): ExecutionHandle | undefined {
    return this.active.get(runId);
  }

  /**
   * 向指定 runId 的在途执行任务发送取消信号。
   * 
   * @param runId 目标运行 ID
   * @param reason 取消原因描述
   * @returns 若句柄存在且成功触发中断返回 true；若任务不存在或已完成返回 false
   */
  public cancel(runId: string, reason?: string): boolean {
    const handle = this.active.get(runId);
    if (!handle) {
      return false;
    }
    return handle.cancel(reason);
  }

  /**
   * 手动从活跃集合中移除执行句柄。
   * 
   * @param runId 运行 ID
   */
  public remove(runId: string): void {
    this.active.delete(runId);
  }

  /**
   * 获取当前系统中所有正在执行的活跃句柄列表。
   */
  public list(): ExecutionHandle[] {
    return Array.from(this.active.values());
  }

  /**
   * 清空所有活跃执行句柄。
   */
  public clear(): void {
    this.active.clear();
  }
}
