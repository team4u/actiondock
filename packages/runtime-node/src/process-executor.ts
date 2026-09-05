import { execa } from "execa";
import type {
  DetachedProcessOptions,
  DetachedProcessResult,
  ProcessExecOptions,
  ProcessResult,
  RuntimeError,
} from "@actiondock/sdk";
import type { ProcessExecutor } from "@actiondock/core";

/**
 * 基于 execa 实现的 Node.js 进程执行器。
 */
export class ExecaProcessExecutor implements ProcessExecutor {
  /**
   * 执行外部系统命令，支持输入管道、超时控制、取消信号、输出容量截断及错误拦截。
   */
  async exec(
    command: string,
    args: string[] = [],
    options: ProcessExecOptions = {}
  ): Promise<ProcessResult> {
    const startTime = Date.now();
    const maxOutputBytes = options.maxOutputBytes ?? 10 * 1024 * 1024;

    let rawResult: any;
    try {
      rawResult = await execa(command, args, {
        cwd: options.cwd,
        env: options.env ? { ...process.env, ...options.env } : process.env,
        input: options.input,
        timeout: options.timeoutMs && options.timeoutMs > 0 ? options.timeoutMs : undefined,
        cancelSignal: options.signal,
        encoding: (options.encoding as any) ?? "utf8",
        maxBuffer: maxOutputBytes,
        reject: false,
      });
    } catch (err: any) {
      rawResult = err;
    }

    const durationMs = Date.now() - startTime;
    const isMaxBuffer = Boolean(rawResult.isMaxBuffer);
    const timedOut = Boolean(rawResult.timedOut);
    const cancelled = Boolean(
      rawResult.isCanceled || (options.signal && options.signal.aborted)
    );

    let exitCode: number | null = null;
    if (typeof rawResult.exitCode === "number") {
      exitCode = rawResult.exitCode;
    }

    let signal: string | undefined = undefined;
    if (typeof rawResult.signal === "string" && rawResult.signal) {
      signal = rawResult.signal;
    }

    const stdoutStr =
      typeof rawResult.stdout === "string"
        ? rawResult.stdout
        : rawResult.stdout instanceof Uint8Array || Buffer.isBuffer(rawResult.stdout)
          ? Buffer.from(rawResult.stdout).toString("utf-8")
          : "";

    const stderrStr =
      typeof rawResult.stderr === "string"
        ? rawResult.stderr
        : rawResult.stderr instanceof Uint8Array || Buffer.isBuffer(rawResult.stderr)
          ? Buffer.from(rawResult.stderr).toString("utf-8")
          : "";

    const rawBytes =
      rawResult.stdout instanceof Uint8Array
        ? new Uint8Array(rawResult.stdout)
        : new TextEncoder().encode(stdoutStr);

    let error: RuntimeError | undefined;
    if (isMaxBuffer) {
      error = {
        code: "PROCESS_OUTPUT_LIMIT",
        message: `Process output exceeded limit of ${maxOutputBytes} bytes`,
      };
    } else if (cancelled) {
      error = {
        code: "PROCESS_CANCELLED",
        message: "Process was cancelled by AbortSignal",
      };
    } else if (timedOut) {
      error = {
        code: "PROCESS_TIMEOUT",
        message: `Process timed out after ${options.timeoutMs}ms`,
      };
    } else if (rawResult.failed && exitCode === null) {
      error = {
        code: "PROCESS_SPAWN_ERROR",
        message: rawResult.shortMessage || rawResult.message || "Failed to spawn process",
      };
    }

    const ok = exitCode === 0 && !timedOut && !cancelled && !error;

    const result: ProcessResult = {
      ok,
      exitCode,
      signal,
      stdout: stdoutStr.trim(),
      stderr: stderrStr.trim(),
      raw: rawBytes,
      timedOut,
      cancelled,
      durationMs,
      error,
    };

    if (!ok && options.throwOnError) {
      const errMsg =
        error?.message || stderrStr.trim() || `Process exited with code ${exitCode}`;
      throw new Error(errMsg);
    }

    return result;
  }

  /**
   * 启动脱离当前会话的后台守护进程，并基于探测器函数进行就绪轮询与超时管理。
   */
  async spawnDetached(options: DetachedProcessOptions): Promise<DetachedProcessResult> {
    const startTime = Date.now();
    try {
      const child = execa(options.command, options.args || [], {
        cwd: options.cwd,
        env: options.env ? { ...process.env, ...options.env } : process.env,
        detached: true,
        stdio: "ignore",
        cleanup: false,
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
          let checkRes: ProcessResult;
          try {
            checkRes = await this.exec(options.command, ["--version"], {
              timeoutMs: 1000,
            });
          } catch (execErr: any) {
            checkRes = {
              ok: false,
              exitCode: null,
              stdout: "",
              stderr: execErr?.message || String(execErr),
              raw: new Uint8Array(),
              timedOut: false,
              cancelled: false,
              durationMs: 0,
              error: {
                code: "PROBE_EXEC_ERROR",
                message: execErr?.message || String(execErr),
              },
            };
          }

          const isReady = await options.probe(checkRes);
          if (isReady) {
            return {
              ok: true,
              pid: child.pid,
              ready: true,
              durationMs: Date.now() - startTime,
            };
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
