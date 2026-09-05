import type { ProcessExecutor } from "@actiondock/core";
import type {
  DetachedProcessOptions,
  DetachedProcessResult,
  ProcessExecOptions,
  ProcessResult,
  RuntimeError,
} from "@actiondock/sdk";

/**
 * 模拟命令匹配器。
 */
export type CommandMatcher =
  | string
  | RegExp
  | ((command: string, args: string[], options: ProcessExecOptions) => boolean);

/**
 * 模拟进程执行结果选项。
 */
export interface MockProcessResultOptions {
  /** 命令是否执行成功 */
  ok?: boolean;
  /** 退出状态码 */
  exitCode?: number | null;
  /** 终止信号名称 */
  signal?: string;
  /** 标准输出内容 */
  stdout?: string;
  /** 标准错误内容 */
  stderr?: string;
  /** 原始字节数组输出 */
  raw?: Uint8Array;
  /** 是否标记为超时 */
  timedOut?: boolean;
  /** 是否标记为已取消 */
  cancelled?: boolean;
  /** 执行耗时毫秒数 */
  durationMs?: number;
  /** 运行时结构化错误 */
  error?: RuntimeError;
  /** 模拟执行延迟毫秒数 */
  delayMs?: number;
}

/**
 * 模拟进程处理器函数。
 */
export type MockProcessHandler = (
  command: string,
  args: string[],
  options: ProcessExecOptions
) =>
  | MockProcessResultOptions
  | ProcessResult
  | Promise<MockProcessResultOptions | ProcessResult>;

/**
 * 已记录的命令调用历史条目。
 */
export interface ProcessCall {
  /** 执行命令名称 */
  command: string;
  /** 执行参数列表 */
  args: string[];
  /** 执行选项配置 */
  options: ProcessExecOptions;
  /** 调用发生时的时间戳 */
  timestamp: number;
}

/**
 * 已记录的后台守护进程调用历史条目。
 */
export interface DetachedProcessCall {
  /** 启动参数选项 */
  options: DetachedProcessOptions;
  /** 调用发生时的时间戳 */
  timestamp: number;
}

interface RegisteredMock {
  matcher: CommandMatcher;
  handler: MockProcessHandler | MockProcessResultOptions;
}

/**
 * 模拟进程执行器实现。
 * 遵循 ProcessExecutor 接口契约，支持预设命令响应、跟踪调用历史并模拟超时与取消场景。
 */
export class MockProcessExecutor implements ProcessExecutor {
  private mocks: RegisteredMock[] = [];
  public calls: ProcessCall[] = [];
  public detachedCalls: DetachedProcessCall[] = [];
  public defaultPid = 10001;

  /**
   * 注册模拟命令匹配与返回结果。
   *
   * @param matcher 匹配器（命令字符串、正则表达式或判断函数）
   * @param handlerOrResult 预设执行结果或动态处理函数
   */
  register(
    matcher: CommandMatcher,
    handlerOrResult: MockProcessHandler | MockProcessResultOptions
  ): this {
    this.mocks.push({ matcher, handler: handlerOrResult });
    return this;
  }

  /**
   * 执行外部命令并返回模拟结果。
   *
   * @param command 执行命令
   * @param args 参数列表
   * @param options 执行选项
   */
  async exec(
    command: string,
    args: string[] = [],
    options: ProcessExecOptions = {}
  ): Promise<ProcessResult> {
    const startTime = Date.now();
    this.calls.push({
      command,
      args: [...args],
      options: { ...options },
      timestamp: startTime,
    });

    // 检查调用前是否已中断
    if (options.signal?.aborted) {
      const res: ProcessResult = {
        ok: false,
        exitCode: null,
        signal: "SIGTERM",
        stdout: "",
        stderr: "Process was cancelled by AbortSignal",
        raw: new Uint8Array(),
        timedOut: false,
        cancelled: true,
        durationMs: 0,
        error: {
          code: "PROCESS_CANCELLED",
          message: "Process was cancelled by AbortSignal",
        },
      };
      if (options.throwOnError) {
        throw new Error(res.stderr);
      }
      return res;
    }

    const matchedMock = this.findMock(command, args, options);
    let resolved: MockProcessResultOptions | ProcessResult;

    if (!matchedMock) {
      resolved = {
        ok: true,
        exitCode: 0,
        stdout: "",
        stderr: "",
      };
    } else if (typeof matchedMock.handler === "function") {
      resolved = await matchedMock.handler(command, args, options);
    } else {
      resolved = matchedMock.handler;
    }

    // 模拟延时控制
    const maybeMock = resolved as MockProcessResultOptions;
    if (typeof maybeMock.delayMs === "number" && maybeMock.delayMs > 0) {
      await this.waitDelay(maybeMock.delayMs, options);
    }

    // 组装标准化结果
    const timedOut = Boolean(resolved.timedOut);
    const cancelled = Boolean(resolved.cancelled || options.signal?.aborted);
    const stdout = resolved.stdout ?? "";
    const stderr = resolved.stderr ?? (timedOut ? "Process timed out" : cancelled ? "Process cancelled" : "");
    const raw = resolved.raw ?? new TextEncoder().encode(stdout);
    const exitCode =
      resolved.exitCode !== undefined
        ? resolved.exitCode
        : timedOut || cancelled
        ? null
        : resolved.ok === false
        ? 1
        : 0;
    const ok =
      resolved.ok !== undefined
        ? resolved.ok
        : exitCode === 0 && !timedOut && !cancelled && !resolved.error;
    const durationMs = resolved.durationMs ?? Date.now() - startTime;

    let error = resolved.error;
    if (!error) {
      if (timedOut) {
        error = {
          code: "PROCESS_TIMEOUT",
          message: `Process exceeded timeout of ${options.timeoutMs ?? durationMs}ms`,
        };
      } else if (cancelled) {
        error = {
          code: "PROCESS_CANCELLED",
          message: "Process was cancelled by AbortSignal",
        };
      } else if (!ok) {
        error = {
          code: "PROCESS_FAILED",
          message: stderr || `Process exited with code ${exitCode}`,
        };
      }
    }

    const finalResult: ProcessResult = {
      ok,
      exitCode,
      signal: resolved.signal,
      stdout,
      stderr,
      raw,
      timedOut,
      cancelled,
      durationMs,
      error,
    };

    if (!ok && options.throwOnError) {
      throw new Error(stderr || `Process exited with code ${exitCode}`);
    }

    return finalResult;
  }

  /**
   * 启动模拟脱离父进程的后台进程。
   *
   * @param options 守护进程启动选项
   */
  async spawnDetached(
    options: DetachedProcessOptions
  ): Promise<DetachedProcessResult> {
    const startTime = Date.now();
    this.detachedCalls.push({
      options: { ...options },
      timestamp: startTime,
    });

    if (options.signal?.aborted) {
      return {
        ok: false,
        ready: false,
        durationMs: 0,
        error: {
          code: "PROCESS_CANCELLED",
          message: "Process was cancelled by AbortSignal",
        },
      };
    }

    if (options.probe) {
      const fakeResult: ProcessResult = {
        ok: true,
        exitCode: 0,
        stdout: "ready",
        stderr: "",
        raw: new TextEncoder().encode("ready"),
        timedOut: false,
        cancelled: false,
        durationMs: 0,
      };
      const isReady = await options.probe(fakeResult);
      return {
        ok: isReady,
        pid: this.defaultPid++,
        ready: isReady,
        durationMs: Date.now() - startTime,
      };
    }

    return {
      ok: true,
      pid: this.defaultPid++,
      ready: true,
      durationMs: Date.now() - startTime,
    };
  }

  /**
   * 获取指定命令的历史调用记录。
   *
   * @param command 可选命令筛选
   */
  getCalls(command?: string): ProcessCall[] {
    if (!command) {
      return [...this.calls];
    }
    return this.calls.filter((c) => c.command === command);
  }

  /**
   * 获取最近一次命令调用记录。
   */
  getLastCall(): ProcessCall | undefined {
    return this.calls[this.calls.length - 1];
  }

  /**
   * 检查指定命令是否被调用过。
   *
   * @param command 目标命令
   */
  hasCalled(command: string): boolean {
    return this.calls.some((c) => c.command === command);
  }

  /**
   * 清空历史调用记录。
   */
  clearHistory(): void {
    this.calls = [];
    this.detachedCalls = [];
  }

  /**
   * 重置所有注册规则与历史记录。
   */
  reset(): void {
    this.mocks = [];
    this.calls = [];
    this.detachedCalls = [];
  }

  private findMock(
    command: string,
    args: string[],
    options: ProcessExecOptions
  ): RegisteredMock | undefined {
    const fullCommandLine = [command, ...args].join(" ").trim();

    // 逆序查找，优先匹配最新注册的规则
    for (let i = this.mocks.length - 1; i >= 0; i--) {
      const mock = this.mocks[i];
      if (typeof mock.matcher === "string") {
        if (
          mock.matcher === command ||
          mock.matcher === fullCommandLine ||
          fullCommandLine.startsWith(mock.matcher)
        ) {
          return mock;
        }
      } else if (mock.matcher instanceof RegExp) {
        if (mock.matcher.test(fullCommandLine) || mock.matcher.test(command)) {
          return mock;
        }
      } else if (typeof mock.matcher === "function") {
        if (mock.matcher(command, args, options)) {
          return mock;
        }
      }
    }
    return undefined;
  }

  private async waitDelay(
    delayMs: number,
    options: ProcessExecOptions
  ): Promise<void> {
    return new Promise<void>((resolve) => {
      let timer: ReturnType<typeof setTimeout> | undefined;

      const cleanup = () => {
        if (timer) clearTimeout(timer);
      };

      if (options.signal) {
        options.signal.addEventListener(
          "abort",
          () => {
            cleanup();
            resolve();
          },
          { once: true }
        );
      }

      timer = setTimeout(() => {
        cleanup();
        resolve();
      }, delayMs);
    });
  }
}
