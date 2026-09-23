import { randomUUID } from "node:crypto";
import { fork, type ChildProcess } from "node:child_process";
import type {
  ActionRef,
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
} from "../package/types";
import type {
  CancelResult,
  ExecutionTicket,
} from "../execution/types";
import type { RunOptions } from "../invocation/types";
import { DiagnosticForwarder } from "./diagnostic";
import { EXECUTION_ABORTED, HOST_PROCESS_EXITED } from "../errors";
import type {
  ActionDockService,
  ConfigPort,
  ConfigValueView,
  DiscoveryPort,
  ExecutionPort,
  ListRunsOptions,
  RunsPort,
  StatePort,
  StateScopeOptions,
} from "../service/types";
import type { StateEntry } from "../storage/types";
import type {
  IpcAbortMessage,
  IpcCallMessage,
  IpcResponseMessage,
  IpcServiceOptions,
} from "./types";

/**
 * 跨进程取消信号占位标记字段名。
 * AbortSignal 不可序列化，序列化 options 时把 signal 字段替换为该标记，
 * 宿主侧识别后重建 AbortController 并接入 abort 消息通知链路。
 */
export const IPC_SIGNAL_MARKER = "__ipcSignal";

/**
 * 判断执行选项中是否携带跨进程取消信号占位标记。
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
 */
function markIpcSignal(options?: RunOptions): Record<string, unknown> | undefined {
  if (!options) return undefined;
  const clean: Record<string, unknown> = {};
  if (options.timeoutMs !== undefined) clean.timeoutMs = options.timeoutMs;
  if (options.config !== undefined) clean.config = options.config;
  if (options.requestId !== undefined) clean.requestId = options.requestId;
  if (options.signal) {
    clean[IPC_SIGNAL_MARKER] = true;
  }
  return clean;
}

/**
 * 基于 Node IPC 监督进程通信通道的 ActionDockService 实现。
 * 遵循标准 Service Ports 体系，隔离子进程生命周期并暴露结构化服务端口。
 */
export class IpcActionDockService implements ActionDockService {
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

  public readonly discovery: DiscoveryPort;
  public readonly execution: ExecutionPort;
  public readonly runs: RunsPort;
  public readonly management?: {
    config: ConfigPort;
    state: StatePort;
  };

  constructor(options: IpcServiceOptions) {
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
      throw new Error("IpcActionDockService requires either 'childProcess' or 'scriptPath'");
    }

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
            const err = new Error(resp.error?.message || "IPC Service call failed");
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
      (err as any).code = HOST_PROCESS_EXITED;
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
      this.forwarder.detachAll();
      resolveReady();
    });

    const self = this;

    this.discovery = {
      async listPackages(): Promise<PackageInfo[]> {
        return self.callRemote<PackageInfo[]>("listPackages", []);
      },

      async listActions(opts?: ListActionsOptions): Promise<ActionSummary[]> {
        return self.callRemote<ActionSummary[]>("listActions", [opts]);
      },

      async describeAction(ref: ActionRef | string): Promise<ActionSpec> {
        return self.callRemote<ActionSpec>("describeAction", [ref]);
      },

      async listPlaybooks(opts?: { intent?: string; package?: string }): Promise<PlaybookSummary[]> {
        return self.callRemote<PlaybookSummary[]>("listPlaybooks", [opts]);
      },

      async describePlaybook(id: string): Promise<PlaybookSpec> {
        return self.callRemote<PlaybookSpec>("describePlaybook", [id]);
      },
    };

    this.execution = {
      async run(
        ref: ActionRef | string,
        input?: unknown,
        opts?: RunOptions
      ): Promise<ExecutionResult> {
        if (opts?.signal?.aborted) {
          return {
            ok: false,
            runId: randomUUID(),
            error: {
              code: EXECUTION_ABORTED,
              message: "Execution was aborted before starting",
            },
          };
        }
        const serializableOptions = markIpcSignal(opts);
        return self.callRemote<ExecutionResult>("runAction", [ref, input ?? {}, serializableOptions], opts?.signal);
      },

      async start(
        ref: ActionRef | string,
        input?: unknown,
        opts?: RunOptions
      ): Promise<ExecutionTicket> {
        if (opts?.signal?.aborted) {
          throw new Error("Execution was aborted before starting");
        }
        const serializableOptions = markIpcSignal(opts);
        return self.callRemote<ExecutionTicket>("startAction", [ref, input ?? {}, serializableOptions], opts?.signal);
      },
    };

    this.runs = {
      async list(query?: ListRunsOptions): Promise<RunRecord[]> {
        return self.callRemote<RunRecord[]>("listRuns", [query]);
      },

      async get(runId: string): Promise<RunRecord | undefined> {
        const res = await self.callRemote<RunRecord | null | undefined>("getRun", [runId]);
        return res ?? undefined;
      },

      async cancel(runId: string, reason?: string): Promise<CancelResult> {
        return self.callRemote<CancelResult>("cancelRun", [runId, reason]);
      },

      async clear(opts?: { packageId?: string; actionId?: string; status?: string; olderThanMs?: number }): Promise<number> {
        return self.callRemote<number>("clearRuns", [opts]);
      },
    };

    if (options.enableManagement !== false) {
      this.management = {
        config: {
          async get(packageId: string, key: string): Promise<ConfigValueView> {
            return self.callRemote<ConfigValueView>("getConfig", [packageId, key]);
          },

          async set(packageId: string, key: string, value: JsonValue): Promise<void> {
            return self.callRemote<void>("setConfig", [packageId, key, value]);
          },

          async delete(packageId: string, key: string): Promise<boolean> {
            return self.callRemote<boolean>("deleteConfig", [packageId, key]);
          },

          async list(packageId: string): Promise<ConfigValueView[]> {
            return self.callRemote<ConfigValueView[]>("listConfig", [packageId]);
          },
        },

        state: {
          async get<T extends JsonValue = JsonValue>(
            packageId: string,
            actionId: string,
            key: string,
            opts?: StateScopeOptions
          ): Promise<T | undefined> {
            return self.callRemote<T | undefined>("getState", [packageId, actionId, key, opts]);
          },

          async set<T extends JsonValue = JsonValue>(
            packageId: string,
            actionId: string,
            key: string,
            value: T,
            opts?: StateScopeOptions
          ): Promise<void> {
            return self.callRemote<void>("setState", [packageId, actionId, key, value, opts]);
          },

          async delete(
            packageId: string,
            actionId: string,
            key: string,
            opts?: StateScopeOptions
          ): Promise<boolean> {
            return self.callRemote<boolean>("deleteState", [packageId, actionId, key, opts]);
          },

          async list(
            packageId: string,
            actionId: string,
            opts?: StateScopeOptions
          ): Promise<string[]> {
            return self.callRemote<string[]>("listStateKeys", [packageId, actionId, opts]);
          },

          async clear(
            packageId: string,
            actionId: string,
            opts?: StateScopeOptions
          ): Promise<number> {
            return self.callRemote<number>("clearState", [packageId, actionId, opts]);
          },

          async listEntries(
            packageId: string,
            opts?: any
          ): Promise<StateEntry[]> {
            return self.callRemote<StateEntry[]>("listStateEntries", [packageId, opts]);
          },
        },
      };
    }
  }

  public async ready(): Promise<void> {
    await this.readyPromise;
  }

  private async callRemote<T>(method: string, args: unknown[], signal?: AbortSignal): Promise<T> {
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
      throw this.exitError || new Error(`IpcActionDockService is closed: cannot call '${method}'`);
    }

    await this.readyPromise;

    if (signal?.aborted) {
      const err = new Error(signal.reason ? String(signal.reason) : "Operation aborted");
      (err as any).name = "AbortError";
      throw err;
    }

    const id = randomUUID();
    const message: IpcCallMessage = {
      id,
      type: "call",
      method,
      args,
    };

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
        if (!this.child.send) {
          throw new Error("ChildProcess IPC channel is not available");
        }
        this.child.send(message, (err) => {
          if (err) {
            this.pendingCalls.delete(id);
            reject(err);
          }
        });
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

  private sendAbort(id: string): void {
    if (this.isClosed) return;
    try {
      const abortMsg: IpcAbortMessage = { id, type: "abort" };
      if (this.child.send) {
        this.child.send(abortMsg);
      }
    } catch (err) {
      process.stderr.write(
        `[IPC Service] Failed to send abort for call '${id}': ${
          err instanceof Error ? err.message : String(err)
        }\n`
      );
    }
  }

  async info(): Promise<PackageInfo[]> {
    return this.discovery.listPackages();
  }

  get process(): ChildProcess {
    return this.child;
  }

  async waitReady(): Promise<void> {
    return this.readyPromise;
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
