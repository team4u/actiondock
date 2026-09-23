import { format } from "node:util";
import { main } from "../../src/index";

export interface RunCliResult {
  exitCode: number;
  stdout: Buffer;
  stderr: Buffer;
}

class AsyncLock {
  private queue: Promise<void> = Promise.resolve();

  async acquire<T>(fn: () => Promise<T>): Promise<T> {
    let release: () => void;
    const next = new Promise<void>((res) => {
      release = res;
    });
    const current = this.queue;
    this.queue = current.then(() => next);
    await current;
    try {
      return await fn();
    } finally {
      release!();
    }
  }
}

const executionLock = new AsyncLock();

/**
 * 进程内轻量级 CLI 执行辅助函数。
 *
 * 拦截标准输出、标准错误与控制台方法，在当前进程内直接调度 main 函数，
 * 消除子进程频繁冷启动产生的显著系统开销，并保证跨平台与并发安全。
 *
 * @param args 命令行参数数组
 * @param cwd 可选的工作目录
 * @param env 可选的附加环境变量
 * @returns 兼容子进程执行的退出码与输出 Buffer 结构
 */
export async function runCliAsync(
  args: string[],
  cwd?: string,
  env?: Record<string, string | undefined>
): Promise<RunCliResult> {
  return executionLock.acquire(async () => {
    const origCwd = process.cwd();
    const origEnv = { ...process.env };
    const origExitCode = process.exitCode;
    const origStdoutWrite = process.stdout.write.bind(process.stdout);
    const origStderrWrite = process.stderr.write.bind(process.stderr);
    const origConsoleLog = console.log.bind(console);
    const origConsoleError = console.error.bind(console);

    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];

    (process.stdout as any).write = (chunk: any, encoding?: any, cb?: any): boolean => {
      if (typeof encoding === "function") {
        cb = encoding;
        encoding = undefined;
      }
      const buf = Buffer.isBuffer(chunk)
        ? chunk
        : chunk instanceof Uint8Array
          ? Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength)
          : Buffer.from(String(chunk), typeof encoding === "string" ? (encoding as BufferEncoding) : "utf-8");
      stdoutChunks.push(buf);
      if (typeof cb === "function") {
        cb();
      }
      return true;
    };

    (process.stderr as any).write = (chunk: any, encoding?: any, cb?: any): boolean => {
      if (typeof encoding === "function") {
        cb = encoding;
        encoding = undefined;
      }
      const buf = Buffer.isBuffer(chunk)
        ? chunk
        : chunk instanceof Uint8Array
          ? Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength)
          : Buffer.from(String(chunk), typeof encoding === "string" ? (encoding as BufferEncoding) : "utf-8");
      stderrChunks.push(buf);
      if (typeof cb === "function") {
        cb();
      }
      return true;
    };

    console.log = (...items: any[]) => {
      const line = items.length === 0 ? "\n" : format(...items) + "\n";
      stdoutChunks.push(Buffer.from(line, "utf-8"));
    };

    console.error = (...items: any[]) => {
      const line = items.length === 0 ? "\n" : format(...items) + "\n";
      stderrChunks.push(Buffer.from(line, "utf-8"));
    };

    process.exitCode = 0;

    try {
      if (cwd && cwd !== origCwd) {
        process.chdir(cwd);
      }

      if (env) {
        for (const [k, v] of Object.entries(env)) {
          if (v === undefined) {
            delete process.env[k];
          } else {
            process.env[k] = v;
          }
        }
      }

      let exitCode = 0;
      try {
        exitCode = await main(["node", "ad", ...args]);
      } catch (err: any) {
        exitCode = typeof err?.exitCode === "number" ? err.exitCode : 1;
      }

      return {
        exitCode,
        stdout: Buffer.concat(stdoutChunks),
        stderr: Buffer.concat(stderrChunks),
      };
    } finally {
      process.stdout.write = origStdoutWrite;
      process.stderr.write = origStderrWrite;
      console.log = origConsoleLog;
      console.error = origConsoleError;

      for (const key of Object.keys(process.env)) {
        if (!(key in origEnv)) {
          delete process.env[key];
        }
      }
      for (const [key, val] of Object.entries(origEnv)) {
        process.env[key] = val;
      }

      process.exitCode = origExitCode;

      if (process.cwd() !== origCwd) {
        try {
          process.chdir(origCwd);
        } catch {
          // ignore
        }
      }
    }
  });
}
