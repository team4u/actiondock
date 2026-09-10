import { spawn } from "node:child_process";
import type {
  DetachedProcessOptions,
  DetachedProcessResult,
  ProcessAPI,
  ProcessExecOptions,
  ProcessResult,
  RuntimeError,
} from "@actiondock/sdk";

export type ProcessExecutor = ProcessAPI;


/**
 * 基于 Node.js 标准 child_process 实现的基础进程执行器。
 */
export class DefaultProcessExecutor implements ProcessExecutor {
  async exec(
    command: string,
    args: string[] = [],
    options: ProcessExecOptions = {}
  ): Promise<ProcessResult> {
    const startTime = Date.now();
    const maxOutputBytes = options.maxOutputBytes ?? 10 * 1024 * 1024;

    return new Promise<ProcessResult>((resolve, reject) => {
      let stdoutBuf = "";
      let stderrBuf = "";
      let totalBytes = 0;
      let timedOut = false;
      let cancelled = false;
      let error: RuntimeError | undefined;

      const cp = spawn(command, args, {
        cwd: options.cwd,
        env: options.env ? { ...process.env, ...options.env } : process.env,
        stdio: ["pipe", "pipe", "pipe"],
      });

      if (options.input) {
        cp.stdin.write(options.input);
        cp.stdin.end();
      } else {
        cp.stdin.end();
      }

      let timer: ReturnType<typeof setTimeout> | undefined;
      if (options.timeoutMs && options.timeoutMs > 0) {
        timer = setTimeout(() => {
          timedOut = true;
          cp.kill("SIGTERM");
          setTimeout(() => {
            if (!cp.killed) cp.kill("SIGKILL");
          }, 1000);
        }, options.timeoutMs);
      }

      const onAbort = () => {
        cancelled = true;
        cp.kill("SIGTERM");
        setTimeout(() => {
          if (!cp.killed) cp.kill("SIGKILL");
        }, 1000);
      };

      if (options.signal) {
        if (options.signal.aborted) {
          onAbort();
        } else {
          options.signal.addEventListener("abort", onAbort, { once: true });
        }
      }

      cp.stdout?.on("data", (chunk: Buffer) => {
        totalBytes += chunk.length;
        if (totalBytes > maxOutputBytes) {
          error = {
            code: "PROCESS_OUTPUT_LIMIT",
            message: `Process output exceeded limit of ${maxOutputBytes} bytes`,
          };
          cp.kill("SIGKILL");
          return;
        }
        stdoutBuf += chunk.toString("utf-8");
      });

      cp.stderr?.on("data", (chunk: Buffer) => {
        totalBytes += chunk.length;
        if (totalBytes > maxOutputBytes) {
          error = {
            code: "PROCESS_OUTPUT_LIMIT",
            message: `Process output exceeded limit of ${maxOutputBytes} bytes`,
          };
          cp.kill("SIGKILL");
          return;
        }
        stderrBuf += chunk.toString("utf-8");
      });

      cp.on("error", (err) => {
        if (timer) clearTimeout(timer);
        const durationMs = Date.now() - startTime;
        const res: ProcessResult = {
          ok: false,
          exitCode: null,
          stdout: stdoutBuf.trim(),
          stderr: stderrBuf.trim() || err.message,
          raw: new TextEncoder().encode(stdoutBuf),
          timedOut,
          cancelled,
          durationMs,
          error: error || {
            code: "PROCESS_SPAWN_ERROR",
            message: err.message,
          },
        };
        if (options.throwOnError) {
          reject(new Error(err.message));
        } else {
          resolve(res);
        }
      });

      cp.on("close", (exitCode, signal) => {
        if (timer) clearTimeout(timer);
        const durationMs = Date.now() - startTime;
        const ok = exitCode === 0 && !timedOut && !cancelled && !error;

        const res: ProcessResult = {
          ok,
          exitCode,
          signal: signal || undefined,
          stdout: stdoutBuf.trim(),
          stderr: stderrBuf.trim(),
          raw: new TextEncoder().encode(stdoutBuf),
          timedOut,
          cancelled,
          durationMs,
          error,
        };

        if (!ok && options.throwOnError) {
          reject(new Error(stderrBuf.trim() || `Process exited with code ${exitCode}`));
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
      const probeTimeout = options.probeTimeoutMs ?? 5000;
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
          // 探测失败继续轮询
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
          message: err.message,
        },
      };
    }
  }
}
