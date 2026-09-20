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
    } catch (err) {
      // 关闭异常不静默吞没：诊断输出保留排障线索，退出流程继续收敛
      console.warn("[actiondock] closeInsecureDispatcher failed to close agent:", err);
    }
  }
}

/**
 * 显式安装平台调度器：向 core 注册本模块的提供者函数。
 *
 * 模块导入本身不再携带任何全局注册副作用（不再直挂 globalThis 符号通道），
 * 由宿主入口显式调用完成注册；可安全重复调用，重复调用幂等覆盖注册。
 */
export function installInsecureDispatcher(): void {
  setInsecureDispatcherProvider(getInsecureDispatcher);
}
