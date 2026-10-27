import type { LaunchSpec } from "@actiondock/sdk";
import {
  INVALID_ARGUMENT,
  INPUT_CLOSED,
  PROCESS_CANCELLED,
  PROCESS_SPAWN_ERROR,
  PROCESS_TIMEOUT,
  ProcessError,
} from "../errors";
import type { ProcessDriver, ProcessHandle, ProcessObserver } from "./driver";
import { NodeProcessDriver } from "./process-driver";

/**
 * 工程工具命令执行配置选项。
 */
export interface ExecuteCommandOptions {
  cwd?: string;
  env?: Record<string, string | undefined>;
  signal?: AbortSignal;
  timeoutMs?: number;
  maxOutputBytes?: number;
  onOutput?: (stream: "stdout" | "stderr", text: string) => void;
  driver?: ProcessDriver;
}

/**
 * 工程工具命令执行结果。
 */
export interface CommandExecutionResult {
  status: number | null;
  signal: string | null;
  stdout: string;
  stderr: string;
  truncated: boolean;
}

/**
 * 独立深拷贝字节切片，脱离原始底层 ArrayBuffer 并杜绝驱动缓冲区复用污染。
 */
function cloneSlice(source: Uint8Array, length: number): Uint8Array {
  const cloned = new Uint8Array(length);
  cloned.set(source.subarray(0, length));
  return cloned;
}

/**
 * 辅助将多个字节切片合并并解码为 UTF-8 文本。
 */
function decodeChunks(chunks: Uint8Array[], totalBytes: number): string {
  if (totalBytes === 0) {
    return "";
  }
  const merged = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder("utf-8").decode(merged);
}

/**
 * 面向工程工具的一次性命令适配执行器。
 *
 * 核心设计契约：
 * - 复用底层 ProcessDriver 平台驱动，严格保持进程组隔离与进程树收敛能力；
 * - 绝不启用系统 Shell，参数列表原样透传，杜绝命令注入与参数转义漏洞；
 * - 默认每流上限 512KiB 字节有界捕获，超出上限继续排空或转发并置 truncated 标志；
 * - 捕获字节独立深拷贝，脱离原始底层缓冲区以防内存滞留与复用篡改；
 * - 仅当显式指定 onOutput 时流式转发，严格保证跨分块 UTF-8 字符解码完整性；
 * - 规范化取消、超时与异常收敛：等待 driver.terminate 与 outputClosed 终态后抛出结构化 ProcessError。
 */
export async function executeCommand(
  executable: string,
  args: readonly string[],
  options?: ExecuteCommandOptions
): Promise<CommandExecutionResult> {
  // 参数合法性前置校验
  if (options?.maxOutputBytes !== undefined) {
    if (
      !Number.isSafeInteger(options.maxOutputBytes) ||
      options.maxOutputBytes < 0
    ) {
      throw new ProcessError(
        INVALID_ARGUMENT,
        "maxOutputBytes must be a non-negative finite number"
      );
    }
  }

  if (options?.timeoutMs !== undefined) {
    if (
      !Number.isFinite(options.timeoutMs) ||
      options.timeoutMs > 2_147_483_647 ||
      options.timeoutMs < 0
    ) {
      throw new ProcessError(
        INVALID_ARGUMENT,
        "timeoutMs must be a non-negative finite number"
      );
    }
  }

  const driver = options?.driver ?? new NodeProcessDriver();

  // 若信号在启动前已触发中止，直接以 PROCESS_CANCELLED 拒绝
  if (options?.signal?.aborted) {
    throw new ProcessError(
      PROCESS_CANCELLED,
      `Command execution was cancelled before spawn: ${executable}`,
      { cause: options.signal.reason, executable, args: [...args] }
    );
  }

  // 组装环境变量：未传 env 时显式复制 process.env 中非 undefined 项，通过 inherit: 'none' 保留私有凭据与配置
  const envSet: Record<string, string> = {};
  if (options?.env) {
    for (const [k, v] of Object.entries(options.env)) {
      if (v !== undefined) {
        envSet[k] = v;
      }
    }
  } else {
    for (const [k, v] of Object.entries(process.env)) {
      if (v !== undefined) {
        envSet[k] = v;
      }
    }
  }

  const spec: LaunchSpec = {
    executable,
    args: [...args],
    cwd: options?.cwd,
    env: {
      inherit: "none",
      set: envSet,
    },
    io: {
      mode: "pipe",
    },
  };

  const maxBytes = options?.maxOutputBytes ?? 512 * 1024;
  let truncated = false;

  let stdoutBytes = 0;
  let stderrBytes = 0;
  const stdoutChunks: Uint8Array[] = [];
  const stderrChunks: Uint8Array[] = [];

  const stdoutDecoder = options?.onOutput ? new TextDecoder("utf-8") : undefined;
  const stderrDecoder = options?.onOutput ? new TextDecoder("utf-8") : undefined;

  let abortReason: "cancelled" | "timeout" | "output-error" | "fault" | null = null;
  let abortCause: unknown = null;

  let resolveAbort: () => void;
  const abortTriggeredPromise = new Promise<void>((r) => {
    resolveAbort = r;
  });

  const triggerAbort = (reason: "cancelled" | "timeout" | "output-error" | "fault", cause?: unknown) => {
    if (abortReason) return;
    abortReason = reason;
    abortCause = cause;
    resolveAbort();
  };

  const dispatchOutput = (stream: "stdout" | "stderr", text: string) => {
    if (abortReason === "output-error" || !options?.onOutput) return;
    try {
      options.onOutput(stream, text);
    } catch (err) {
      triggerAbort("output-error", err);
    }
  };

  const flushDecoders = () => {
    if (stdoutDecoder) {
      const rem = stdoutDecoder.decode();
      if (rem.length > 0) {
        dispatchOutput("stdout", rem);
      }
    }
    if (stderrDecoder) {
      const rem = stderrDecoder.decode();
      if (rem.length > 0) {
        dispatchOutput("stderr", rem);
      }
    }
  };

  const state: {
    exitResult: { code: number | null; signal: string | null } | null;
    faultError: Error | null;
    closed: boolean;
  } = { exitResult: null, faultError: null, closed: false };

  let resolveOutputClosed: () => void;
  const outputClosedPromise = new Promise<void>((r) => {
    resolveOutputClosed = r;
  });

  // 在 spawn 之前创建 observer 与关联 promise，杜绝同步驱动或测试桩发出的生命周期事件丢失
  const observer: ProcessObserver = {
    output(stream, data) {
      if (stream === "stdout") {
        const remaining = maxBytes - stdoutBytes;
        if (remaining > 0) {
          if (data.byteLength <= remaining) {
            stdoutChunks.push(cloneSlice(data, data.byteLength));
            stdoutBytes += data.byteLength;
          } else {
            stdoutChunks.push(cloneSlice(data, remaining));
            stdoutBytes += remaining;
            truncated = true;
          }
        } else {
          truncated = true;
        }
        if (stdoutDecoder) {
          const text = stdoutDecoder.decode(data, { stream: true });
          if (text.length > 0) {
            dispatchOutput("stdout", text);
          }
        }
      } else if (stream === "stderr") {
        const remaining = maxBytes - stderrBytes;
        if (remaining > 0) {
          if (data.byteLength <= remaining) {
            stderrChunks.push(cloneSlice(data, data.byteLength));
            stderrBytes += data.byteLength;
          } else {
            stderrChunks.push(cloneSlice(data, remaining));
            stderrBytes += remaining;
            truncated = true;
          }
        } else {
          truncated = true;
        }
        if (stderrDecoder) {
          const text = stderrDecoder.decode(data, { stream: true });
          if (text.length > 0) {
            dispatchOutput("stderr", text);
          }
        }
      }
    },
    exited(result) {
      state.exitResult = result;
    },
    outputClosed() {
      if (state.closed) return;
      state.closed = true;
      flushDecoders();
      resolveOutputClosed();
    },
    fault(err) {
      state.faultError = err;
      triggerAbort("fault", err);
    },
  };

  // 绑定外部取消信号与超时定时器
  let timeoutTimer: NodeJS.Timeout | undefined;
  const onSignalAbort = () => {
    triggerAbort("cancelled", options?.signal?.reason);
  };

  if (options?.signal) {
    options.signal.addEventListener("abort", onSignalAbort, { once: true });
    // 监听注册后再次检查，消除注册前后的时序竞态
    if (options.signal.aborted) {
      triggerAbort("cancelled", options.signal.reason);
    }
  }

  if (options?.timeoutMs && options.timeoutMs > 0) {
    timeoutTimer = setTimeout(() => {
      triggerAbort("timeout");
    }, options.timeoutMs);
  }

  let handle: ProcessHandle | undefined;

  // 统一的中止清理与错误抛出函数：真实等待驱动终止与输出闭合，绝不吞错，绝不假放行
  const performAbortCleanupAndThrow = async (activeHandle?: ProcessHandle): Promise<never> => {
    if (activeHandle) {
      await driver.terminate(activeHandle, abortReason === "output-error" ? 0 : 200);
      await outputClosedPromise;
    }

    if (abortReason === "output-error") {
      throw abortCause;
    }
    if (abortReason === "fault") {
      throw new ProcessError(
        PROCESS_SPAWN_ERROR,
        `Process reported fault: ${state.faultError?.message ?? String(abortCause)}`,
        { cause: abortCause, executable }
      );
    }
    if (abortReason === "timeout") {
      throw new ProcessError(
        PROCESS_TIMEOUT,
        `Command execution timed out after ${options?.timeoutMs}ms: ${executable}`,
        { timeoutMs: options?.timeoutMs, executable }
      );
    }
    throw new ProcessError(
      PROCESS_CANCELLED,
      `Command execution was cancelled: ${executable}`,
      { cause: abortCause, executable }
    );
  };

  try {
    try {
      handle = await driver.spawn(spec, observer);
    } catch (err: any) {
      const spawnErr =
        err instanceof ProcessError && err.code === PROCESS_SPAWN_ERROR
          ? err
          : new ProcessError(
              PROCESS_SPAWN_ERROR,
              `Failed to spawn command "${executable}": ${err?.message || String(err)}`,
              { cause: err, executable, args: [...args] }
            );
      throw spawnErr;
    }

    // 检查在派生过程（await driver.spawn）中是否发生了取消、超时或异常
    if (abortReason) {
      await performAbortCleanupAndThrow(handle);
    }

    // 派生成功后立即发送 EOF 关闭标准输入，防止子进程因等待输入而死锁挂起
    if (driver.inputEOF && !state.closed) {
      const eof = Promise.resolve().then(() => driver.inputEOF!(handle!)).then(
        () => ({ error: undefined as unknown, failed: false }),
        (error: unknown) => ({ error, failed: true })
      );
      const result = await Promise.race([
        eof,
        abortTriggeredPromise.then(() => undefined),
      ]);
      if (result?.failed) {
        const error = result.error as { code?: string } | null;
        const isClosedError = error?.code === INPUT_CLOSED || error?.code === "EPIPE" || error?.code === "ERR_STREAM_DESTROYED";
        if (!isClosedError && !state.closed) {
          triggerAbort("output-error", result.error);
        }
      }
    }

    // 检查发送 EOF 期间是否已被触发中止
    if (abortReason) {
      await performAbortCleanupAndThrow(handle);
    }

    // 等待输出完全收敛或中途触发中止
    await Promise.race([outputClosedPromise, abortTriggeredPromise]);

    if (abortReason) {
      await performAbortCleanupAndThrow(handle);
    }

    // 若底层 observer 上报严重故障，无论 exitResult 是否存在，均终结为 PROCESS_SPAWN_ERROR
    if (state.faultError) {
      throw new ProcessError(
        PROCESS_SPAWN_ERROR,
        `Process reported fault: ${state.faultError.message}`,
        { cause: state.faultError, executable }
      );
    }

    const stdout = decodeChunks(stdoutChunks, stdoutBytes);
    const stderr = decodeChunks(stderrChunks, stderrBytes);

    return {
      status: state.exitResult?.code ?? null,
      signal: state.exitResult?.signal ?? null,
      stdout,
      stderr,
      truncated,
    };
  } finally {
    if (timeoutTimer) {
      clearTimeout(timeoutTimer);
      timeoutTimer = undefined;
    }
    if (options?.signal) {
      options.signal.removeEventListener("abort", onSignalAbort);
    }
    if (handle && driver.dispose) {
      await driver.dispose(handle);
    }
  }
}
