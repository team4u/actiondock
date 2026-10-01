import { spawn } from "node:child_process";
import {
  PROCESS_TIMEOUT,
  PROCESS_CANCELLED,
  PROCESS_FAILED,
  ProcessError,
} from "@actiondock/core";
import {
  ProcessManager,
  findExecutable,
  type ProcessDriver,
  type ProcessExecutor,
  type ProcessOwner,
  type Clock,
} from "@actiondock/core/package";
import {
  encodeBytes,
  type CallOptions,
  type OperationReceipt,
  type OutputChunk,
  type ProcessAPI,
  type ProcessControlInput,
  type ProcessInfo,
  type ProcessListInput,
  type ProcessListResult,
  type ProcessReadInput,
  type ProcessRunInput,
  type ProcessRunResult,
  type ProcessStartInput,
  type ProcessStartResult,
  type ProcessStopInput,
  type ProcessWriteInput,
  type ReadResult,
  type RuntimeError,
} from "@actiondock/sdk";
import { FakeProcessDriver } from "./process-driver";

export { findExecutable };

/**
 * 模拟命令匹配器。
 */
export type CommandMatcher =
  | string
  | RegExp
  | ((command: string, args: string[], input: ProcessRunInput) => boolean);

/**
 * 模拟进程执行结果选项。
 */
export interface MockProcessResultOptions {
  /** 命令是否执行成功（未显式提供 exitCode 时作为置 0 或 1 的依据） */
  ok?: boolean;
  /** 退出状态码 */
  exitCode?: number | null;
  /** 终止信号名称 */
  signal?: string | null;
  /** 标准输出文本 */
  stdout?: string;
  /** 标准错误文本 */
  stderr?: string;
  /** 原始字节输出 */
  raw?: Uint8Array;
  /** 结构化输出块列表 */
  chunks?: OutputChunk[];
  /** 进程退出结构 */
  exit?: { code: number | null; signal: string | null };
  /** 是否标记为超时（为 true 时抛出 PROCESS_TIMEOUT 异常） */
  timedOut?: boolean;
  /** 是否标记为已取消（为 true 时抛出 PROCESS_CANCELLED 异常） */
  cancelled?: boolean;
  /** 运行时结构化错误（提供时抛出相应异常） */
  error?: RuntimeError;
  /** 模拟执行延迟毫秒数 */
  delayMs?: number;
  /** 输出是否标记为截断 */
  truncated?: boolean;
}

/**
 * 模拟进程处理器函数。
 */
export type MockProcessHandler = (
  command: string,
  args: string[],
  input: ProcessRunInput
) =>
  | MockProcessResultOptions
  | ProcessRunResult
  | Promise<MockProcessResultOptions | ProcessRunResult>;

/**
 * 已记录的命令调用历史条目。
 */
export interface ProcessCall {
  /** 执行命令名称 */
  command: string;
  /** 执行参数列表 */
  args: string[];
  /** 运行输入规范 */
  input: ProcessRunInput;
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
  /** 未命中任何模拟规则时是否回退到真实子进程执行（默认 false） */
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
 * 基于 node:child_process spawn 的原生真实命令执行回退。
 */
async function executeRealProcess(
  input: ProcessRunInput,
  call?: CallOptions
): Promise<ProcessRunResult> {
  const executable = input.spec.executable;
  const args = input.spec.args ?? [];
  const maxOutputBytes = input.maxOutputBytes ?? 10 * 1024 * 1024;
  const timeoutMs = input.timeoutMs ?? 0;

  if (call?.signal?.aborted) {
    throw call.signal.reason instanceof ProcessError
      ? call.signal.reason
      : new ProcessError(PROCESS_CANCELLED, "Process run was cancelled");
  }

  const env: Record<string, string | undefined> =
    input.spec.env?.inherit === "none"
      ? { ...(input.spec.env?.set ?? {}) }
      : { ...process.env, ...(input.spec.env?.set ?? {}) };
  if (input.spec.env?.unset) {
    for (const key of input.spec.env.unset) {
      delete env[key];
    }
  }

  return new Promise<ProcessRunResult>((resolve, reject) => {
    let settled = false;
    let timedOut = false;
    let cancelled = false;
    let truncated = false;
    let totalBytes = 0;
    const chunks: OutputChunk[] = [];

    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(executable, args, {
        cwd: input.spec.cwd,
        env: env as Record<string, string>,
        stdio: ["ignore", "pipe", "pipe"],
        detached: process.platform !== "win32",
      });
    } catch (err: any) {
      reject(new ProcessError(PROCESS_FAILED, err?.message || String(err)));
      return;
    }

    const terminateChild = () => {
      if (child.pid && process.platform !== "win32") {
        try {
          process.kill(-child.pid, "SIGKILL");
        } catch {
          try {
            child.kill("SIGKILL");
          } catch {}
        }
      } else {
        try {
          child.kill("SIGKILL");
        } catch {}
      }
    };

    let timeoutTimer: NodeJS.Timeout | undefined;
    if (timeoutMs > 0) {
      timeoutTimer = setTimeout(() => {
        timedOut = true;
        terminateChild();
      }, timeoutMs);
      if (typeof (timeoutTimer as any)?.unref === "function") {
        (timeoutTimer as any).unref();
      }
    }

    let onAbort: (() => void) | undefined;
    if (call?.signal) {
      onAbort = () => {
        cancelled = true;
        terminateChild();
      };
      call.signal.addEventListener("abort", onAbort, { once: true });
    }

    const cleanup = () => {
      if (timeoutTimer) {
        clearTimeout(timeoutTimer);
        timeoutTimer = undefined;
      }
      if (call?.signal && onAbort) {
        call.signal.removeEventListener("abort", onAbort);
        onAbort = undefined;
      }
    };

    const appendChunk = (stream: "stdout" | "stderr", buf: Buffer) => {
      if (truncated) return;
      const len = buf.byteLength;
      if (totalBytes + len > maxOutputBytes) {
        const remaining = Math.max(0, maxOutputBytes - totalBytes);
        if (remaining > 0) {
          chunks.push({
            stream,
            data: encodeBytes(new Uint8Array(buf.buffer, buf.byteOffset, remaining)),
          });
        }
        totalBytes = maxOutputBytes;
        truncated = true;
        terminateChild();
      } else {
        chunks.push({
          stream,
          data: encodeBytes(new Uint8Array(buf.buffer, buf.byteOffset, len)),
        });
        totalBytes += len;
      }
    };

    child.stdout?.on("data", (data: Buffer) => appendChunk("stdout", data));
    child.stderr?.on("data", (data: Buffer) => appendChunk("stderr", data));

    child.on("error", (err) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new ProcessError(PROCESS_FAILED, err.message));
    });

    child.on("close", (code, signal) => {
      if (settled) return;
      settled = true;
      cleanup();

      if (timedOut) {
        reject(new ProcessError(PROCESS_TIMEOUT, `Process exceeded timeout of ${timeoutMs}ms`));
        return;
      }
      if (cancelled || call?.signal?.aborted) {
        reject(
          call?.signal?.reason instanceof ProcessError
            ? call.signal.reason
            : new ProcessError(PROCESS_CANCELLED, "Process run was cancelled")
        );
        return;
      }

      resolve({
        exit: { code, signal: signal ?? null },
        chunks,
        truncated,
      });
    });
  });
}

/**
 * 模拟进程执行器实现。
 * 遵循 ProcessExecutor / ProcessAPI 接口契约，支持预设命令响应、跟踪调用历史、
 * 并无缝接入 ProcessManager 与 FakeProcessDriver 支撑受管进程全生命周期。
 */
export class MockProcessExecutor implements ProcessExecutor {
  private mocks: RegisteredMock[] = [];
  public calls: ProcessCall[] = [];
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
   * 优先匹配 mock 规则运行命令，未命中时委托至真实回退或 ProcessManager。
   */
  private async runWithMock(
    input: ProcessRunInput,
    owner: ProcessOwner,
    call?: CallOptions
  ): Promise<ProcessRunResult> {
    const command = input.spec.executable;
    const args = input.spec.args ?? [];
    this.calls.push({
      command,
      args: [...args],
      input,
      timestamp: Date.now(),
    });

    if (call?.signal?.aborted) {
      throw call.signal.reason instanceof ProcessError
        ? call.signal.reason
        : new ProcessError(PROCESS_CANCELLED, "Process run was cancelled");
    }

    const matchedMock = this.findMock(command, args, input);

    if (matchedMock) {
      let resolved: MockProcessResultOptions | ProcessRunResult;
      if (typeof matchedMock.handler === "function") {
        resolved = await matchedMock.handler(command, args, input);
      } else {
        resolved = matchedMock.handler;
      }

      const maybeMock = resolved as MockProcessResultOptions;
      if (typeof maybeMock.delayMs === "number" && maybeMock.delayMs > 0) {
        await this.waitDelay(maybeMock.delayMs, call?.signal);
      }

      if (call?.signal?.aborted) {
        throw call.signal.reason instanceof ProcessError
          ? call.signal.reason
          : new ProcessError(PROCESS_CANCELLED, "Process run was cancelled");
      }

      if (maybeMock.timedOut) {
        throw new ProcessError(PROCESS_TIMEOUT, `Process exceeded timeout of ${input.timeoutMs}ms`);
      }
      if (maybeMock.cancelled) {
        throw new ProcessError(PROCESS_CANCELLED, "Process was cancelled");
      }
      if (maybeMock.error) {
        throw new ProcessError(maybeMock.error.code as any, maybeMock.error.message);
      }

      const chunks: OutputChunk[] = [];
      if (maybeMock.chunks) {
        chunks.push(...maybeMock.chunks);
      } else {
        if (maybeMock.stdout) {
          chunks.push({
            stream: "stdout",
            data: encodeBytes(maybeMock.stdout),
          });
        }
        if (maybeMock.stderr) {
          chunks.push({
            stream: "stderr",
            data: encodeBytes(maybeMock.stderr),
          });
        }
        if (maybeMock.raw && !maybeMock.stdout) {
          chunks.push({
            stream: "stdout",
            data: encodeBytes(maybeMock.raw),
          });
        }
      }

      const exitCode =
        maybeMock.exit?.code !== undefined
          ? maybeMock.exit.code
          : maybeMock.exitCode !== undefined
          ? maybeMock.exitCode
          : maybeMock.ok === false
          ? 1
          : 0;

      const signal = maybeMock.exit?.signal ?? (maybeMock.signal ? String(maybeMock.signal) : null);

      return {
        exit: { code: exitCode, signal },
        chunks,
        truncated: Boolean(maybeMock.truncated),
      };
    }

    if (this.fallbackToReal) {
      return executeRealProcess(input, call);
    }

    return this.processManager.run(owner, input, call);
  }

  /**
   * 一次性运行外部命令并收集输出。
   */
  async run(input: ProcessRunInput, call?: CallOptions): Promise<ProcessRunResult> {
    return this.runWithMock(input, this.owner, call);
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
   * 向受管进程输入流写入原始字节数据。
   */
  async write(id: string, input: ProcessWriteInput, call?: CallOptions): Promise<OperationReceipt> {
    return this.processManager.write(this.owner, id, input, call);
  }

  /**
   * 向受管进程发送结构化控制指令。
   */
  async control(id: string, input: ProcessControlInput, call?: CallOptions): Promise<OperationReceipt> {
    return this.processManager.control(this.owner, id, input, call);
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
   * 终止指定的受管进程资源。
   */
  async stop(id: string, input: ProcessStopInput, call?: CallOptions): Promise<ProcessInfo> {
    return this.processManager.stop(this.owner, id, input, call);
  }

  /**
   * 绑定指定所有者身份创建上下文进程接口，保持 mock 拦截与生命周期追踪。
   */
  forOwner(owner: ProcessOwner, runId?: string, signal?: AbortSignal): ProcessAPI {
    const bound = this.processManager.forOwner(owner, runId, signal);
    return new Proxy(bound, {
      get: (target, prop, receiver) => {
        if (prop === "run") {
          return (input: ProcessRunInput, call?: CallOptions) => {
            const mergedSignal = call?.signal ?? signal;
            const effectiveCall = mergedSignal ? { ...call, signal: mergedSignal } : call;
            return this.runWithMock(input, owner, effectiveCall);
          };
        }
        return Reflect.get(target, prop, receiver);
      },
    });
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
    input: ProcessRunInput
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
        if (mock.matcher(command, args, input)) {
          return mock;
        }
      }
    }
    return undefined;
  }

  private async waitDelay(
    delayMs: number,
    signal?: AbortSignal
  ): Promise<void> {
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
        if (signal && onAbort) {
          signal.removeEventListener("abort", onAbort);
          onAbort = undefined;
        }
      };

      if (signal) {
        if (signal.aborted) {
          resolve();
          return;
        }
        onAbort = () => {
          cleanup();
          resolve();
        };
        signal.addEventListener("abort", onAbort, { once: true });
      }

      timer = setTimeout(() => {
        cleanup();
        resolve();
      }, delayMs);
    });
  }
}
