import type { ActionDockService } from "../service/types";
import { ActionDockError, CAPABILITY_UNAVAILABLE, SERVICE_ERROR } from "../errors";
import { hasIpcSignalMarker, IPC_SIGNAL_MARKER } from "./service";
import type { IpcAbortMessage, IpcCallMessage, IpcResponseMessage } from "./types";

/**
 * IPC 通道方法分发表：方法名到目标调用的唯一事实源。
 *
 * 严格对齐 ActionDockService 公共方法集合：表之外的方法一律拒绝，
 * 防止 IPC 消息通道触达任意内部属性或危险方法。
 * 白名单即分发表的键集合，杜绝两份清单重复维护漂移。
 */
const IPC_METHOD_HANDLERS: Readonly<
  Record<string, (service: ActionDockService, args: unknown[]) => Promise<unknown>>
> = {
  info: async (service) => service.info(),
  listPackages: async (service) => service.discovery.listPackages(),
  listActions: async (service, a) => service.discovery.listActions(a[0] as any),
  describeAction: async (service, a) => service.discovery.describeAction(a[0] as any),
  listPlaybooks: async (service, a) => service.discovery.listPlaybooks(a[0] as any),
  describePlaybook: async (service, a) => service.discovery.describePlaybook(a[0] as string),
  runAction: async (service, a) => service.execution.run(a[0] as any, a[1], a[2] as any),
  startAction: async (service, a) => service.execution.start(a[0] as any, a[1], a[2] as any),
  listRuns: async (service, a) => service.runs.list(a[0] as any),
  getRun: async (service, a) => service.runs.get(a[0] as string),
  cancelRun: async (service, a) => service.runs.cancel(a[0] as string, a[1] as string),
  clearRuns: async (service, a) =>
    service.runs.clear ? await service.runs.clear(a[0] as any) : 0,
  getConfig: async (service, a) =>
    service.management?.config.get(a[0] as string, a[1] as string),
  setConfig: async (service, a) =>
    service.management?.config.set(a[0] as string, a[1] as string, a[2] as any),
  deleteConfig: async (service, a) =>
    service.management?.config.delete(a[0] as string, a[1] as string),
  listConfig: async (service, a) => service.management?.config.list(a[0] as string),
  getState: async (service, a) =>
    service.management?.state.get(a[0] as string, a[1] as string, a[2] as string, a[3] as any),
  setState: async (service, a) =>
    service.management?.state.set(
      a[0] as string,
      a[1] as string,
      a[2] as string,
      a[3] as any,
      a[4] as any
    ),
  deleteState: async (service, a) =>
    service.management?.state.delete(a[0] as string, a[1] as string, a[2] as string, a[3] as any),
  listStateKeys: async (service, a) =>
    service.management?.state.list(a[0] as string, a[1] as string, a[2] as any),
  clearState: async (service, a) =>
    service.management?.state.clear(a[0] as string, a[1] as string, a[2] as any),
  listStateEntries: async (service, a) =>
    service.management?.state.listEntries
      ? await service.management.state.listEntries(a[0] as string, a[1] as any)
      : [],
};

/**
 * 在 Host 子进程中启动 Node IPC 服务，向父进程暴露 ActionDockService 门面能力。
 *
 * 跨进程取消链路：监督进程序列化执行选项时把 AbortSignal 替换为占位标记，
 * 本侧反序列化时识别标记并重建 AbortController 传入目标调用，同时维护
 * 调用 id 到控制器的映射；收到 abort 消息时触发对应控制器中止，
 * 调用完成后清理映射，确保取消信号全链路透传。
 *
 * @param service 已构造好的 ActionDockService 实例
 */
export async function serveParentIpc(service: ActionDockService): Promise<void> {
  if (!process.send) {
    // 若当前未以 IPC 模式运行，直接退出
    return;
  }

  let isClosing = false;
  const safeClose = async () => {
    if (isClosing) return;
    isClosing = true;
    try {
      await service.close();
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
        // 白名单校验：仅允许分发表内方法，阻止任意方法反射调用
        const handler =
          typeof method === "string" ? IPC_METHOD_HANDLERS[method] : undefined;
        if (!handler) {
          throw new ActionDockError(
            CAPABILITY_UNAVAILABLE,
            `Target method '${method}' is not allowed over IPC`
          );
        }

        // 反序列化执行选项：识别取消信号占位标记并重建控制器接入取消链路
        const a = (args || []).map((arg: unknown) => reviveIpcSignal(id, arg)) as any[];

        const result = await handler(service, a);

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
            code: err?.code || SERVICE_ERROR,
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
      // 防御性忽略未知消息类型并记录诊断，不中断通道
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
