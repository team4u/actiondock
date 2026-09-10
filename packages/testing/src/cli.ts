import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { findExecutable } from "@actiondock/core";

export { findExecutable };

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
  durationMs: number;
}

export function execCli(
  command: string,
  args: string[] = [],
  options: ExecCliOptions = {}
): ExecCliResult {
  const startTime = performance.now();

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

  try {
    const proc = spawnSync(binPath, args, {
      cwd: options.cwd || process.cwd(),
      env: options.env ? { ...process.env, ...options.env } : process.env,
      input: stdinInput,
      stdio: [stdinInput ? "pipe" : "ignore", "pipe", "pipe"],
      timeout: options.timeout,
    });

    const durationMs = Math.round(performance.now() - startTime);
    const timedOut = Boolean(proc.error && (proc.error as any).code === "ETIMEDOUT");

    const decoder = new TextDecoder(options.encoding || "utf-8");
    const rawStdout = proc.stdout ? new Uint8Array(proc.stdout) : new Uint8Array(0);
    const rawStderr = proc.stderr ? new Uint8Array(proc.stderr) : new Uint8Array(0);

    const stdout = rawStdout.length > 0 ? decoder.decode(rawStdout).trim() : "";
    let stderr = rawStderr.length > 0 ? decoder.decode(rawStderr).trim() : "";

    if (timedOut && !stderr) {
      stderr = `Command '${command}' timed out after ${options.timeout}ms`;
    }

    const exitCode = timedOut ? -1 : (proc.status ?? (proc.error ? -1 : 0));
    const ok = !timedOut && exitCode === 0;

    const result: ExecCliResult = {
      ok,
      exitCode,
      stdout,
      stderr,
      raw: rawStdout,
      timedOut: timedOut || undefined,
      durationMs,
    };

    if (options.throwOnError && !ok) {
      throw new Error(stderr || `Command '${command}' failed with exit code ${exitCode}`);
    }

    return result;
  } catch (err: any) {
    const durationMs = Math.round(performance.now() - startTime);
    const errRes: ExecCliResult = {
      ok: false,
      exitCode: -1,
      stdout: "",
      stderr: err?.message || String(err),
      raw: new Uint8Array(0),
      durationMs,
    };
    if (options.throwOnError) {
      throw err;
    }
    return errRes;
  }
}

