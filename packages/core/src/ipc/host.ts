import type { ActionDockService } from "../service/types";
import { TARGET_CAPABILITY_UNAVAILABLE } from "../service/types";
import { hasIpcSignalMarker, IPC_SIGNAL_MARKER } from "./service";
import type { IpcAbortMessage, IpcCallMessage, IpcResponseMessage } from "./types";

/**
 * IPC 通道允许反射调用的目标方法白名单。
 *
 * 严格对齐 ActionDockService 公共方法集合：白名单之外的方法一律拒绝，
 * 防止 IPC 消息通道触达任意内部属性或危险方法。
 */
const IPC_ALLOWED_METHODS: ReadonlySet<string> = new Set([
  "info",
  "listPackages",
  "listActions",
  "describeAction",
  "listPlaybooks",
  "describePlaybook",
  "runAction",
  "startAction",
  "listRuns",
  "getRun",
  "cancelRun",
  "clearRuns",
  "events",
  "getConfig",
  "setConfig",
  "deleteConfig",
  "listConfig",
  "getState",
  "setState",
  "deleteState",
  "listStateKeys",
  "clearState",
  "listStateEntries",
]);

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
        // 白名单校验：仅允许白名单方法，阻止任意方法反射调用
        if (typeof method !== "string" || !IPC_ALLOWED_METHODS.has(method)) {
          const err = new Error(
            `Target method '${method}' is not allowed over IPC`
          );
          (err as any).code = TARGET_CAPABILITY_UNAVAILABLE;
          throw err;
        }

        // 反序列化执行选项：识别取消信号占位标记并重建控制器接入取消链路
        const a = (args || []).map((arg: unknown) => reviveIpcSignal(id, arg)) as any[];

        let result: unknown;
        switch (method) {
          case "info":
            result = await service.info();
            break;
          case "listPackages":
            result = await service.discovery.listPackages();
            break;
          case "listActions":
            result = await service.discovery.listActions(a[0]);
            break;
          case "describeAction":
            result = await service.discovery.describeAction(a[0]);
            break;
          case "listPlaybooks":
            result = await service.discovery.listPlaybooks(a[0]);
            break;
          case "describePlaybook":
            result = await service.discovery.describePlaybook(a[0]);
            break;
          case "runAction":
            result = await service.execution.run(a[0], a[1], a[2]);
            break;
          case "startAction":
            result = await service.execution.start(a[0], a[1], a[2]);
            break;
          case "listRuns":
            result = await service.runs.list(a[0]);
            break;
          case "getRun":
            result = await service.runs.get(a[0]);
            break;
          case "cancelRun":
            result = await service.runs.cancel(a[0], a[1]);
            break;
          case "clearRuns":
            result = service.runs.clear ? await service.runs.clear(a[0]) : 0;
            break;
          case "getConfig":
            result = await service.management?.config.get(a[0], a[1]);
            break;
          case "setConfig":
            result = await service.management?.config.set(a[0], a[1], a[2]);
            break;
          case "deleteConfig":
            result = await service.management?.config.delete(a[0], a[1]);
            break;
          case "listConfig":
            result = await service.management?.config.list(a[0]);
            break;
          case "getState":
            result = await service.management?.state.get(a[0], a[1], a[2], a[3]);
            break;
          case "setState":
            result = await service.management?.state.set(a[0], a[1], a[2], a[3], a[4]);
            break;
          case "deleteState":
            result = await service.management?.state.delete(a[0], a[1], a[2], a[3]);
            break;
          case "listStateKeys":
            result = await service.management?.state.list(a[0], a[1], a[2]);
            break;
          case "clearState":
            result = await service.management?.state.clear(a[0], a[1], a[2]);
            break;
          case "listStateEntries":
            result = service.management?.state.listEntries ? await service.management.state.listEntries(a[0], a[1]) : [];
            break;
          default:
            throw new Error(`Method '${method}' not implemented`);
        }

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
            code: err?.code || "SERVICE_ERROR",
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
