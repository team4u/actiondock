import { Agent } from "undici";

/**
 * 获取底层 HTTP 调度器（如 Undici Agent 或自定义 Dispatcher）的提供者函数契约。
 */
export type FetchDispatcherProvider = () => unknown;

let insecureDispatcherProvider: FetchDispatcherProvider | undefined;
let globalInsecureAgent: Agent | undefined;

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
 * 获取用于忽略服务端证书校验的全局单例 Undici Agent 调度器。
 * 显式配置 bodyTimeout: 0 以防止 SSE 长连接与流式事件读取出现 UND_ERR_BODY_TIMEOUT 空闲超时断流。
 */
export function getInsecureDispatcher(): unknown {
  if (insecureDispatcherProvider) {
    return insecureDispatcherProvider();
  }

  if (!globalInsecureAgent || (globalInsecureAgent as any).closed || (globalInsecureAgent as any).destroyed) {
    globalInsecureAgent = new Agent({
      connect: {
        rejectUnauthorized: false,
      },
      bodyTimeout: 0,
    });
  }
  return globalInsecureAgent;
}

/**
 * 显式安装平台调度器：向 core 注册本模块的提供者函数。
 */
export function installInsecureDispatcher(): void {
  setInsecureDispatcherProvider(getInsecureDispatcher);
}

/**
 * 显式强制重置并销毁调度器连接池（仅用于单元测试重置或进程退出）。
 */
export async function closeInsecureDispatcher(): Promise<void> {
  if (globalInsecureAgent) {
    const agent = globalInsecureAgent;
    globalInsecureAgent = undefined;
    try {
      await agent.close();
    } catch (err) {
      console.warn("[actiondock] closeInsecureDispatcher failed to close agent:", err);
    }
  }
}
