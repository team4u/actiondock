import {
  PROCESS_OUTPUT_LIMIT,
  ProcessManager,
  type ProcessDriver,
  type ProcessExecutor,
  type ProcessOwner,
} from "@actiondock/core";
import { execCli } from "./cli";
import {
  encodeBytes,
  type CallOptions,
  type ControlGrant,
  type OperationReceipt,
  type OutputChunk,
  type ProcessAcquireInput,
  type ProcessControlInput,
  type ProcessExecOptions,
  type ProcessInfo,
  type ProcessListInput,
  type ProcessListResult,
  type ProcessReadInput,
  type ProcessResult,
  type ProcessRunInput,
  type ProcessRunResult,
  type ProcessStartInput,
  type ProcessStartResult,
  type ProcessStopInput,
  type ProcessWriteInput,
  type ReadResult,
  type RuntimeError,
} from "@actiondock/sdk";
import type { Clock } from "@actiondock/core";
import { FakeProcessDriver } from "./process-driver";

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

interface RegisteredMock {
  matcher: CommandMatcher;
  handler: MockProcessHandler | MockProcessResultOptions;
}

/**
 * 模拟进程执行器构造选项。
 */
export interface MockProcessExecutorOptions {
  /** 未命中任何模拟规则时是否回退到真实子进程执行（默认 false，未命中即抛错） */
  fallbackToReal?: boolean;
  /** 可选注入的底层进程驱动（默认使用 FakeProcessDriver） */
  driver?: ProcessDriver;
  /** 可选注入的受管进程管理器 */
  processManager?: ProcessManager;
  /** 默认受管进程归属所有者 */
  owner?: ProcessOwner;
  /** 可选注入的时钟：提供时模拟延时 delayMs 由时钟驱动（FakeClock 可确定性推进），未提供时回退真实 setTimeout */
  clock?: Clock;
}

/**
 * 模拟进程执行器实现。
 * 遵循 ProcessExecutor / ProcessAPI 接口契约，支持预设命令响应、跟踪调用历史、
 * 并无缝接入 ProcessManager 与 FakeProcessDriver 支撑受管进程全生命周期。
 *
 * 默认不回退真实子进程执行：未命中任何模拟规则时抛出明确错误，避免测试中的拼写失误穿透到真实系统命令。
 * 如确需真实回退（例如集成本地 CLI），可显式传入 fallbackToReal: true。
 */
export class MockProcessExecutor implements ProcessExecutor {
  private mocks: RegisteredMock[] = [];
  public calls: ProcessCall[] = [];
  public defaultPid = 10001;
  private readonly fallbackToReal: boolean;
  /** 可选时钟：提供时 waitDelay 以 clock.sleep 驱动，保证确定性测试 */
  private readonly clock?: Clock;
  public readonly driver: ProcessDriver;
  public readonly processManager: ProcessManager;
  public readonly owner: ProcessOwner;

  constructor(options: MockProcessExecutorOptions = {}) {
    this.fallbackToReal = options.fallbackToReal ?? false;
    this.clock = options.clock;
    this.driver = options.driver ?? new FakeProcessDriver();
    this.processManager =
      options.processManager ?? new ProcessManager({ driver: this.driver });
    this.owner = options.owner ?? {
      tenantId: "test-tenant",
      principalId: "test-principal",
      packageInstanceId: "test-package",
      generationId: "test-generation",
    };
  }

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
        exitCode: -1,
        signal: "SIGTERM",
        stdout: "",
        stderr: "Command aborted before execution by signal",
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
    const fullCommandLine = [command, ...args].join(" ").trim();
    let resolved: MockProcessResultOptions | ProcessResult;

    if (!matchedMock) {
      if (!this.fallbackToReal) {
        throw new Error(
          `MockProcessExecutor: 未命中任何模拟规则，且未开启 fallbackToReal，拒绝执行真实命令: ${fullCommandLine}\n已注册匹配器列表:\n${this.describeMatchers()}`
        );
      }
      try {
        const cliRes = await execCli(command, args, {
          cwd: options.cwd,
          env: options.env,
          signal: options.signal,
          timeout: options.timeoutMs,
          input: options.input,
          encoding: options.encoding,
          maxOutputBytes: options.maxOutputBytes,
        });
        resolved = {
          ok: cliRes.ok,
          exitCode: cliRes.exitCode,
          stdout: cliRes.stdout,
          stderr: cliRes.stderr,
          raw: cliRes.raw,
          timedOut: cliRes.timedOut,
          durationMs: cliRes.durationMs,
          error:
            cliRes.truncated && !cliRes.ok
              ? {
                  code: PROCESS_OUTPUT_LIMIT,
                  message: `Process output exceeded limit of ${options.maxOutputBytes} bytes`,
                }
              : undefined,
        };
      } catch (err: any) {
        resolved = {
          ok: false,
          exitCode: -1,
          stdout: "",
          stderr: err?.message || String(err),
          raw: new Uint8Array(),
          durationMs: Date.now() - startTime,
        };
      }
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

  async spawn(
    command: string,
    args: string[] = [],
    options: ProcessExecOptions = {}
  ): Promise<ProcessResult> {
    return this.exec(command, args, options);
  }

  /**
   * 一次性运行外部命令并收集输出。
   */
  async run(input: ProcessRunInput, call?: CallOptions): Promise<ProcessRunResult> {
    const args = input.spec.args ?? [];
    const matchedMock = this.findMock(input.spec.executable, args, {
      cwd: input.spec.cwd,
      env: input.spec.env?.set,
      timeoutMs: input.timeoutMs,
      maxOutputBytes: input.maxOutputBytes,
      signal: call?.signal,
    });

    // 仅在确实命中 mock 或显式开启真实回退时走 exec 路径；
    // 其余情况（含已注册其他 mock 但本命令未命中）一律落入受管进程路径，
    // 避免任意 mock 注册后未命中命令被错误拦截并抛「未命中」
    if (matchedMock || this.fallbackToReal) {
      const res = await this.exec(input.spec.executable, args, {
        cwd: input.spec.cwd,
        env: input.spec.env?.set,
        timeoutMs: input.timeoutMs,
        maxOutputBytes: input.maxOutputBytes,
        signal: call?.signal,
      });
      const chunks: OutputChunk[] = [];
      if (res.stdout) {
        chunks.push({
          stream: "stdout",
          data: encodeBytes(res.stdout),
        });
      }
      if (res.stderr) {
        chunks.push({
          stream: "stderr",
          data: encodeBytes(res.stderr),
        });
      }
      return {
        exit: { code: res.exitCode, signal: res.signal ?? null },
        chunks,
        truncated: Boolean(res.error?.code === "PROCESS_OUTPUT_LIMIT"),
      };
    }

    return this.processManager.run(this.owner, input, call);
  }

  /**
   * 启动新的受管进程资源。
   */
  async start(input: ProcessStartInput, call?: CallOptions): Promise<ProcessStartResult> {
    return this.processManager.start(this.owner, input, call);
  }

  /**
   * 查看指定受管进程资源的状态快照。
   */
  async inspect(id: string, call?: CallOptions): Promise<ProcessInfo> {
    return this.processManager.inspect(this.owner, id, call);
  }

  /**
   * 列出当前作用域内可见的受管进程资源。
   */
  async list(input: ProcessListInput, call?: CallOptions): Promise<ProcessListResult> {
    return this.processManager.list(this.owner, input, call);
  }

  /**
   * 申请指定受管进程的独占控制令牌。
   */
  async acquire(id: string, input: ProcessAcquireInput, call?: CallOptions): Promise<ControlGrant> {
    return this.processManager.acquire(this.owner, id, input, call);
  }

  /**
   * 延长当前有效控制令牌的存活时间。
   */
  async renew(id: string, token: string, ttlMs: number, call?: CallOptions): Promise<ControlGrant> {
    return this.processManager.renew(this.owner, id, token, ttlMs, call);
  }

  /**
   * 显式释放控制令牌。
   */
  async release(id: string, token: string, call?: CallOptions): Promise<void> {
    return this.processManager.release(this.owner, id, token, call);
  }

  /**
   * 向受管进程输入流写入原始字节数据。
   */
  async write(id: string, input: ProcessWriteInput, call?: CallOptions): Promise<OperationReceipt> {
    return this.processManager.write(this.owner, id, input, call);
  }

  /**
   * 查询指定请求标识的操作执行收据。
   */
  async operation(id: string, requestId: string, call?: CallOptions): Promise<OperationReceipt> {
    return this.processManager.operation(this.owner, id, requestId, call);
  }

  /**
   * 按游标读取受管进程输出流。
   */
  async read(id: string, input: ProcessReadInput, call?: CallOptions): Promise<ReadResult> {
    return this.processManager.read(this.owner, id, input, call);
  }

  /**
   * 向受管进程发送结构化控制指令。
   */
  async control(id: string, input: ProcessControlInput, call?: CallOptions): Promise<OperationReceipt> {
    return this.processManager.control(this.owner, id, input, call);
  }

  /**
   * 终止指定的受管进程资源。
   */
  async stop(id: string, input: ProcessStopInput, call?: CallOptions): Promise<ProcessInfo> {
    return this.processManager.stop(this.owner, id, input, call);
  }

  /**
   * 绑定指定所有者身份创建上下文进程接口。
   */
  forOwner(owner: ProcessOwner, runId?: string, signal?: AbortSignal) {
    return this.processManager.forOwner(owner, runId, signal);
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
  }

  /**
   * 重置所有注册规则与历史记录。
   */
  reset(): void {
    this.mocks = [];
    this.calls = [];
    if (this.driver instanceof FakeProcessDriver) {
      this.driver.reset();
    }
  }

  /**
   * 渲染已注册匹配器列表，辅助定位拼写失误。
   */
  private describeMatchers(): string {
    if (this.mocks.length === 0) {
      return "（无任何已注册匹配器）";
    }
    return this.mocks
      .map((m) => {
        const desc =
          typeof m.matcher === "string"
            ? `"${m.matcher}"`
            : m.matcher instanceof RegExp
            ? `/${m.matcher.source}/${m.matcher.flags}`
            : "[Function]";
        return `- ${desc}`;
      })
      .join("\n");
  }

  private findMock(
    command: string,
    args: string[],
    options: ProcessExecOptions
  ): RegisteredMock | undefined {
    const fullCommandLine = [command, ...args].join(" ").trim();

    // 逆序查找，优先匹配最新注册的规则；字符串匹配器仅支持命令名精确匹配与全命令行精确匹配
    for (let i = this.mocks.length - 1; i >= 0; i--) {
      const mock = this.mocks[i];
      if (typeof mock.matcher === "string") {
        if (mock.matcher === command || mock.matcher === fullCommandLine) {
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
    // 注入时钟时优先 clock.sleep：由 FakeClock.advance 确定性驱动，不占用真实时间
    if (this.clock) {
      await this.clock.sleep(delayMs);
      return;
    }

    return new Promise<void>((resolve) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      let onAbort: (() => void) | undefined;

      const cleanup = () => {
        if (timer) {
          clearTimeout(timer);
          timer = undefined;
        }
        if (options.signal && onAbort) {
          options.signal.removeEventListener("abort", onAbort);
          onAbort = undefined;
        }
      };

      if (options.signal) {
        if (options.signal.aborted) {
          resolve();
          return;
        }
        onAbort = () => {
          cleanup();
          resolve();
        };
        options.signal.addEventListener(
          "abort",
          onAbort,
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
