import { existsSync } from "node:fs";
import { findExecutable, NodeProcessExecutor } from "@actiondock/core/package";
import type { ProcessResult } from "@actiondock/sdk";

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
 * 共享真实进程执行器。
 *
 * 进程组派生、两级终止（SIGTERM 后约 500ms 宽限升级 SIGKILL）、AbortSignal
 * 全程生效与输出上限截断等关键语义统一由 core 执行器承担，此处仅持有共享实例。
 */
const realExecutor = new NodeProcessExecutor();

/**
 * 将 core 执行结果转换为 CLI 结果信封。
 *
 * 仅收敛两类确有差异的部分：
 * - exitCode 哨兵：中止、超时与派生失败无真实退出码（null），CLI 信封以 -1 表达；
 * - stderr 兜底文案：输出超限、超时与中止时若命令自身未输出错误，补充 CLI 风格说明。
 */
function toCliResult(command: string, res: ProcessResult, options: ExecCliOptions): ExecCliResult {
  const truncated = res.error?.code === "PROCESS_OUTPUT_LIMIT";
  let stderr = res.stderr;
  if (!stderr && truncated) {
    stderr = `Command '${command}' output exceeded limit of ${options.maxOutputBytes} bytes`;
  }
  if (!stderr && res.timedOut) {
    stderr = `Command '${command}' timed out after ${options.timeout}ms`;
  }
  if (!stderr && res.cancelled) {
    stderr = `Command '${command}' was aborted by signal`;
  }
  return {
    ok: res.ok,
    exitCode: res.exitCode ?? -1,
    stdout: res.stdout,
    stderr,
    raw: res.raw,
    timedOut: res.timedOut || undefined,
    truncated: truncated || undefined,
    durationMs: res.durationMs,
  };
}

/**
 * 执行外部 CLI 命令并收集输出。
 *
 * 本函数是 core NodeProcessExecutor 之上的薄封装，仅保留 CLI 信封特有的部分：
 * 命令 PATH 预解析（未命中时返回固定错误信封）、全量宿主环境继承，以及超时、
 * 中止、输出超限时的 stderr 兜底文案与 exitCode 哨兵转换。
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

  let res: ProcessResult;
  try {
    res = await realExecutor.exec(
      binPath,
      args,
      {
        cwd: options.cwd,
        // 全量继承宿主环境并叠加调用方覆盖：保留既有宽 env 合并语义，
        // 不套用受管进程路径的 allowlisted 白名单继承策略，
        // 故标记 env 已完整解析交由 core 直接使用
        env: { ...process.env, ...(options.env ?? {}) } as Record<string, string>,
        input: options.input,
        timeoutMs: options.timeout,
        signal: options.signal,
        encoding: options.encoding,
        // 未显式指定时不设上限：与既有默认语义一致，规避 core 的 10MB 默认上限
        maxOutputBytes: options.maxOutputBytes ?? Infinity,
      },
      { envAlreadyResolved: true }
    );
  } catch (err: any) {
    // 防御兜底：core 执行器内部已将派生与运行故障收敛为结果信封，此路径仅拦截意外异常
    res = {
      ok: false,
      exitCode: null,
      signal: undefined,
      stdout: "",
      stderr: err?.message || String(err),
      raw: new Uint8Array(0),
      timedOut: false,
      cancelled: false,
      durationMs: Math.round(performance.now() - startTime),
    };
  }

  const result = toCliResult(command, res, options);
  if (options.throwOnError && !result.ok) {
    throw new Error(result.stderr || `Command '${command}' failed with exit code ${result.exitCode}`);
  }
  return result;
}
