import { createRequire } from "node:module";

/**
 * 获取底层 HTTP 调度器（如 Undici Agent 或自定义 Dispatcher）的提供者函数契约。
 */
export type FetchDispatcherProvider = () => unknown;

let insecureDispatcherProvider: FetchDispatcherProvider | undefined;

/**
 * 注册全局用于忽略服务端证书校验的调度器提供者。
 * 唯一注册通道：平台适配层（如 @actiondock/runtime-node 的
 * installInsecureDispatcher）显式调用完成注册，不再读取全局符号注入。
 */
export function setInsecureDispatcherProvider(provider?: FetchDispatcherProvider): void {
  insecureDispatcherProvider = provider;
}

/**
 * 获取当前已注册的调度器提供者函数。
 */
export function getInsecureDispatcherProvider(): FetchDispatcherProvider | undefined {
  return insecureDispatcherProvider;
}

/**
 * 获取用于忽略服务端证书校验的调度器实例。
 * 纯粹解耦设计：
 * 1. 优先调用显式注册的提供者（如由 @actiondock/runtime-node 显式安装）；
 * 2. 若在 Node 环境下且无注册提供者，动态加载 @actiondock/runtime-node
 *    （其入口聚合点会显式完成安装），绝不让 core 包产生静态硬编译依赖；
 * 3. 仍不可得时返回 undefined，由调用方回退默认 fetch，绝不在 core 内
 *    直接探测加载 undici，避免与平台适配层形成层次倒置与隐藏依赖环。
 */
export function getInsecureDispatcher(): unknown {
  if (insecureDispatcherProvider) {
    return insecureDispatcherProvider();
  }

  if (typeof process !== "undefined" && process.versions?.node) {
    try {
      const req = createRequire(import.meta.url);
      const runtimeNode = req("@actiondock/runtime-node");
      if (typeof runtimeNode?.getInsecureDispatcher === "function") {
        return runtimeNode.getInsecureDispatcher();
      }
    } catch {
      // 忽略未安装 @actiondock/runtime-node 的情况
    }
  }

  return undefined;
}

/**
 * 显式强制重置并销毁调度器连接池（仅用于单元测试重置或进程退出）。
 * core 自身不再持有任何兜底连接池，关闭语义完全委托已注册的平台提供者宿主。
 */
export async function closeInsecureDispatcher(): Promise<void> {
  if (insecureDispatcherProvider) {
    // 提供者由平台层注册：优先委托提供者宿主的关闭语义（如可用）
    try {
      const req = createRequire(import.meta.url);
      const runtimeNode = req("@actiondock/runtime-node");
      if (typeof runtimeNode?.closeInsecureDispatcher === "function") {
        await runtimeNode.closeInsecureDispatcher();
      }
    } catch {
      // 忽略未安装 @actiondock/runtime-node 的情况
    }
  }
}
