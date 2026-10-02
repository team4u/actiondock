import { Agent } from "undici";

/**
 * 全局单例 Undici Agent（忽略服务端证书校验）。
 * 显式配置 bodyTimeout: 0 以防止 SSE 长连接与流式事件读取出现 UND_ERR_BODY_TIMEOUT 空闲超时断流。
 * Agent 关闭或销毁后自动重建，保证长生命周期进程内的调度器始终可用。
 */
let globalInsecureAgent: Agent | undefined;

/**
 * 获取用于忽略服务端证书校验的全局单例 Undici Agent 调度器。
 */
export function getInsecureDispatcher(): unknown {
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
