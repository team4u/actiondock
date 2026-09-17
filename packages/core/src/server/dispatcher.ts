import { createRequire } from "node:module";

/**
 * 获取底层 HTTP 调度器（如 Undici Agent 或自定义 Dispatcher）的提供者函数契约。
 */
export type FetchDispatcherProvider = () => unknown;

let insecureDispatcherProvider: FetchDispatcherProvider | undefined;
let fallbackInsecureAgent: any;

/**
 * 注册全局用于忽略服务端证书校验的调度器提供者。
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
 * 1. 优先调用显式注册的提供者（如由 @actiondock/runtime-node 注册）；
 * 2. 检查全局符号注入的提供者；
 * 3. 若在 Node 环境下且前述未注入，安全动态加载兜底连接池，绝不让 core 包产生静态硬编译依赖。
 */
export function getInsecureDispatcher(): unknown {
  if (insecureDispatcherProvider) {
    return insecureDispatcherProvider();
  }

  const globalProvider = (globalThis as any)[Symbol.for("actiondock.insecureDispatcherProvider")];
  if (typeof globalProvider === "function") {
    return globalProvider();
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

    if (!fallbackInsecureAgent || fallbackInsecureAgent.closed || fallbackInsecureAgent.destroyed) {
      try {
        const req = createRequire(import.meta.url);
        const undici = req("undici");
        if (undici?.Agent) {
          fallbackInsecureAgent = new undici.Agent({
            connect: {
              rejectUnauthorized: false,
            },
            bodyTimeout: 0,
          });
        }
      } catch {
        // 忽略非 Node 环境或未安装 undici 的异常
      }
    }
    return fallbackInsecureAgent;
  }

  return undefined;
}

/**
 * 显式强制重置并销毁调度器连接池（仅用于单元测试重置或进程退出）。
 */
export async function closeInsecureDispatcher(): Promise<void> {
  const globalClose = (globalThis as any)[Symbol.for("actiondock.closeInsecureDispatcher")];
  if (typeof globalClose === "function") {
    try {
      await globalClose();
    } catch {
      // 忽略关闭异常
    }
  }

  if (fallbackInsecureAgent) {
    const agent = fallbackInsecureAgent;
    fallbackInsecureAgent = undefined;
    try {
      await agent.close();
    } catch {
      // 忽略关闭异常
    }
  }
}
