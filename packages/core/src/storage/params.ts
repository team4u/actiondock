/**
 * SQLite 绑定参数规范化共享纯函数。
 *
 * 单一事实源：主线程驱动（core 默认驱动与 runtime-node 的 NodeSqliteDriver）
 * 与 WorkerSqliteDriver 的 worker 内联脚本均使用本模块生成的同一份实现。
 *
 * 工程说明：worker 内联脚本以字符串形式 eval 执行、无法直接 import 模块，
 * 因此 worker 侧通过 Function.prototype.toString 将本函数源码序列化注入脚本。
 * 该函数必须保持完全自包含：仅依赖运行时全局 Buffer 与 Uint8Array，
 * 不得引用任何模块作用域内的其他标识符，也不得引入会被打包器改写的外部闭包，
 * 否则序列化注入后将在 worker 作用域内产生未定义引用。
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
