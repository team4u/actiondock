import type { RuntimeStorage } from "../storage/types";

/**
 * 构造外部注入 storage 的非接管视图。
 *
 * 外部注入的 storage 生命周期由注入方管理，本视图仅委托读写而不接管关闭：
 * 所有成员函数与属性原样转发到原始实例并绑定原 this，仅 close 收敛为
 * 显式声明的无操作边界，确保 service.close() 级联关闭时不会误伤外部实例。
 *
 * 单一事实源：mcp 适配层与 testing 运行时共同引用，严禁再各自复制 Proxy 包装实现。
 *
 * @param storage 外部注入的存储实例
 */
export function createNonClosingStorageView<T extends RuntimeStorage>(storage: T): T {
  return new Proxy(storage, {
    get(target, prop) {
      if (prop === "close") {
        return () => undefined;
      }
      const value = Reflect.get(target, prop, target);
      return typeof value === "function" ? (value as (...args: unknown[]) => unknown).bind(target) : value;
    },
  });
}
