import { randomUUID } from "node:crypto";
import { fork, type ChildProcess } from "node:child_process";
import type {
  ActionRef,
  ExecutionEvent,
  ExecutionResult,
  JsonValue,
  RunRecord,
} from "@actiondock/sdk";
import type {
  ActionSpec,
  ActionSummary,
  ListActionsOptions,
  PackageInfo,
  PlaybookSpec,
  PlaybookSummary,
} from "../app/types";
import type {
  CancelResult,
  ExecuteOptions,
  ExecutionTicket,
} from "../execution/types";
import type {
  ActionDockTarget,
  ConfigValueView,
  IpcTargetOptions,
  StateScopeOptions,
  TargetInfo,
} from "../target/types";
import { DiagnosticForwarder } from "./diagnostic";
import { EXECUTION_ABORTED, HOST_PROCESS_EXITED } from "../errors";
import type { IpcAbortMessage, IpcCallMessage, IpcResponseMessage } from "./types";

/**
 * 跨进程取消信号占位标记字段名。
 * AbortSignal 不可序列化，序列化 options 时把 signal 字段替换为该标记，
 * 宿主侧识别后重建 AbortController 并接入 abort 消息通知链路。
 */
export const IPC_SIGNAL_MARKER = "__ipcSignal";

/**
 * 判断执行选项中是否携带跨进程取消信号占位标记。
 *
 * @param value 待检查的选项值
 */
export function hasIpcSignalMarker(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as Record<string, unknown>)[IPC_SIGNAL_MARKER] === true
  );
}

/**
 * 序列化执行选项：剥离不可序列化的 AbortSignal 并写入占位标记。
 * 未携带 signal 时返回浅拷贝，避免消息通道直接持有调用方原始对象。
 *
 * @param options 原始执行选项
 */
function markIpcSignal(options?: ExecuteOptions): Record<string, unknown> | undefined {
  if (!options) return undefined;
  const { signal: _signal, ...rest } = options;
  if (!_signal) return rest as Record<string, unknown>;
  return { ...rest, [IPC_SIGNAL_MARKER]: true } as Record<string, unknown>;
}

/**
 * 基于 Node IPC 监督进程通信通道的 ActionDockTarget 实现。
 * 
 * 职责：
 * 1. 监督并隔离子进程的生命周期与标准输出，保证父进程标准输入输出通道 100% 纯净。
 * 2. 将子进程标准输出/错误通过 DiagnosticForwarder 进行受控排空与诊断流限流转发。
 * 3. 当子进程异常终止时，立即将当前活跃调用转换为结构化 HOST_PROCESS_EXITED 错误，防止调用方死锁。
 */
export class IpcActionDockTarget implements ActionDockTarget {
  private child: ChildProcess;
  private forwarder: DiagnosticForwarder;
  private pendingCalls = new Map<
    string,
    {
      resolve: (val: any) => void;
      reject: (err: any) => void;
      method: string;
    }
  >();
  private isClosed = false;
  private exitError?: Error;
  private readyPromise: Promise<void>;

  constructor(options: IpcTargetOptions) {
    this.forwarder = new DiagnosticForwarder({
      maxBytes: options.maxDiagnosticBytes,
      maxRateBytesPerSec: options.maxDiagnosticRate,
      target: options.diagnosticTarget,
    });

    if (options.childProcess) {
      this.child = options.childProcess;
    } else if (options.scriptPath) {
      this.child = fork(options.scriptPath, options.scriptArgs || [], {
        cwd: options.cwd || process.cwd(),
        env: options.env || process.env,
        stdio: ["pipe", "pipe", "pipe", "ipc"],
      });
    } else {
      throw new Error("IpcActionDockTarget requires either 'childProcess' or 'scriptPath'");
    }

    // 绑定子进程输出至受控限流排空器，绝不泄露至 process.stdout
    if (this.child.stdout) {
      this.forwarder.attach(this.child.stdout, "stdout");
    }
    if (this.child.stderr) {
      this.forwarder.attach(this.child.stderr, "stderr");
    }

    let resolveReady: () => void;
    this.readyPromise = new Promise<void>((r) => {
      resolveReady = r;
    });

    this.child.on("message", (msg: any) => {
      if (!msg || typeof msg !== "object") return;

      if (msg.type === "ready") {
        resolveReady();
      } else if (msg.type === "response") {
        const resp = msg as IpcResponseMessage;
        const pending = this.pendingCalls.get(resp.id);
        if (pending) {
          this.pendingCalls.delete(resp.id);
          if (resp.ok) {
            pending.resolve(resp.data);
          } else {
            const err = new Error(resp.error?.message || "IPC Target call failed");
            if (resp.error?.code) (err as any).code = resp.error.code;
            if (resp.error?.details) (err as any).details = resp.error.details;
            pending.reject(err);
          }
        }
      }
    });

    this.child.on("exit", (code, signal) => {
      const exitMsg = `Host process exited prematurely with code ${code ?? signal ?? "unknown"}`;
      const err = new Error(exitMsg);
      (err as any).code = "HOST_PROCESS_EXITED";
      this.exitError = err;
      this.isClosed = true;

      // 快速失败所有待处理调用
      for (const pending of this.pendingCalls.values()) {
        if (pending.method === "runAction") {
          pending.resolve({
            ok: false,
            runId: randomUUID(),
            error: {
              code: HOST_PROCESS_EXITED,
              message: exitMsg,
            },
          });
        } else {
          pending.reject(err);
        }
      }
      this.pendingCalls.clear();
      resolveReady(); // 避免就绪死锁
    });

    this.child.on("error", (err) => {
      this.exitError = err;
    });
  }

  /**
   * 等待宿主子进程初始化就绪。
   */
  public async waitReady(timeoutMs = 5000): Promise<void> {
    if (this.exitError) throw this.exitError;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<void>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error(`Timeout waiting for host process ready after ${timeoutMs}ms`)),
        timeoutMs
      );
    });
    try {
      await Promise.race([this.readyPromise, timeout]);
    } finally {
      if (timer !== undefined) {
        clearTimeout(timer);
      }
    }
  }

  /**
   * 获取底层子进程实例。
   */
  public get process(): ChildProcess {
    return this.child;
  }

  private async callRemote<T>(
    method: string,
    args: unknown[],
    signal?: AbortSignal
  ): Promise<T> {
    if (this.isClosed || this.exitError) {
      if (method === "runAction") {
        return {
          ok: false,
          runId: randomUUID(),
          error: {
            code: HOST_PROCESS_EXITED,
            message: this.exitError?.message || "Host process is already closed",
          },
        } as unknown as T;
      }
      throw this.exitError || new Error("Host process is already closed");
    }

    const id = randomUUID();
    const msg: IpcCallMessage = {
      id,
      type: "call",
      method,
      args,
    };

    // 事件驱动跨进程取消：signal 存在且未中止时注册 abort 监听，
    // 触发即向宿主子进程发送 abort 消息，由宿主侧中止同调用控制器；
    // 调用结束（无论成败）后注销监听，避免监听器泄漏
    let onAbort: (() => void) | undefined;
    if (signal && !signal.aborted) {
      onAbort = () => {
        this.sendAbort(id);
      };
      signal.addEventListener("abort", onAbort, { once: true });
    }

    return new Promise<T>((resolve, reject) => {
      this.pendingCalls.set(id, { resolve, reject, method });
      try {
        if (this.child.send) {
          this.child.send(msg);
        } else {
          this.pendingCalls.delete(id);
          reject(new Error("IPC channel unavailable on child process"));
        }
      } catch (err) {
        this.pendingCalls.delete(id);
        reject(err);
      }
    }).finally(() => {
      if (onAbort && signal) {
        signal.removeEventListener("abort", onAbort);
      }
    });
  }

  /**
   * 向宿主子进程发送跨进程取消通知，发送异常不阻断父侧调用链路。
   *
   * @param id 目标调用的唯一标识
   */
  private sendAbort(id: string): void {
    if (this.isClosed) return;
    try {
      const abortMsg: IpcAbortMessage = { id, type: "abort" };
      if (this.child.send) {
        this.child.send(abortMsg);
      }
    } catch (err) {
      // 通道已断开时发送失败属预期场景：宿主退出路径会另行以结构化错误回包
      process.stderr.write(
        `[IPC Target] Failed to send abort for call '${id}': ${
          err instanceof Error ? err.message : String(err)
        }\n`
      );
    }
  }

  async info(): Promise<TargetInfo> {
    return this.callRemote<TargetInfo>("info", []);
  }

  async listPackages(): Promise<PackageInfo[]> {
    return this.callRemote<PackageInfo[]>("listPackages", []);
  }

  async listActions(options?: ListActionsOptions): Promise<ActionSummary[]> {
    return this.callRemote<ActionSummary[]>("listActions", [options]);
  }

  async describeAction(ref: ActionRef | string): Promise<ActionSpec> {
    return this.callRemote<ActionSpec>("describeAction", [ref]);
  }

  async listPlaybooks(options?: { intent?: string; package?: string }): Promise<PlaybookSummary[]> {
    return this.callRemote<PlaybookSummary[]>("listPlaybooks", [options]);
  }

  async describePlaybook(id: string): Promise<PlaybookSpec> {
    return this.callRemote<PlaybookSpec>("describePlaybook", [id]);
  }

  async runAction(
    ref: ActionRef | string,
    input: JsonValue,
    options?: ExecuteOptions
  ): Promise<ExecutionResult> {
    if (options?.signal?.aborted) {
      return {
        ok: false,
        runId: randomUUID(),
        error: {
          code: EXECUTION_ABORTED,
          message: "Execution was aborted before starting",
        },
      };
    }
    // AbortSignal 不可序列化：以占位标记替换后随消息通道传递，宿主侧重建控制器
    const serializableOptions = markIpcSignal(options);
    return this.callRemote<ExecutionResult>("runAction", [ref, input, serializableOptions], options?.signal);
  }

  async startAction(
    ref: ActionRef | string,
    input: JsonValue,
    options?: ExecuteOptions
  ): Promise<ExecutionTicket> {
    if (options?.signal?.aborted) {
      throw new Error("Execution was aborted before starting");
    }
    // AbortSignal 不可序列化：以占位标记替换后随消息通道传递，宿主侧重建控制器
    const serializableOptions = markIpcSignal(options);
    return this.callRemote<ExecutionTicket>("startAction", [ref, input, serializableOptions], options?.signal);
  }

  async getRun(runId: string): Promise<RunRecord | undefined> {
    const res = await this.callRemote<RunRecord | null | undefined>("getRun", [runId]);
    return res ?? undefined;
  }

  async cancelRun(runId: string): Promise<CancelResult> {
    return this.callRemote<CancelResult>("cancelRun", [runId]);
  }

  async listRuns(options?: any): Promise<RunRecord[]> {
    return this.callRemote<RunRecord[]>("listRuns", [options]);
  }

  async *events(_runId: string, _options?: any): AsyncIterable<ExecutionEvent> {
    // 基础 IPC 通道暂不流式下发历史事件
  }

  async listConfig(packageId: string): Promise<ConfigValueView[]> {
    return this.callRemote<ConfigValueView[]>("listConfig", [packageId]);
  }

  async getConfig(packageId: string, key: string): Promise<ConfigValueView> {
    return this.callRemote<ConfigValueView>("getConfig", [packageId, key]);
  }

  async setConfig(packageId: string, key: string, value: JsonValue): Promise<void> {
    return this.callRemote<void>("setConfig", [packageId, key, value]);
  }

  async deleteConfig(packageId: string, key: string): Promise<boolean> {
    return this.callRemote<boolean>("deleteConfig", [packageId, key]);
  }

  async getState<T extends JsonValue = JsonValue>(
    packageId: string,
    actionId: string,
    key: string,
    options?: StateScopeOptions
  ): Promise<T | undefined> {
    return this.callRemote<T | undefined>("getState", [
      packageId,
      actionId,
      key,
      options,
    ]);
  }

  async setState<T extends JsonValue = JsonValue>(
    packageId: string,
    actionId: string,
    key: string,
    value: T,
    options?: StateScopeOptions
  ): Promise<void> {
    return this.callRemote<void>("setState", [packageId, actionId, key, value, options]);
  }

  async deleteState(
    packageId: string,
    actionId: string,
    key: string,
    options?: StateScopeOptions
  ): Promise<boolean> {
    return this.callRemote<boolean>("deleteState", [packageId, actionId, key, options]);
  }

  async listStateKeys(
    packageId: string,
    actionId?: string,
    options?: StateScopeOptions
  ): Promise<string[]> {
    return this.callRemote<string[]>("listStateKeys", [packageId, actionId, options]);
  }

  async clearState(
    packageId: string,
    actionId: string,
    options?: StateScopeOptions
  ): Promise<number> {
    return this.callRemote<number>("clearState", [packageId, actionId, options]);
  }

  async close(): Promise<void> {
    if (this.isClosed) return;
    if (this.child.exitCode !== null) {
      this.forwarder.detachAll();
      return;
    }

    const exitPromise = new Promise<void>((resolve) => {
      if (this.child.exitCode !== null) {
        resolve();
      } else {
        this.child.once("exit", () => resolve());
      }
    });

    try {
      if (this.child.connected) {
        this.child.send({ type: "close" });
      }
    } catch {
      // 忽略发送关闭消息异常
    }

    // 若子进程超时未退出，先 SIGTERM 再 SIGKILL
    const termTimer = setTimeout(() => {
      if (this.child.exitCode === null) {
        try {
          this.child.kill("SIGTERM");
        } catch {}
      }
    }, 1500);

    const killTimer = setTimeout(() => {
      if (this.child.exitCode === null) {
        try {
          this.child.kill("SIGKILL");
        } catch {}
      }
    }, 3000);

    try {
      await exitPromise;
    } finally {
      clearTimeout(termTimer);
      clearTimeout(killTimer);
      this.forwarder.detachAll();
    }
  }
}
