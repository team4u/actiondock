/**
 * 检查目标进程是否处于存活状态（跨域通用谓词单一事实源）。
 *
 * 基于 process.kill(pid, 0) 探测：无异常视为存活；ESRCH（进程不存在）
 * 视为已死；其他异常（如 EPERM，权限不足但进程存在）保守视为存活，
 * 避免权限受限环境下误判他人持有进程死亡而抢占其锁。
 *
 * @param pid 待检测的进程标识符
 */
export function isProcessAlive(pid: number): boolean {
  if (typeof pid !== "number" || !Number.isInteger(pid) || pid <= 0) {
    return false;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch (err: any) {
    return err?.code !== "ESRCH";
  }
}
