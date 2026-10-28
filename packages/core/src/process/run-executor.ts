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
  PROCESS_SPAWN_ERROR,
  UNSUPPORTED_CAPABILITY,
  ProcessError,
} from "../errors";
import type {
  ProcessDriver,
  ProcessHandle,
  ProcessObserver,
} from "./driver";

type TerminateOutcome = { ok: true } | { ok: false; error: unknown };

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

    // 对齐 start 防御顺序：派生前检查取消信号，已中止直接抛出取消错误不再派生进程
    if (call?.signal?.aborted) {
      throw call.signal.reason instanceof ProcessError
        ? call.signal.reason
        : new ProcessError(PROCESS_CANCELLED, "Process run was cancelled");
    }

    const effectiveSpec: LaunchSpec = {
      ...input.spec,
      io: {
        ...input.spec.io,
        mode: "pipe",
      },
    };

    const chunks: OutputChunk[] = [];
    let totalBytes = 0;
    let truncated = false;
    let timedOut = false;
    let cancelled = false;
    let faultError: Error | undefined;
    let exitResult: { code: number | null; signal: string | null } | undefined;

    let driverHandle: ProcessHandle | undefined;
    let terminationOutcomePromise: Promise<TerminateOutcome> | undefined;
    let requestedGraceMs: number | undefined;

    // 唤醒统一等待链路的信号
    let wakeUpWaiters!: () => void;
    const wakeUpPromise = new Promise<void>((resolve) => {
      wakeUpWaiters = resolve;
    });

    const triggerTerminate = (graceMs: number): Promise<TerminateOutcome> => {
      requestedGraceMs = Math.min(requestedGraceMs ?? graceMs, graceMs);
      // 同步驱动可在 spawn 返回句柄前上报超限或故障，不能缓存一次空的清理结果。
      if (!driverHandle) return Promise.resolve({ ok: true });
      if (!terminationOutcomePromise) {
        const rawPromise = Promise.resolve().then(() =>
          this.driver.terminate(driverHandle!, requestedGraceMs!)
        );
        terminationOutcomePromise = rawPromise.then(
          () => ({ ok: true as const }),
          (error: unknown) => ({ ok: false as const, error })
        );
      }
      return terminationOutcomePromise;
    };

    const observer: ProcessObserver = {
      output: (stream, data) => {
        if (truncated) return;
        if (stream !== "stdout" && stream !== "stderr") return;

        const remaining = input.maxOutputBytes - totalBytes;
        if (remaining <= 0) {
          truncated = true;
          triggerTerminate(1000);
          wakeUpWaiters();
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
          triggerTerminate(1000);
          wakeUpWaiters();
        } else {
          chunks.push({
            stream,
            data: encodeBytes(data),
          });
          totalBytes += data.byteLength;
        }
      },
      exited: (exit) => {
        exitResult = exit;
        wakeUpWaiters();
      },
      outputClosed: () => {},
      fault: (err) => {
        faultError = err;
        triggerTerminate(0);
        wakeUpWaiters();
      },
    };

    driverHandle = await this.driver.spawn(effectiveSpec, observer);

    // 检查派生期间是否已被标记取消
    if (call?.signal?.aborted) {
      cancelled = true;
      triggerTerminate(1000);
    }

    let timeoutTimer: ReturnType<typeof setTimeout> | undefined;
    if (input.timeoutMs > 0 && !cancelled) {
      timeoutTimer = setTimeout(() => {
        timedOut = true;
        triggerTerminate(1000);
        wakeUpWaiters();
      }, input.timeoutMs);
      if (typeof (timeoutTimer as any)?.unref === "function") {
        (timeoutTimer as any).unref();
      }
    }

    let onAbort: (() => void) | undefined;
    if (call?.signal && !cancelled) {
      onAbort = () => {
        cancelled = true;
        if (timeoutTimer) clearTimeout(timeoutTimer);
        triggerTerminate(1000);
        wakeUpWaiters();
      };
      call.signal.addEventListener("abort", onAbort, { once: true });
    }

    try {
      // 统一等待唤醒：exit、fault、timeout、cancel、output-limit 均触发 wakeUpPromise
      while (!exitResult && !faultError && !timedOut && !cancelled && !truncated) {
        await wakeUpPromise;
      }

      // 等待终结后清理定时器与事件监听
      if (timeoutTimer) clearTimeout(timeoutTimer);
      if (call?.signal && onAbort) {
        call.signal.removeEventListener("abort", onAbort);
      }

      // 若启动了终止（超时、取消、输出超限、故障），统一等待单次终止排空结果
      let outcome: TerminateOutcome = { ok: true };
      if (terminationOutcomePromise || timedOut || cancelled || truncated || faultError) {
        outcome = await triggerTerminate(1000);
      }

      // 统一分类主错误及清理 cause
      if (faultError) {
        if (!outcome.ok && !(faultError as any).cause) {
          (faultError as any).cause = outcome.error;
        }
        throw faultError;
      }

      if (timedOut) {
        const err = new ProcessError(
          PROCESS_TIMEOUT,
          `Process exceeded timeout of ${input.timeoutMs}ms`,
          !outcome.ok ? { cause: outcome.error } : undefined
        );
        if (!outcome.ok) {
          (err as any).cause = outcome.error;
        }
        throw err;
      }

      if (cancelled || call?.signal?.aborted) {
        const baseReason = call?.signal?.reason;
        if (baseReason !== undefined && outcome.ok) throw baseReason;
        if (baseReason instanceof Error) {
          if (!outcome.ok && !(baseReason as any).cause) {
            (baseReason as any).cause = outcome.error;
          }
          throw baseReason;
        }
        const err = new ProcessError(
          PROCESS_CANCELLED,
          "Process run was cancelled",
          !outcome.ok ? { cause: outcome.error, reason: baseReason } : undefined
        );
        if (!outcome.ok) {
          (err as any).cause = outcome.error;
        }
        throw err;
      }

      if (truncated) {
        if (!outcome.ok) {
          // 输出限额触发的强杀清理若发生异常，必须抛出清理错误避免静默吞错
          throw outcome.error instanceof Error
            ? outcome.error
            : new ProcessError(PROCESS_TIMEOUT, String(outcome.error));
        }
        if (!exitResult) {
          throw new ProcessError(PROCESS_SPAWN_ERROR, "Terminated process did not report an exit result");
        }
        return {
          exit: exitResult,
          chunks,
          truncated: true,
        };
      }

      return {
        exit: exitResult!,
        chunks,
        truncated: false,
      };
    } finally {
      if (timeoutTimer) clearTimeout(timeoutTimer);
      if (call?.signal && onAbort) {
        call.signal.removeEventListener("abort", onAbort);
      }
    }
  }
}
