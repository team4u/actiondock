/**
 * MCP 工具执行选项与调用上下文中的超时控制解析。
 */

/**
 * 解析有效的执行超时毫秒数。
 *
 * 优先从调用上下文中读取，缺省时回退到选项中的全局配置。
 *
 * @param options MCP 初始化配置选项
 * @param context 可选的调用上下文
 * @returns 超时毫秒数，未指定或非法时返回 undefined
 */
export function resolveExecutionTimeout(
  options?: { timeoutMs?: number },
  context?: { timeoutMs?: number }
): number | undefined {
  const timeoutMs = context?.timeoutMs ?? options?.timeoutMs;
  return typeof timeoutMs === "number" && Number.isFinite(timeoutMs) && timeoutMs > 0
    ? timeoutMs
    : undefined;
}

export const resolveExecutionTimeoutMs = resolveExecutionTimeout;
