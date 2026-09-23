import {
  encodeBytes,
  type CallOptions,
  type LaunchSpec,
  type OutputChunk,
  type ProcessRunInput,
  type ProcessRunResult,
} from "@actiondock/sdk";
import {
  PROCESS_CANCELLED,
  PROCESS_TIMEOUT,
  UNSUPPORTED_CAPABILITY,
  ProcessError,
} from "../errors";
import type {
  ProcessDriver,
  ProcessHandle,
  ProcessObserver,
} from "./driver";

/**
 * 一次性 run 执行器。
 *
 * 仅依赖底层驱动、错误映射与输入校验，不触碰进程注册表：
 * 派生独立 run 进程、收集有限输出并支持协作式取消与超时回收。
 */
export class RunExecutor {
  private readonly driver: ProcessDriver;

  constructor(driver: ProcessDriver) {
    this.driver = driver;
  }

  /**
   * 执行一次性外部命令运行。
   */
  async execute(input: ProcessRunInput, call?: CallOptions): Promise<ProcessRunResult> {
    const ioMode = input.spec.io?.mode ?? "pipe";
    if (ioMode !== "pipe") {
      throw new ProcessError(UNSUPPORTED_CAPABILITY, "Run requires IO mode to be 'pipe'");
    }

    const effectiveSpec: LaunchSpec = {
      ...input.spec,
      io: {
        ...input.spec.io,
        mode: "pipe",
      },
    };

    const runProcessId = `run-${crypto.randomUUID()}`;
    const chunks: OutputChunk[] = [];
    let totalBytes = 0;
    let truncated = false;
    let timedOut = false;
    let cancelled = false;

    let resolveExit!: (exit: { code: number | null; signal: string | null }) => void;
    let rejectError!: (err: Error) => void;
    const exitPromise = new Promise<{ code: number | null; signal: string | null }>((resolve, reject) => {
      resolveExit = resolve;
      rejectError = reject;
    });

    let driverHandle: ProcessHandle | undefined;

    const observer: ProcessObserver = {
      output: (stream, data) => {
        if (truncated) return;
        if (stream !== "stdout" && stream !== "stderr") return;

        const remaining = input.maxOutputBytes - totalBytes;
        if (remaining <= 0) {
          truncated = true;
          if (driverHandle) {
            void this.driver.terminate(driverHandle, 1000);
          }
          return;
        }

        if (data.byteLength > remaining) {
          const slice = data.subarray(0, remaining);
          chunks.push({
            stream,
            data: encodeBytes(slice),
          });
          totalBytes += slice.byteLength;
          truncated = true;
          if (driverHandle) {
            void this.driver.terminate(driverHandle, 1000);
          }
        } else {
          chunks.push({
            stream,
            data: encodeBytes(data),
          });
          totalBytes += data.byteLength;
        }
      },
      exited: (exit) => {
        resolveExit(exit);
      },
      outputClosed: () => {},
      fault: (err) => {
        rejectError(err);
      },
    };

    // 对齐 start 防御顺序：派生前检查取消信号，已中止直接抛出取消错误不再派生进程
    if (call?.signal?.aborted) {
      throw call.signal.reason instanceof ProcessError
        ? call.signal.reason
        : new ProcessError(PROCESS_CANCELLED, "Process run was cancelled");
    }

    driverHandle = await this.driver.spawn(effectiveSpec, observer);

    let timeoutTimer: ReturnType<typeof setTimeout> | undefined;
    if (input.timeoutMs > 0) {
      timeoutTimer = setTimeout(() => {
        timedOut = true;
        if (driverHandle) {
          void this.driver.terminate(driverHandle, 1000);
        }
      }, input.timeoutMs);
      if (typeof (timeoutTimer as any)?.unref === "function") {
        (timeoutTimer as any).unref();
      }
    }

    let onAbort: (() => void) | undefined;
    if (call?.signal) {
      if (call.signal.aborted) {
        if (timeoutTimer) clearTimeout(timeoutTimer);
        if (driverHandle) void this.driver.terminate(driverHandle, 1000);
        throw call.signal.reason ?? new ProcessError(PROCESS_CANCELLED, "Process run was cancelled");
      }
      onAbort = () => {
        cancelled = true;
        if (timeoutTimer) clearTimeout(timeoutTimer);
        if (driverHandle) void this.driver.terminate(driverHandle, 1000);
      };
      call.signal.addEventListener("abort", onAbort, { once: true });
    }

    try {
      const exit = await exitPromise;
      if (timeoutTimer) clearTimeout(timeoutTimer);
      if (call?.signal && onAbort) {
        call.signal.removeEventListener("abort", onAbort);
      }

      if (timedOut) {
        throw new ProcessError(PROCESS_TIMEOUT, `Process exceeded timeout of ${input.timeoutMs}ms`);
      }
      if (cancelled || call?.signal?.aborted) {
        throw call?.signal?.reason ?? new ProcessError(PROCESS_CANCELLED, "Process run was cancelled");
      }

      return {
        exit,
        chunks,
        truncated,
      };
    } catch (err: any) {
      if (timeoutTimer) clearTimeout(timeoutTimer);
      if (call?.signal && onAbort) {
        call.signal.removeEventListener("abort", onAbort);
      }
      if (timedOut) {
        throw new ProcessError(PROCESS_TIMEOUT, `Process exceeded timeout of ${input.timeoutMs}ms`);
      }
      if (cancelled || call?.signal?.aborted) {
        throw call?.signal?.reason ?? new ProcessError(PROCESS_CANCELLED, "Process run was cancelled");
      }
      throw err;
    }
  }
}
