import type { ProcessExecutor } from "@actiondock/core";
import type {
  DetachedProcessOptions,
  DetachedProcessResult,
  ProcessExecOptions,
  ProcessResult,
  RuntimeError,
} from "@actiondock/sdk";

/**
 * 基于 Bun.spawn 实现的外部进程执行器。
 */
export class BunProcessExecutor implements ProcessExecutor {
  async exec(
    command: string,
    args: string[] = [],
    options: ProcessExecOptions = {}
  ): Promise<ProcessResult> {
    const startTime = Date.now();
    const maxOutputBytes = options.maxOutputBytes ?? 10 * 1024 * 1024;

    let stdin: any = "ignore";
    if (typeof options.input === "string") {
      stdin = Buffer.from(options.input);
    } else if (options.input instanceof Uint8Array) {
      stdin = options.input;
    }

    const cmd = [command, ...args];
    const env = options.env ? { ...process.env, ...options.env } : process.env;

    let proc: ReturnType<typeof Bun.spawn>;
    try {
      proc = Bun.spawn(cmd, {
        cwd: options.cwd,
        env,
        stdin,
        stdout: "pipe",
        stderr: "pipe",
      });
    } catch (err: any) {
      const durationMs = Date.now() - startTime;
      const res: ProcessResult = {
        ok: false,
        exitCode: null,
        stdout: "",
        stderr: err?.message || String(err),
        raw: new Uint8Array(),
        timedOut: false,
        cancelled: false,
        durationMs,
        error: {
          code: "PROCESS_SPAWN_ERROR",
          message: err?.message || String(err),
        },
      };
      if (options.throwOnError) {
        throw new Error(err?.message || String(err));
      }
      return res;
    }

    let timedOut = false;
    let cancelled = false;
    let error: RuntimeError | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let forceKillTimer: ReturnType<typeof setTimeout> | undefined;

    let stdoutReader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    let stderrReader: ReadableStreamDefaultReader<Uint8Array> | undefined;

    const cancelStreams = () => {
      try {
        stdoutReader?.cancel();
      } catch {}
      try {
        stderrReader?.cancel();
      } catch {}
    };

    const killProcess = (sig: "SIGTERM" | "SIGKILL") => {
      try {
        proc.kill(sig);
      } catch {}
      cancelStreams();
    };

    if (options.timeoutMs && options.timeoutMs > 0) {
      timer = setTimeout(() => {
        timedOut = true;
        killProcess("SIGTERM");
        forceKillTimer = setTimeout(() => {
          try {
            if (!proc.killed) proc.kill("SIGKILL");
          } catch {}
        }, 1000);
      }, options.timeoutMs);
    }

    const onAbort = () => {
      cancelled = true;
      killProcess("SIGTERM");
      forceKillTimer = setTimeout(() => {
        try {
          if (!proc.killed) proc.kill("SIGKILL");
        } catch {}
      }, 1000);
    };

    if (options.signal) {
      if (options.signal.aborted) {
        onAbort();
      } else {
        options.signal.addEventListener("abort", onAbort, { once: true });
      }
    }

    const stdoutChunks: Uint8Array[] = [];
    const stderrChunks: Uint8Array[] = [];
    let totalBytes = 0;

    async function readStream(
      stream: any,
      chunks: Uint8Array[],
      assignReader: (r: ReadableStreamDefaultReader<Uint8Array>) => void
    ) {
      if (!stream || typeof stream === "number" || typeof stream.getReader !== "function") return;
      const reader = stream.getReader() as ReadableStreamDefaultReader<Uint8Array>;
      assignReader(reader);
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (value && value.length > 0) {
            totalBytes += value.length;
            if (totalBytes > maxOutputBytes && !error) {
              error = {
                code: "PROCESS_OUTPUT_LIMIT",
                message: `Process output exceeded limit of ${maxOutputBytes} bytes`,
              };
              killProcess("SIGKILL");
              break;
            }
            chunks.push(value);
          }
        }
      } catch {
        // 忽略流读取中断异常
      } finally {
        try {
          reader.releaseLock();
        } catch {}
      }
    }

    await Promise.all([
      readStream(proc.stdout as any, stdoutChunks, (r) => {
        stdoutReader = r;
      }),
      readStream(proc.stderr as any, stderrChunks, (r) => {
        stderrReader = r;
      }),
      proc.exited,
    ]);

    if (timer) clearTimeout(timer);
    if (forceKillTimer) clearTimeout(forceKillTimer);
    if (options.signal) {
      options.signal.removeEventListener("abort", onAbort);
    }

    const durationMs = Date.now() - startTime;
    const rawStdout = Buffer.concat(stdoutChunks);
    const rawStderr = Buffer.concat(stderrChunks);
    const encoding = (options.encoding as BufferEncoding) || "utf-8";
    const stdoutStr = rawStdout.toString(encoding).trim();
    const stderrStr = rawStderr.toString(encoding).trim();

    const exitCode = proc.exitCode;
    const signal = (proc.signalCode as string) || undefined;
    const ok = exitCode === 0 && !timedOut && !cancelled && !error;

    const res: ProcessResult = {
      ok,
      exitCode,
      signal,
      stdout: stdoutStr,
      stderr: stderrStr,
      raw: new Uint8Array(rawStdout),
      timedOut,
      cancelled,
      durationMs,
      error,
    };

    if (!ok && options.throwOnError) {
      throw new Error(stderrStr || `Process exited with code ${exitCode}`);
    }
    return res;
  }

  async spawnDetached(
    options: DetachedProcessOptions
  ): Promise<DetachedProcessResult> {
    const startTime = Date.now();
    try {
      const cmd = [options.command, ...(options.args || [])];
      const proc = Bun.spawn(cmd, {
        cwd: options.cwd,
        env: options.env ? { ...process.env, ...options.env } : process.env,
        stdin: "ignore",
        stdout: "ignore",
        stderr: "ignore",
      });

      proc.unref();

      if (!options.probe) {
        return {
          ok: true,
          pid: proc.pid,
          ready: true,
          durationMs: Date.now() - startTime,
        };
      }

      const probeInterval = options.probeIntervalMs ?? 200;
      const probeTimeout = options.probeTimeoutMs ?? options.timeoutMs ?? 5000;
      const deadline = Date.now() + probeTimeout;

      while (Date.now() < deadline) {
        if (options.signal?.aborted) {
          return {
            ok: false,
            pid: proc.pid,
            ready: false,
            durationMs: Date.now() - startTime,
            error: {
              code: "PROCESS_CANCELLED",
              message: "Probe was cancelled by AbortSignal",
            },
          };
        }

        try {
          const checkRes = await this.exec(options.command, ["--version"], {
            timeoutMs: 1000,
          });
          const isReady = await options.probe(checkRes);
          if (isReady) {
            return {
              ok: true,
              pid: proc.pid,
              ready: true,
              durationMs: Date.now() - startTime,
            };
          }
        } catch {
          // 探测失败继续轮询
        }

        await new Promise((r) => setTimeout(r, probeInterval));
      }

      return {
        ok: false,
        pid: proc.pid,
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
