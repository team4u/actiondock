import childProcess, { type ChildProcess, spawn } from "node:child_process";
import type {
  ProcessExecOptions,
  ProcessResult,
  RuntimeError,
} from "@actiondock/sdk";
import type { ProcessExecutor } from "@actiondock/core";
import { PROCESS_CANCELLED, PROCESS_OUTPUT_LIMIT, PROCESS_SPAWN_ERROR, PROCESS_TIMEOUT } from "@actiondock/core";

/**
 * 跨平台终止进程组，确保不会遗留孤儿进程。
 *
 * - 在 POSIX 环境下通过负数进程标识终止整个进程组
 * - 在 Windows 环境下通过 taskkill 命令终止整个进程树
 *
 * @param pid 目标子进程标识
 * @param signal 发送的系统信号
 * @param spawnFn 进程启动函数，默认为 childProcess.spawn
 */
export function killProcessGroup(
  pid: number,
  signal: "SIGTERM" | "SIGKILL" = "SIGTERM",
  spawnFn: typeof spawn = childProcess.spawn
): void {
  if (process.platform === "win32") {
    // Windows 环境下优先通过 taskkill /T /F 递归终止整棵进程树，防止父进程退出后子孙进程孤儿化
    try {
      const killer = spawnFn("taskkill", ["/pid", String(pid), "/T", "/F"], { stdio: "ignore" });
      killer.on?.("error", () => {
        try {
          process.kill(pid, signal);
        } catch {
          // 忽略已退出状态
        }
      });
    } catch {
      try {
        process.kill(pid, signal);
      } catch {
        // 忽略已退出状态
      }
    }
    try {
      process.kill(pid, signal);
    } catch {
      // 忽略已退出状态
    }
  } else {
    try {
      process.kill(-pid, signal);
    } catch {
      try {
        process.kill(pid, signal);
      } catch {
        // 忽略已退出状态
      }
    }
  }
}

/**
 * 基于 Node.js 原生 child_process 实现的进程执行器。
 */
export class NodeProcessExecutor implements ProcessExecutor {
  private readonly gracePeriodMs: number;
  private readonly spawnFn: typeof spawn;

  constructor(options?: number | { gracePeriodMs?: number; spawnFn?: typeof spawn }) {
    if (typeof options === "number") {
      this.gracePeriodMs = options;
      this.spawnFn = childProcess.spawn;
    } else {
      this.gracePeriodMs = options?.gracePeriodMs ?? 500;
      this.spawnFn = options?.spawnFn ?? childProcess.spawn;
    }
  }

  /**
   * 执行外部系统命令，完整支持标准输入管道、超时控制、取消信号、输出容量截断及错误拦截。
   */
  async exec(
    command: string,
    args: string[] = [],
    options: ProcessExecOptions = {}
  ): Promise<ProcessResult> {
    const startTime = Date.now();
    const maxOutputBytes = options.maxOutputBytes ?? 10 * 1024 * 1024;
    const encoding = (options.encoding as BufferEncoding) || "utf8";

    return new Promise<ProcessResult>((resolve, reject) => {
      let settled = false;
      let timedOut = false;
      let cancelled = false;
      let outputLimitExceeded = false;
      let error: RuntimeError | undefined;

      const stdoutChunks: Buffer[] = [];
      const stderrChunks: Buffer[] = [];
      let totalBytes = 0;

      let child: ChildProcess;
      try {
        child = this.spawnFn(command, args, {
          cwd: options.cwd,
          env: options.env ? { ...process.env, ...options.env } : process.env,
          stdio: ["pipe", "pipe", "pipe"],
          detached: process.platform !== "win32",
        });
      } catch (spawnErr: any) {
        const durationMs = Date.now() - startTime;
        const errObj: RuntimeError = {
          code: PROCESS_SPAWN_ERROR,
          message: spawnErr?.message || "Failed to spawn process",
        };
        if (options.throwOnError) {
          reject(new Error(errObj.message));
        } else {
          resolve({
            ok: false,
            exitCode: null,
            stdout: "",
            stderr: errObj.message,
            raw: new Uint8Array(),
            timedOut: false,
            cancelled: false,
            durationMs,
            error: errObj,
          });
        }
        return;
      }

      const pid = child.pid;
      let timeoutTimer: NodeJS.Timeout | undefined;
      let graceTimer: NodeJS.Timeout | undefined;

      const terminateChild = (sig: "SIGTERM" | "SIGKILL" = "SIGTERM") => {
        if (!pid) return;
        killProcessGroup(pid, sig, this.spawnFn);
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
            killProcessGroup(pid, "SIGKILL", this.spawnFn);
          }, this.gracePeriodMs);
          graceTimer.unref?.();
        }
      };

      /**
       * 清理执行阶段的监听器与执行超时定时器。
       * 注意：不清理 graceTimer，确保进程树兜底清理不受 Promise 完成（close）影响。
       */
      const cleanupExecution = () => {
        if (timeoutTimer) {
          clearTimeout(timeoutTimer);
          timeoutTimer = undefined;
        }
        if (options.signal && abortHandler) {
          options.signal.removeEventListener("abort", abortHandler);
        }
      };

      let abortHandler: (() => void) | undefined;
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

      // 处理标准输入管道流式传入
      if (child.stdin) {
        child.stdin.on("error", () => {
          // 忽略管道提前关闭错误
        });
        if (options.input !== undefined && options.input !== null) {
          if (typeof options.input === "string") {
            child.stdin.write(options.input);
          } else {
            child.stdin.write(Buffer.from(options.input));
          }
        }
        child.stdin.end();
      }

      // 处理标准输出数据与字节截断
      child.stdout?.on("data", (chunk: Buffer) => {
        if (outputLimitExceeded) return;
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
        stdoutChunks.push(chunk);
      });

      // 处理标准错误数据与字节截断
      child.stderr?.on("data", (chunk: Buffer) => {
        if (outputLimitExceeded) return;
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
        stderrChunks.push(chunk);
      });

      // 处理启动失败异常
      child.on("error", (err: Error) => {
        if (settled) return;
        settled = true;
        cleanupExecution();

        const durationMs = Date.now() - startTime;
        const spawnError: RuntimeError = error || {
          code: PROCESS_SPAWN_ERROR,
          message: err.message || "Failed to spawn process",
        };

        const stdoutBuf = Buffer.concat(stdoutChunks);
        const stderrBuf = Buffer.concat(stderrChunks);
        const stdoutStr = stdoutBuf.toString(encoding);
        const stderrStr = stderrBuf.toString(encoding);

        const res: ProcessResult = {
          ok: false,
          exitCode: null,
          signal: undefined,
          stdout: stdoutStr.trim(),
          stderr: stderrStr.trim() || spawnError.message,
          raw: new Uint8Array(stdoutBuf),
          timedOut,
          cancelled,
          durationMs,
          error: spawnError,
        };

        if (options.throwOnError) {
          reject(new Error(spawnError.message));
        } else {
          resolve(res);
        }
      });

      // 处理子进程关闭退出
      child.on("close", (exitCode, exitSignal) => {
        if (settled) return;
        settled = true;
        cleanupExecution();

        const durationMs = Date.now() - startTime;
        const stdoutBuf = Buffer.concat(stdoutChunks);
        const stderrBuf = Buffer.concat(stderrChunks);
        const stdoutStr = stdoutBuf.toString(encoding);
        const stderrStr = stderrBuf.toString(encoding);
        const signal = exitSignal || undefined;

        const ok = exitCode === 0 && !timedOut && !cancelled && !error;

        const res: ProcessResult = {
          ok,
          exitCode,
          signal,
          stdout: stdoutStr.trim(),
          stderr: stderrStr.trim(),
          raw: new Uint8Array(stdoutBuf),
          timedOut,
          cancelled,
          durationMs,
          error,
        };

        if (!ok && options.throwOnError) {
          const errMsg =
            error?.message || stderrStr.trim() || `Process exited with code ${exitCode}`;
          reject(new Error(errMsg));
        } else {
          resolve(res);
        }
      });
    });
  }

  async spawn(
    command: string,
    args: string[] = [],
    options: ProcessExecOptions = {}
  ): Promise<ProcessResult> {
    return this.exec(command, args, options);
  }
}

/**
 * 兼容原有类名导出。
 */
export { NodeProcessExecutor as ExecaProcessExecutor };
