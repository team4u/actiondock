import type { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  type CallOptions,
  type ControlGrant,
  type OperationReceipt,
  type ProcessAcquireInput,
  type ProcessControlInput,
  type ProcessExecOptions,
  type ProcessInfo,
  type ProcessListInput,
  type ProcessListResult,
  type ProcessReadInput,
  type ProcessResult,
  type ProcessRunInput,
  type ProcessRunResult,
  type ProcessStartInput,
  type ProcessStartResult,
  type ProcessStopInput,
  type ProcessWriteInput,
  type ReadResult,
  type RuntimeError,
  type LaunchSpec,
} from "@actiondock/sdk";
import {
  PROCESS_CANCELLED,
  PROCESS_OUTPUT_LIMIT,
  PROCESS_SPAWN_ERROR,
  PROCESS_TIMEOUT,
  UNSUPPORTED_CAPABILITY,
  ProcessError,
} from "../errors";
import type { ProcessDriver, ProcessDriverCallbacks, ProcessDriverHandle } from "./driver";
import { NodeProcessDriver, killProcessGroup } from "./process-driver";
import { RunExecutor } from "./run-executor";
import type { ProcessExecutor } from "../runtime/process";

export { killProcessGroup };

/**
 * 基于 NodeProcessDriver 实现的兼容命令执行器。
 * 核心 OS 进程派生与生命周期管理统一由 NodeProcessDriver 承担，不再重复派生与调度。
 */
export class NodeProcessExecutor implements ProcessExecutor {
  private readonly driver: ProcessDriver;
  private readonly gracePeriodMs: number;

  constructor(options?: number | { gracePeriodMs?: number; spawnFn?: typeof spawn; driver?: ProcessDriver }) {
    if (typeof options === "number") {
      this.gracePeriodMs = options;
      this.driver = new NodeProcessDriver();
    } else {
      this.gracePeriodMs = options?.gracePeriodMs ?? 500;
      this.driver =
        options?.driver ??
        new NodeProcessDriver({
          spawnFn: options?.spawnFn,
        });
    }
  }

  /**
   * 执行外部系统命令，完整支持标准输入管道、超时控制、取消信号、输出容量截断及错误拦截。
   *
   * @param command 执行命令
   * @param args 参数列表
   * @param options 执行选项
   * @param internal 内部专用参数：envAlreadyResolved 为 true 时 options.env 视为已完整解析
   */
  async exec(
    command: string,
    args: string[] = [],
    options: ProcessExecOptions = {},
    internal?: { envAlreadyResolved?: boolean }
  ): Promise<ProcessResult> {
    const startTime = Date.now();
    const maxOutputBytes = options.maxOutputBytes ?? 10 * 1024 * 1024;
    const encoding = (options.encoding as BufferEncoding) || "utf8";
    const processId = `exec-${randomUUID()}`;

    return new Promise<ProcessResult>(async (resolve, reject) => {
      let settled = false;
      let timedOut = false;
      let cancelled = false;
      let outputLimitExceeded = false;
      let error: RuntimeError | undefined;
      let writeErr: Error | undefined;

      const stdoutChunks: Buffer[] = [];
      const stderrChunks: Buffer[] = [];
      let totalBytes = 0;

      let timeoutTimer: NodeJS.Timeout | undefined;
      let abortHandler: (() => void) | undefined;
      let handle: ProcessDriverHandle | undefined;

      const finish = (result: ProcessResult) => {
        if (settled) return;
        settled = true;
        if (timeoutTimer) {
          clearTimeout(timeoutTimer);
          timeoutTimer = undefined;
        }
        if (options.signal && abortHandler) {
          options.signal.removeEventListener("abort", abortHandler);
        }
        if (!result.ok && options.throwOnError) {
          const errMsg =
            result.error?.message || result.stderr || `Process exited with code ${result.exitCode}`;
          reject(new Error(errMsg));
        } else {
          resolve(result);
        }
      };

      let graceTimer: NodeJS.Timeout | undefined;

      const terminateChild = (sig: "SIGTERM" | "SIGKILL" = "SIGTERM") => {
        const pid = handle?.pid;
        if (pid) {
          killProcessGroup(pid, sig, (this.driver as any).spawnFn);
        }
        if (timeoutTimer) {
          clearTimeout(timeoutTimer);
          timeoutTimer = undefined;
        }
        if (sig === "SIGKILL") {
          if (graceTimer) {
            clearTimeout(graceTimer);
            graceTimer = undefined;
          }
        } else if (!graceTimer) {
          graceTimer = setTimeout(() => {
            graceTimer = undefined;
            const targetPid = handle?.pid;
            if (targetPid) {
              killProcessGroup(targetPid, "SIGKILL", (this.driver as any).spawnFn);
            }
          }, this.gracePeriodMs);
          graceTimer.unref?.();
        }
      };

      const callbacks: ProcessDriverCallbacks = {
        onOutput: (stream, data) => {
          if (outputLimitExceeded) return;
          const chunk = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
          totalBytes += chunk.length;
          if (totalBytes > maxOutputBytes) {
            outputLimitExceeded = true;
            if (!error) {
              error = {
                code: PROCESS_OUTPUT_LIMIT,
                message: `Process output exceeded limit of ${maxOutputBytes} bytes`,
              };
            }
            terminateChild("SIGTERM");
            return;
          }
          if (stream === "stdout") stdoutChunks.push(chunk);
          else if (stream === "stderr") stderrChunks.push(chunk);
        },
        onExit: (exit) => {
          const durationMs = Date.now() - startTime;
          const stdoutBuf = Buffer.concat(stdoutChunks);
          const stderrBuf = Buffer.concat(
            writeErr
              ? [...stderrChunks, Buffer.from(`\n[stdin write failed: ${writeErr.message}]`)]
              : stderrChunks
          );
          const stdoutStr = stdoutBuf.toString(encoding);
          const stderrStr = stderrBuf.toString(encoding);

          const ok = exit.code === 0 && !timedOut && !cancelled && !error;
          finish({
            ok,
            exitCode: exit.code,
            signal: exit.signal || undefined,
            stdout: stdoutStr.trim(),
            stderr: stderrStr.trim(),
            raw: new Uint8Array(stdoutBuf),
            timedOut,
            cancelled,
            durationMs,
            error,
          });
        },
        onError: (err) => {
          const durationMs = Date.now() - startTime;
          const spawnError: RuntimeError = error || {
            code: PROCESS_SPAWN_ERROR,
            message: err.message || "Failed to spawn process",
          };
          const stdoutBuf = Buffer.concat(stdoutChunks);
          const stderrBuf = Buffer.concat(
            writeErr
              ? [...stderrChunks, Buffer.from(`\n[stdin write failed: ${writeErr.message}]`)]
              : stderrChunks
          );
          finish({
            ok: false,
            exitCode: null,
            signal: undefined,
            stdout: stdoutBuf.toString(encoding).trim(),
            stderr: stderrBuf.toString(encoding).trim() || spawnError.message,
            raw: new Uint8Array(stdoutBuf),
            timedOut,
            cancelled,
            durationMs,
            error: spawnError,
          });
        },
      };

      const effectiveEnv = internal?.envAlreadyResolved
        ? { inherit: "none" as const, set: options.env as Record<string, string> }
        : options.env
          ? { inherit: "allowlisted" as const, set: options.env }
          : undefined;

      const spec: LaunchSpec = {
        executable: command,
        args,
        cwd: options.cwd,
        env: effectiveEnv,
        io: { mode: "pipe" },
      };

      if (options.signal) {
        abortHandler = () => {
          cancelled = true;
          if (!error) {
            error = {
              code: PROCESS_CANCELLED,
              message: "Process was cancelled by AbortSignal",
            };
          }
          terminateChild("SIGTERM");
        };
        if (options.signal.aborted) {
          abortHandler();
        } else {
          options.signal.addEventListener("abort", abortHandler, { once: true });
        }
      }

      if (options.timeoutMs && options.timeoutMs > 0) {
        timeoutTimer = setTimeout(() => {
          timedOut = true;
          if (!error) {
            error = {
              code: PROCESS_TIMEOUT,
              message: `Process timed out after ${options.timeoutMs}ms`,
            };
          }
          terminateChild("SIGTERM");
        }, options.timeoutMs);
      }

      try {
        handle = await this.driver.spawn(processId, spec, callbacks);
        if (cancelled || timedOut || outputLimitExceeded) {
          terminateChild("SIGTERM");
        }
      } catch (spawnErr: any) {
        callbacks.onError(spawnErr);
        return;
      }

      if (options.input !== undefined && options.input !== null) {
        const inputBytes =
          typeof options.input === "string"
            ? new TextEncoder().encode(options.input)
            : options.input;
        handle
          .write(inputBytes)
          .then(() => handle?.sendInputEOF?.())
          .catch((err) => {
            writeErr = err;
          });
      }
    });
  }

  async spawn(
    command: string,
    args: string[] = [],
    options: ProcessExecOptions = {}
  ): Promise<ProcessResult> {
    return this.exec(command, args, options);
  }

  async run(input: ProcessRunInput, call?: CallOptions): Promise<ProcessRunResult> {
    const runExecutor = new RunExecutor(this.driver);
    return runExecutor.execute(input, call);
  }

  async start(_input: ProcessStartInput, _call?: CallOptions): Promise<ProcessStartResult> {
    throw new ProcessError(
      UNSUPPORTED_CAPABILITY,
      "NodeProcessExecutor does not support managed process start; use ProcessManager with NodeProcessDriver"
    );
  }

  async inspect(_id: string, _call?: CallOptions): Promise<ProcessInfo> {
    throw new ProcessError(UNSUPPORTED_CAPABILITY, "NodeProcessExecutor does not support managed process inspect");
  }

  async list(_input: ProcessListInput, _call?: CallOptions): Promise<ProcessListResult> {
    return { processes: [] };
  }

  async acquire(_id: string, _input: ProcessAcquireInput, _call?: CallOptions): Promise<ControlGrant> {
    throw new ProcessError(UNSUPPORTED_CAPABILITY, "NodeProcessExecutor does not support managed process acquire");
  }

  async renew(_id: string, _token: string, _ttlMs: number, _call?: CallOptions): Promise<ControlGrant> {
    throw new ProcessError(UNSUPPORTED_CAPABILITY, "NodeProcessExecutor does not support managed process renew");
  }

  async release(_id: string, _token: string, _call?: CallOptions): Promise<void> {
    throw new ProcessError(UNSUPPORTED_CAPABILITY, "NodeProcessExecutor does not support managed process release");
  }

  async write(_id: string, _input: ProcessWriteInput, _call?: CallOptions): Promise<OperationReceipt> {
    throw new ProcessError(UNSUPPORTED_CAPABILITY, "NodeProcessExecutor does not support managed process write");
  }

  async operation(_id: string, _requestId: string, _call?: CallOptions): Promise<OperationReceipt> {
    throw new ProcessError(UNSUPPORTED_CAPABILITY, "NodeProcessExecutor does not support managed process operation");
  }

  async read(_id: string, _input: ProcessReadInput, _call?: CallOptions): Promise<ReadResult> {
    throw new ProcessError(UNSUPPORTED_CAPABILITY, "NodeProcessExecutor does not support managed process read");
  }

  async control(_id: string, _input: ProcessControlInput, _call?: CallOptions): Promise<OperationReceipt> {
    throw new ProcessError(UNSUPPORTED_CAPABILITY, "NodeProcessExecutor does not support managed process control");
  }

  async stop(_id: string, _input: ProcessStopInput, _call?: CallOptions): Promise<ProcessInfo> {
    throw new ProcessError(UNSUPPORTED_CAPABILITY, "NodeProcessExecutor does not support managed process stop");
  }
}

/**
 * 兼容原有类名导出。
 */
export { NodeProcessExecutor as ExecaProcessExecutor };
