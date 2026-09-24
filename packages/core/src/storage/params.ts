/**
 * SQLite 绑定参数规范化共享纯函数。
 *
 * 单一事实源：各同步驱动（如 NodeSqliteDriver）统一使用本实现，
 * 避免参数归一逻辑出现双实现漂移。
 */
export function normalizeSqliteParams(args: any[]): any[] {
  if (!args || args.length === 0) {
    return [];
  }
  if (args.length === 1 && Array.isArray(args[0])) {
    return args[0].map((v) => (v === undefined ? null : v));
  }
  if (
    args.length === 1 &&
    typeof args[0] === "object" &&
    args[0] !== null &&
    !Buffer.isBuffer(args[0]) &&
    !(args[0] instanceof Uint8Array)
  ) {
    const cleaned: Record<string, any> = {};
    for (const entry of Object.entries(args[0])) {
      cleaned[entry[0]] = entry[1] === undefined ? null : entry[1];
    }
    return [cleaned];
  }
  return args.map((v) => (v === undefined ? null : v));
}
