import type { ActionDockTarget } from "../target/types";
import type { IpcCallMessage, IpcResponseMessage } from "./types";

/**
 * 在 Host 子进程中启动 Node IPC 服务，向父进程暴露 ActionDockTarget 门面能力。
 * 
 * @param target 已构造好的 ActionDockTarget 实例
 */
export async function serveParentIpc(target: ActionDockTarget): Promise<void> {
  if (!process.send) {
    // 若当前未以 IPC 模式运行，直接退出
    return;
  }

  let isClosing = false;
  const safeClose = async () => {
    if (isClosing) return;
    isClosing = true;
    try {
      await target.close();
    } catch {
      // 忽略关闭异常
    }
  };

  // 监听父进程断连或退出信号
  process.once("disconnect", async () => {
    await safeClose();
    process.exit(0);
  });

  process.once("SIGINT", async () => {
    await safeClose();
    process.exit(130);
  });

  process.once("SIGTERM", async () => {
    await safeClose();
    process.exit(143);
  });

  // 处理父进程 IPC 调用请求
  process.on("message", async (msg: any) => {
    if (!msg || typeof msg !== "object") return;

    if (msg.type === "call") {
      const callMsg = msg as IpcCallMessage;
      const { id, method, args } = callMsg;

      try {
        const fn = (target as any)[method];
        if (typeof fn !== "function") {
          throw new Error(`Target method '${method}' not found`);
        }

        const result = await fn.apply(target, args || []);
        const response: IpcResponseMessage = {
          id,
          type: "response",
          ok: true,
          data: result,
        };

        if (process.send) {
          process.send(response);
        }
      } catch (err: any) {
        const response: IpcResponseMessage = {
          id,
          type: "response",
          ok: false,
          error: {
            code: err?.code || "TARGET_ERROR",
            message: err?.message || String(err),
            stack: err?.stack,
            details: err?.details,
          },
        };

        if (process.send) {
          process.send(response);
        }
      }
    } else if (msg.type === "close") {
      await safeClose();
      if (process.send) {
        process.send({ id: msg.id, type: "response", ok: true });
      }
      process.exit(0);
    } else if (msg.type === "ping") {
      if (process.send) {
        process.send({ type: "pong" });
      }
    }
  });

  // 通知监督父进程：Host 已就绪
  if (process.send) {
    process.send({ type: "ready" });
  }
}
