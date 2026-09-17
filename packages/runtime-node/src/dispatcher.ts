import { Agent } from "undici";
import { setInsecureDispatcherProvider } from "@actiondock/core";

let globalInsecureAgent: Agent | undefined;

/**
 * 获取用于忽略服务端证书校验的全局单例 Undici Agent 调度器。
 * 显式配置 bodyTimeout: 0 以防止 SSE 长连接与流式事件读取出现 UND_ERR_BODY_TIMEOUT 空闲超时断流。
 */
export function getInsecureDispatcher(): Agent {
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
 * 显式强制重置并销毁全局调度器连接池（仅用于单元测试重置或进程退出）。
 */
export async function closeInsecureDispatcher(): Promise<void> {
  if (globalInsecureAgent) {
    const agent = globalInsecureAgent;
    globalInsecureAgent = undefined;
    try {
      await agent.close();
    } catch {
      // 忽略关闭时的异常
    }
  }
}

// 自动向 core 注册平台调度器提供者及全局符号标记
setInsecureDispatcherProvider(getInsecureDispatcher);
(globalThis as any)[Symbol.for("actiondock.insecureDispatcherProvider")] = getInsecureDispatcher;
(globalThis as any)[Symbol.for("actiondock.closeInsecureDispatcher")] = closeInsecureDispatcher;
