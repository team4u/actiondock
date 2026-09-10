import { type ChildProcess, spawn } from "node:child_process";
import type {
  DetachedProcessOptions,
  DetachedProcessResult,
  ProcessExecOptions,
  ProcessResult,
  RuntimeError,
} from "@actiondock/sdk";
import type { ProcessExecutor } from "@actiondock/core";

/**
 * 跨平台终止进程组，确保不会遗留孤儿进程。
 *
 * - 在 POSIX 环境下通过负数进程标识终止整个进程组
 * - 在 Windows 环境下通过 taskkill 命令终止整个进程树
 *
 * @param pid 目标子进程标识
 * @param signal 发送的系统信号
 */
function killProcessGroup(pid: number, signal: "SIGTERM" | "SIGKILL"): void {
  if (process.platform === "win32") {
    if (signal === "SIGKILL") {
      try {
        spawn("taskkill", ["/pid", String(pid), "/T", "/F"], { stdio: "ignore" });
      } catch {
        // 忽略进程树终止异常
      }
    } else {
      try {
        process.kill(pid, signal);
      } catch {
        // 忽略已退出状态
      }
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
        child = spawn(command, args, {
          cwd: options.cwd,
          env: options.env ? { ...process.env, ...options.env } : process.env,
          stdio: ["pipe", "pipe", "pipe"],
          detached: process.platform !== "win32",
        });
      } catch (spawnErr: any) {
        const durationMs = Date.now() - startTime;
        const errObj: RuntimeError = {
          code: "PROCESS_SPAWN_ERROR",
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
        killProcessGroup(pid, sig);
        if (sig === "SIGTERM" && !graceTimer) {
          graceTimer = setTimeout(() => {
            if (!settled) {
              killProcessGroup(pid, "SIGKILL");
            }
          }, 500);
        }
      };

      const cleanup = () => {
        if (timeoutTimer) {
          clearTimeout(timeoutTimer);
          timeoutTimer = undefined;
        }
        if (graceTimer) {
          clearTimeout(graceTimer);
          graceTimer = undefined;
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
              code: "PROCESS_CANCELLED",
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
              code: "PROCESS_TIMEOUT",
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
              code: "PROCESS_OUTPUT_LIMIT",
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
              code: "PROCESS_OUTPUT_LIMIT",
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
        cleanup();

        const durationMs = Date.now() - startTime;
        const spawnError: RuntimeError = error || {
          code: "PROCESS_SPAWN_ERROR",
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
        cleanup();

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

  /**
   * 启动脱离当前会话的后台守护进程，并基于探测器函数进行就绪轮询与超时管理。
   */
  async spawnDetached(options: DetachedProcessOptions): Promise<DetachedProcessResult> {
    const startTime = Date.now();
    try {
      const child = spawn(options.command, options.args || [], {
        cwd: options.cwd,
        env: options.env ? { ...process.env, ...options.env } : process.env,
        detached: true,
        stdio: "ignore",
      });

      child.unref();

      if (!options.probe) {
        return {
          ok: true,
          pid: child.pid,
          ready: true,
          durationMs: Date.now() - startTime,
        };
      }

      const probeInterval = options.probeIntervalMs ?? 200;
      const probeTimeout = options.probeTimeoutMs ?? (options.timeoutMs ?? 5000);
      const deadline = Date.now() + probeTimeout;

      while (Date.now() < deadline) {
        if (options.signal?.aborted) {
          return {
            ok: false,
            pid: child.pid,
            ready: false,
            durationMs: Date.now() - startTime,
            error: {
              code: "PROCESS_CANCELLED",
              message: "Probe was cancelled by AbortSignal",
            },
          };
        }

        try {
          const res: DetachedProcessResult = {
            ok: true,
            pid: child.pid,
            ready: true,
            durationMs: Date.now() - startTime,
          };
          const isReady = await options.probe(res as any);
          if (isReady) {
            return res;
          }
        } catch {
          // 探测阶段出现异常继续等待下一次轮询
        }

        const remaining = deadline - Date.now();
        if (remaining <= 0) break;
        const sleepTime = Math.min(probeInterval, remaining);
        await new Promise((r) => setTimeout(r, sleepTime));
      }

      return {
        ok: false,
        pid: child.pid,
        ready: false,
        durationMs: Date.now() - startTime,
        error: {
          code: "PROCESS_PROBE_TIMEOUT",
          message: `Process probe timed out after ${probeTimeout}ms`,
        },
      };
    } catch (err: any) {
      return {
        ok: false,
        ready: false,
        durationMs: Date.now() - startTime,
        error: {
          code: "PROCESS_DETACHED_FAILED",
          message: err?.message || String(err),
        },
      };
    }
  }
}

/**
 * 兼容原有类名导出。
 */
export { NodeProcessExecutor as ExecaProcessExecutor };
