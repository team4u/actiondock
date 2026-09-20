/**
 * 存储层 JSON 载荷统一安全解析工具。
 *
 * 单一事实源：所有从 SQLite 读出的 JSON 字段（config.value_json、
 * state.value_json、runs.input_json / output_json / error_json 等）
 * 禁止在各自调用点散落 try/catch 静默降级，统一经由本函数完成
 * 「解析 + 可观测告警 + 保守降级」的完整链路。
 */

/**
 * 解析存储层 JSON 字符串，失败时输出单行警告并保守返回原始字符串。
 *
 * 降级策略说明：各调用方的返回类型为业务泛型 T，无法以标记对象区分
 * 损坏数据，因此保持「返回原始字符串」的既有降级行为，但通过
 * console.warn 保证损坏事件可观测，不再无声吞没。警告仅携带
 * 上下文描述与解析失败原因，不输出完整原始值，避免敏感数据
 * 泄漏到日志。
 *
 * @param raw 存储层原始 JSON 字符串
 * @param context 存储路径上下文描述（包含数据库位置、包标识与键名）
 * @returns 解析成功返回解析后的值；入参为空返回 undefined；解析失败返回原始字符串
 */
export function safeParseStoredJson<T = unknown>(
  raw: string | null | undefined,
  context: string
): T | undefined {
  if (raw === null || raw === undefined) {
    return undefined;
  }
  try {
    return JSON.parse(raw) as T;
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    console.warn(`[actiondock] stored JSON corrupted at ${context}: ${reason}`);
    return raw as unknown as T;
  }
}
