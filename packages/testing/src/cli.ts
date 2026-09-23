import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { delimiter, join } from "node:path";

/**
 * 跨运行时查找可执行文件绝对物理路径。
 */
export function findExecutable(command: string): string | null {
  if (typeof (globalThis as any).Bun !== "undefined" && typeof (globalThis as any).Bun.which === "function") {
    try {
      const bPath = (globalThis as any).Bun.which(command);
      if (bPath) return bPath;
    } catch {
      // ignore
    }
  }

  const hasPathSep = command.includes("/") || command.includes("\\");
  if (hasPathSep) {
    return existsSync(command) ? command : null;
  }

  const pathEnv = process.env.PATH || "";
  const dirs = pathEnv.split(delimiter);
  const isWindows = process.platform === "win32";
  const pathext = isWindows
    ? (process.env.PATHEXT || ".COM;.EXE;.BAT;.CMD").split(";")
    : [""];

  for (const dir of dirs) {
    if (!dir) continue;
    for (const ext of pathext) {
      const candidate = join(dir, isWindows && !command.includes(".") ? command + ext : command);
      if (existsSync(candidate)) {
        return candidate;
      }
    }
  }

  return null;
}

/**
 * CLI 执行选项配置。
 */
export interface ExecCliOptions {
  cwd?: string;
  env?: Record<string, string>;
  signal?: AbortSignal;
  timeout?: number;
  input?: string | Uint8Array;
  encoding?: string;
  throwOnError?: boolean;
  /** 输出字节总量上限，超出后终止进程并标记 truncated（与 runtime-node 执行器语义对齐） */
  maxOutputBytes?: number;
}

/**
 * CLI 执行结果结构体。
 */
export interface ExecCliResult {
  ok: boolean;
  exitCode: number;
  stdout: string;
  stderr: string;
  raw: Uint8Array;
  timedOut?: boolean;
  /** 输出超过 maxOutputBytes 上限被截断时置为 true */
  truncated?: boolean;
  durationMs: number;
}

/**
 * 终止宽限升级时限：SIGTERM 后未退出则升级 SIGKILL，与 runtime-node 执行器默认宽限期对齐。
 */
const KILL_GRACE_MS = 500;

/**
 * 执行外部 CLI 命令并收集输出。
 * 基于异步 spawn 与 Promise 化封装（与 runtime-node 执行器风格对齐），保留既有的输出收集与退出码语义。
 *
 * 与真实执行器的语义对齐点：
 * - 进程以独立进程组派生（POSIX），终止时对整组发信号，不遗留子孙进程；
 * - AbortSignal 全程生效：启动前、运行中 abort 均会终止进程组；
 * - 超时与终止路径均为 SIGTERM 后宽限期升级 SIGKILL 的两级策略。
 *
 * @param command 执行命令
 * @param args 参数列表
 * @param options 执行选项
 */
export async function execCli(
  command: string,
  args: string[] = [],
  options: ExecCliOptions = {}
): Promise<ExecCliResult> {
  const startTime = performance.now();
  const maxOutputBytes = options.maxOutputBytes ?? Infinity;

  if (options.signal?.aborted) {
    const errRes: ExecCliResult = {
      ok: false,
      exitCode: -1,
      stdout: "",
      stderr: "Command aborted before execution by signal",
      raw: new Uint8Array(0),
      durationMs: 0,
    };
    if (options.throwOnError) {
      throw new Error(errRes.stderr);
    }
    return errRes;
  }

  const hasPathSep = command.includes("/") || command.includes("\\");
  const binPath = hasPathSep ? (existsSync(command) ? command : null) : findExecutable(command);

  if (!binPath) {
    const errRes: ExecCliResult = {
      ok: false,
      exitCode: -1,
      stdout: "",
      stderr: `Command '${command}' not found in PATH.`,
      raw: new Uint8Array(0),
      durationMs: Math.round(performance.now() - startTime),
    };
    if (options.throwOnError) {
      throw new Error(errRes.stderr);
    }
    return errRes;
  }

  let stdinInput: Buffer | undefined;
  if (options.input !== undefined) {
    if (typeof options.input === "string") {
      stdinInput = Buffer.from(options.input);
    } else if (options.input instanceof Uint8Array) {
      stdinInput = Buffer.from(options.input);
    }
  }

  return new Promise<ExecCliResult>((resolve, reject) => {
    let child;
    try {
      child = spawn(binPath, args, {
        cwd: options.cwd || process.cwd(),
        env: options.env ? { ...process.env, ...options.env } : process.env,
        stdio: [stdinInput ? "pipe" : "ignore", "pipe", "pipe"],
        detached: process.platform !== "win32",
      });
    } catch (err: any) {
      const errRes: ExecCliResult = {
        ok: false,
        exitCode: -1,
        stdout: "",
        stderr: err?.message || String(err),
        raw: new Uint8Array(0),
        durationMs: Math.round(performance.now() - startTime),
      };
      if (options.throwOnError) {
        reject(err);
        return;
      }
      resolve(errRes);
      return;
    }

    let settled = false;
    let timedOut = false;
    let truncated = false;
    let terminatedByAbort = false;
    let spawnError: Error | undefined;
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let totalOutputBytes = 0;

    // POSIX 下对整组发负数 pid；Windows 回退单 pid。失败时静默（已退出或权限
    // 变更属终止路径常态，由 SIGKILL 升级与 close 事件兜底）
    const killChild = (signal: "SIGTERM" | "SIGKILL") => {
      const pid = child.pid;
      if (!pid) return;
      if (process.platform !== "win32") {
        try {
          process.kill(-pid, signal);
          return;
        } catch {
          // 进程组已消失时回退单 pid 再尝试
        }
      }
      try {
        process.kill(pid, signal);
      } catch {
        // 忽略已退出状态
      }
    };

    // 两级终止：SIGTERM 后宽限期内未退出升级 SIGKILL，与 runtime-node 执行器对齐
    let killUpgradeTimer: NodeJS.Timeout | undefined;
    const terminateChild = () => {
      if (killUpgradeTimer) return;
      killChild("SIGTERM");
      killUpgradeTimer = setTimeout(() => {
        killUpgradeTimer = undefined;
        killChild("SIGKILL");
      }, KILL_GRACE_MS);
      killUpgradeTimer.unref?.();
    };

    // 输出超限时终止进程：由 enforceOutputLimit 负责截断与标记
    const terminateForLimit = () => {
      terminateChild();
    };

    let timeoutTimer: NodeJS.Timeout | undefined;
    if (options.timeout && options.timeout > 0) {
      timeoutTimer = setTimeout(() => {
        timedOut = true;
        terminateChild();
      }, options.timeout);
    }

    // AbortSignal 全程生效：运行中 abort 即终止进程组（不再仅启动前检查）
    let abortListener: (() => void) | undefined;
    if (options.signal) {
      abortListener = () => {
        if (settled) return;
        terminatedByAbort = true;
        terminateChild();
      };
      if (options.signal.aborted) {
        abortListener();
      } else {
        options.signal.addEventListener("abort", abortListener, { once: true });
      }
    }

    const cleanup = () => {
      if (timeoutTimer) clearTimeout(timeoutTimer);
      if (killUpgradeTimer) clearTimeout(killUpgradeTimer);
      if (options.signal && abortListener) {
        options.signal.removeEventListener("abort", abortListener);
      }
    };

    const finalize = (exitCodeFromClose: number | null) => {
      if (settled) return;
      settled = true;
      cleanup();

      const durationMs = Math.round(performance.now() - startTime);
      const decoder = new TextDecoder(options.encoding || "utf-8");
      const rawStdout = stdoutChunks.length > 0 ? new Uint8Array(Buffer.concat(stdoutChunks)) : new Uint8Array(0);
      const rawStderr = stderrChunks.length > 0 ? new Uint8Array(Buffer.concat(stderrChunks)) : new Uint8Array(0);

      const stdout = rawStdout.length > 0 ? decoder.decode(rawStdout).trim() : "";
      let stderr = rawStderr.length > 0 ? decoder.decode(rawStderr).trim() : "";

      if (truncated && !stderr) {
        stderr = `Command '${command}' output exceeded limit of ${maxOutputBytes} bytes`;
      }

      if (timedOut && !stderr) {
        stderr = `Command '${command}' timed out after ${options.timeout}ms`;
      }
      if (terminatedByAbort && !stderr) {
        stderr = `Command '${command}' was aborted by signal`;
      }

      const exitCode = timedOut || terminatedByAbort ? -1 : (exitCodeFromClose ?? (spawnError ? -1 : 0));
      const ok = !timedOut && !terminatedByAbort && !truncated && exitCode === 0;

      const result: ExecCliResult = {
        ok,
        exitCode,
        stdout,
        stderr,
        raw: rawStdout,
        timedOut: timedOut || undefined,
        truncated: truncated || undefined,
        durationMs,
      };

      if (options.throwOnError && !ok) {
        reject(new Error(stderr || `Command '${command}' failed with exit code ${exitCode}`));
        return;
      }
      resolve(result);
    };

    // 输出超限时截断已收集字节并终止进程：与 runtime-node 执行器对齐，
    // 只保留上限内的字节（含同 chunk 内截断），丢弃超限部分
    const enforceOutputLimit = (
      chunks: Buffer[],
      chunk: Buffer
    ): boolean => {
      const remaining = maxOutputBytes - totalOutputBytes;
      if (remaining < chunk.length) {
        if (remaining > 0) {
          chunks.push(chunk.subarray(0, remaining));
          totalOutputBytes += remaining;
        } else {
          totalOutputBytes += chunk.length;
        }
        truncated = true;
        terminateForLimit();
        return true;
      }
      totalOutputBytes += chunk.length;
      chunks.push(chunk);
      return false;
    };

    child.stdout?.on("data", (chunk: Buffer) => {
      if (truncated) return;
      enforceOutputLimit(stdoutChunks, chunk);
    });

    child.stderr?.on("data", (chunk: Buffer) => {
      if (truncated) return;
      enforceOutputLimit(stderrChunks, chunk);
    });

    child.on("error", (err: Error) => {
      spawnError = err;
      finalize(child.exitCode);
    });

    child.on("close", (code: number | null) => {
      finalize(code);
    });

    if (stdinInput && child.stdin) {
      child.stdin.on("error", () => {
        // 目标进程提前退出时忽略管道写入错误
      });
      child.stdin.end(stdinInput);
    }
  });
}
