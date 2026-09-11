/**
 * MCP 工具调用的异步执行模式探测与包装字段剥离。
 *
 * 单一显式约定：异步执行模式只认 input.execution.mode === "async"。
 * 旧版魔法字段（__async 布尔）保留只读兼容探测，但不再参与 schema 注入，
 * 也不再吞没业务自有的 async 入参字段：
 * - 探测阶段仅读取 execution.mode 与 __async，语义不变；
 * - 剥离阶段仅删除适配层实际注入的包装字段 execution 与 __async，
 *   名为 async 的业务字段原样透传给 Action。
 *
 * 保留命名空间权衡：`execution` 与 `__async` 是适配层声明的前缀保留字段；
 * 业务 Action 入参若恰好撞名 `__async: true`，会被误判为异步意图并在转发前剥离。
 * 这是旧版兼容通道的已知代价，新代码统一使用 execution.mode 声明异步，
 * 业务字段命名应避开该前缀保留命名空间。
 */

/** 适配层注入到工具 schema 的执行控制包装字段名集合。 */
const WRAPPER_KEYS = ["execution", "__async"] as const;

/**
 * 从工具调用入参中提取显式声明的异步执行模式。
 *
 * @param input 工具调用入参
 * @returns 是否显式声明了异步执行（execution.mode 为 async，或旧版 __async 为 true）
 */
export function isAsyncExecutionRequested(input: unknown): boolean {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return false;
  }
  const record = input as Record<string, unknown>;
  const execution = record.execution;
  if (
    typeof execution === "object" &&
    execution !== null &&
    !Array.isArray(execution) &&
    (execution as Record<string, unknown>).mode === "async"
  ) {
    return true;
  }
  // 旧版魔法字段兼容探测：仅只读，不再注入 schema 也不再参与剥离以外的影响
  if (record.__async === true) return true;
  return false;
}

/**
 * 剥离适配层注入的执行控制包装字段，返回纯净的业务入参。
 *
 * 仅删除 WRAPPER_KEYS 中声明的包装字段；业务自有字段（含名为 async 的入参）原样保留。
 *
 * @param input 工具调用入参
 */
export function stripExecutionWrapper<T>(input: T): T {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return input;
  }
  const record = input as Record<string, unknown>;
  const hasWrapper = WRAPPER_KEYS.some((key) => key in record);
  if (!hasWrapper) return input;
  const rest: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    if ((WRAPPER_KEYS as readonly string[]).includes(key)) continue;
    rest[key] = value;
  }
  return rest as T;
}
