import type { ActionDockTarget } from "../target/types";
import { hasIpcSignalMarker, IPC_SIGNAL_MARKER } from "./target";
import type { IpcAbortMessage, IpcCallMessage, IpcResponseMessage } from "./types";

/**
 * 在 Host 子进程中启动 Node IPC 服务，向父进程暴露 ActionDockTarget 门面能力。
 *
 * 跨进程取消链路：监督进程序列化执行选项时把 AbortSignal 替换为占位标记，
 * 本侧反序列化时识别标记并重建 AbortController 传入目标调用，同时维护
 * 调用 id 到控制器的映射；收到 abort 消息时触发对应控制器中止，
 * 调用完成后清理映射，确保取消信号全链路透传。
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

  // 进行中调用的取消控制器映射：id -> AbortController
  const activeControllers = new Map<string, AbortController>();

  /**
   * 反序列化执行选项：识别取消信号占位标记后重建 AbortController。
   *
   * @param id 当前调用唯一标识
   * @param arg 待反序列化的参数值
   * @returns 替换后的参数值（原样返回非标记对象）
   */
  const reviveIpcSignal = (id: string, arg: unknown): unknown => {
    if (!hasIpcSignalMarker(arg)) {
      return arg;
    }
    const { [IPC_SIGNAL_MARKER]: _marker, ...rest } = arg as Record<string, unknown>;
    const controller = new AbortController();
    activeControllers.set(id, controller);
    return { ...rest, signal: controller.signal };
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

        // 反序列化执行选项：识别取消信号占位标记并重建控制器接入取消链路
        const revivedArgs = (args || []).map((arg: unknown) => reviveIpcSignal(id, arg));

        const result = await fn.apply(target, revivedArgs);
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
      } finally {
        // 调用结束（无论成败）清理取消控制器映射，杜绝映射泄漏
        activeControllers.delete(id);
      }
    } else if (msg.type === "abort") {
      // 跨进程取消：触发对应调用控制器中止；未知 id 防御性忽略（旧版或已完成的调用）
      const abortMsg = msg as IpcAbortMessage;
      const controller = activeControllers.get(abortMsg.id);
      if (controller) {
        controller.abort(new Error(abortMsg.reason || "Execution was aborted via IPC"));
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
    } else {
      // 向后兼容：旧版本对端可能推送未知消息类型，防御性忽略并记录诊断，不中断通道
      process.stderr.write(
        `[IPC Host] Ignoring unknown IPC message type: ${JSON.stringify((msg as any).type)}\n`
      );
    }
  });

  // 通知监督父进程：Host 已就绪
  if (process.send) {
    process.send({ type: "ready" });
  }
}
