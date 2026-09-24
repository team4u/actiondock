import { Readable } from "node:stream";
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
  env?: Record<string, string | undefined> | string | Buffer | NodeJS.ReadableStream,
  stdinInput?: string | Buffer | NodeJS.ReadableStream
): Promise<RunCliResult> {
  let effectiveEnv: Record<string, string | undefined> | undefined;
  let effectiveStdin: string | Buffer | NodeJS.ReadableStream | undefined;

  if (typeof env === "string" || Buffer.isBuffer(env) || (env && typeof (env as any).pipe === "function")) {
    effectiveStdin = env as string | Buffer | NodeJS.ReadableStream;
    effectiveEnv = undefined;
  } else {
    effectiveEnv = env as Record<string, string | undefined> | undefined;
    effectiveStdin = stdinInput;
  }

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
      // Node.js 原生 test runner 使用 v8.serialize (0xFF 起始字节) 与父进程通信，
      // 此类二进制 IPC 包必须直接穿透至原始 stdout，不能被截获进入 CLI 业务输出。
      if (chunk && (chunk[0] === 0xff || ((chunk instanceof Uint8Array || Buffer.isBuffer(chunk)) && chunk[0] === 0xff))) {
        return origStdoutWrite(chunk, encoding, cb);
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
      if (chunk && (chunk[0] === 0xff || ((chunk instanceof Uint8Array || Buffer.isBuffer(chunk)) && chunk[0] === 0xff))) {
        return origStderrWrite(chunk, encoding, cb);
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

      if (effectiveEnv) {
        for (const [k, v] of Object.entries(effectiveEnv)) {
          if (v === undefined) {
            delete process.env[k];
          } else {
            process.env[k] = v;
          }
        }
      }

      let stdinStream: NodeJS.ReadableStream | undefined;
      if (effectiveStdin !== undefined) {
        if (typeof effectiveStdin === "string" || Buffer.isBuffer(effectiveStdin)) {
          stdinStream = Readable.from([effectiveStdin]);
        } else {
          stdinStream = effectiveStdin;
        }
      }

      let exitCode = 0;
      try {
        exitCode = await main(["node", "ad", ...args], undefined, { stdin: stdinStream });
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
