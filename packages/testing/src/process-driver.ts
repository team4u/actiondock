import { randomUUID } from "node:crypto";
import type { Capabilities, LaunchSpec } from "@actiondock/sdk";
import type {
  ProcessDriver,
  ProcessDriverCallbacks,
  ProcessDriverHandle,
  ProcessHandle,
  ProcessObserver,
} from "@actiondock/core";

export type { ProcessDriver, ProcessObserver, ProcessHandle };

/**
 * 记录的标准写入操作条目。
 */
export interface RecordedWrite {
  /** 目标进程句柄 */
  handle: ProcessHandle;
  /** 写入的二进制字节数据 */
  data: Uint8Array;
  /** 调用发生时间戳 */
  timestamp: number;
}

/**
 * 记录的标准输入 EOF 调用条目。
 */
export interface RecordedEOF {
  /** 目标进程句柄 */
  handle: ProcessHandle;
  /** 调用发生时间戳 */
  timestamp: number;
}

/**
 * 记录的中断前台作业调用条目。
 */
export interface RecordedInterrupt {
  /** 目标进程句柄 */
  handle: ProcessHandle;
  /** 调用发生时间戳 */
  timestamp: number;
}

/**
 * 记录的调整尺寸调用条目。
 */
export interface RecordedResize {
  /** 目标进程句柄 */
  handle: ProcessHandle;
  /** 列数 */
  cols: number;
  /** 行数 */
  rows: number;
  /** 调用发生时间戳 */
  timestamp: number;
}

/**
 * 记录的终止进程调用条目。
 */
export interface RecordedTerminate {
  /** 目标进程句柄 */
  handle: ProcessHandle;
  /** 宽限退出时限 */
  graceMs: number;
  /** 调用发生时间戳 */
  timestamp: number;
}

/**
 * 记录的销毁进程调用条目。
 */
export interface RecordedDispose {
  /** 目标进程句柄 */
  handle: ProcessHandle;
  /** 调用发生时间戳 */
  timestamp: number;
}

/**
 * 记录的进程派生启动调用条目。
 */
export interface RecordedSpawn {
  /** 生成的进程句柄 */
  handle: ProcessHandle;
  /** 进程启动规范 */
  spec: LaunchSpec;
  /** 进程观察者对象 */
  observer: ProcessObserver;
  /** 调用发生时间戳 */
  timestamp: number;
}

/**
 * 内部模拟受管进程句柄数据。
 */
interface FakeInternalHandle extends ProcessHandle, ProcessDriverHandle {
  id: string;
  pid?: number;
  spec: LaunchSpec;
  observer: ProcessObserver;
  disposed: boolean;
  emitOutput(stream: "stdout" | "stderr" | "pty", data: Uint8Array | string): void;
  emitExit(result?: { code?: number | null; signal?: string | null } | number): void;
  emitOutputClosed(reason?: "natural" | "drain-timeout" | "host-lost"): void;
  emitFault(error: Error): void;
}

/**
 * 确定性测试专用进程驱动桩。
 * 遵循《ActionDock Managed Process 设计 v2》第 11、12 节契约：
 * - 支持确定性模拟输出（emitOutput）
 * - 支持确定性模拟退出（emitExit）
 * - 支持确定性模拟输出关闭（emitOutputClosed）
 * - 支持确定性模拟故障注入（emitFault）
 * - 记录完整写入（writes）、EOF 调用、resize 与 terminate 操作历史
 * - 支持模拟各阶段操作失败注入用于健壮性测试
 */
export class FakeProcessDriver implements ProcessDriver {
  private capabilities: Capabilities;
  private readonly handles = new Map<string, FakeInternalHandle>();

  /** 记录所有派生调用 */
  public readonly spawnCalls: RecordedSpawn[] = [];
  /** 记录所有写入调用 */
  public readonly writes: RecordedWrite[] = [];
  /** 记录所有 EOF 调用 */
  public readonly eofCalls: RecordedEOF[] = [];
  /** 记录所有前台中断调用 */
  public readonly interruptCalls: RecordedInterrupt[] = [];
  /** 记录所有调整尺寸调用 */
  public readonly resizeCalls: RecordedResize[] = [];
  /** 记录所有终止调用 */
  public readonly terminateCalls: RecordedTerminate[] = [];
  /** 记录所有销毁调用 */
  public readonly disposeCalls: RecordedDispose[] = [];

  /** 故障注入：下一次派生将抛出的异常 */
  public nextSpawnError?: Error;
  /** 故障注入：写入时将抛出的异常 */
  public nextWriteError?: Error;
  /** 故障注入：调整尺寸时将抛出的异常 */
  public nextResizeError?: Error;
  /** 故障注入：终止时将抛出的异常 */
  public nextTerminateError?: Error;

  /** 自动响应回调：在进程派生后触发 */
  public onSpawn?: (handle: ProcessHandle, spec: LaunchSpec, observer: ProcessObserver) => void;

  constructor(capabilities?: Partial<Capabilities>) {
    this.capabilities = {
      pty: true,
      resize: true,
      inputEOF: true,
      interruptForeground: true,
      terminationScope: "process-tree",
      ...capabilities,
    };
  }

  /**
   * 获取驱动能力集合。
   */
  getCapabilities(): Capabilities {
    return { ...this.capabilities };
  }

  /**
   * 覆盖驱动能力集合。
   */
  setCapabilities(caps: Partial<Capabilities>): void {
    this.capabilities = { ...this.capabilities, ...caps };
  }

  /**
   * 派生启动新进程，支持标准与旧版重载签名。
   */
  spawn(spec: LaunchSpec, observer: ProcessObserver): Promise<ProcessHandle>;
  spawn(
    processId: string,
    spec: LaunchSpec,
    callbacks: ProcessDriverCallbacks
  ): Promise<ProcessDriverHandle>;
  async spawn(
    specOrProcessId: LaunchSpec | string,
    observerOrSpec: ProcessObserver | LaunchSpec,
    maybeCallbacks?: ProcessDriverCallbacks
  ): Promise<any> {
    if (typeof specOrProcessId === "string") {
      const processId = specOrProcessId;
      const spec = observerOrSpec as LaunchSpec;
      const callbacks = maybeCallbacks!;
      return this.spawnLegacy(processId, spec, callbacks);
    }

    const spec = specOrProcessId;
    const observer = observerOrSpec as ProcessObserver;
    return this.spawnStandard(spec, observer);
  }

  /**
   * 标准接口实现派生新进程。
   */
  private async spawnStandard(
    spec: LaunchSpec,
    observer: ProcessObserver,
    customId?: string
  ): Promise<ProcessHandle> {
    if (this.nextSpawnError) {
      const err = this.nextSpawnError;
      this.nextSpawnError = undefined;
      // 与 NodeProcessDriver 的 spawn 失败契约对齐：fault + exited（spawn 失败语义）+ outputClosed 三件套
      observer.fault?.(err);
      observer.exited({ code: null, signal: null });
      observer.outputClosed("natural");
      throw err;
    }

    const id = customId ?? randomUUID();
    const pid = Math.floor(10000 + Math.random() * 90000);

    const internalHandle: FakeInternalHandle = {
      id,
      pid,
      spec,
      observer,
      disposed: false,
      write: (data: Uint8Array) => this.write(internalHandle, data),
      sendInputEOF: () => this.inputEOF(internalHandle),
      interruptForeground: () => this.interruptForeground(internalHandle),
      resize: (cols: number, rows: number) => this.resize(internalHandle, cols, rows),
      terminate: (graceMs: number) => this.terminate(internalHandle, graceMs),
      emitOutput: (stream, data) => this.emitOutput(id, stream, data),
      emitExit: (result) => this.emitExit(id, result),
      emitOutputClosed: (reason) => this.emitOutputClosed(id, reason),
      emitFault: (err) => this.emitFault(id, err),
    };

    this.handles.set(id, internalHandle);
    const recorded: RecordedSpawn = {
      handle: internalHandle,
      spec,
      observer,
      timestamp: Date.now(),
    };
    this.spawnCalls.push(recorded);

    if (this.onSpawn) {
      this.onSpawn(internalHandle, spec, observer);
    }

    return internalHandle;
  }

  /**
   * 模拟写入数据并记录历史。
   */
  async write(handle: ProcessHandle, data: Uint8Array): Promise<void> {
    if (this.nextWriteError) {
      const err = this.nextWriteError;
      this.nextWriteError = undefined;
      throw err;
    }

    const copy = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    this.writes.push({
      handle,
      data: copy,
      timestamp: Date.now(),
    });
  }

  /**
   * 模拟输入流关闭并记录历史。
   */
  async inputEOF(handle: ProcessHandle): Promise<void> {
    this.eofCalls.push({
      handle,
      timestamp: Date.now(),
    });
  }

  /**
   * 模拟中断前台作业并记录历史。
   */
  async interruptForeground(handle: ProcessHandle): Promise<void> {
    this.interruptCalls.push({
      handle,
      timestamp: Date.now(),
    });
  }

  /**
   * 模拟调整终端尺寸并记录历史。
   */
  async resize(handle: ProcessHandle, cols: number, rows: number): Promise<void> {
    if (this.nextResizeError) {
      const err = this.nextResizeError;
      this.nextResizeError = undefined;
      throw err;
    }

    this.resizeCalls.push({
      handle,
      cols,
      rows,
      timestamp: Date.now(),
    });
  }

  /**
   * 模拟终止进程并记录历史。
   *
   * 终止语义与 MemoryProcessDriver 对齐：除非测试通过 nextTerminateError
   * 注入故障，否则终止后进程必须退出（触发 exited 回调），否则
   * ProcessManager.run 的超时/超限路径在 terminate 后永远收不到退出事件，
   * 调用方会永久挂起。需要非退出语义的用例可先 setExitBehavior 或
   * 直接使用 handle 上的确定性模拟接口自行控制退出时机。
   */
  terminate(handle: ProcessHandle, graceMs: number): Promise<void>;
  terminate(processId: string, graceMs: number): Promise<void>;
  async terminate(handleOrId: ProcessHandle | string, graceMs: number): Promise<void> {
    if (this.nextTerminateError) {
      const err = this.nextTerminateError;
      this.nextTerminateError = undefined;
      throw err;
    }

    const targetHandle =
      typeof handleOrId === "string" ? this.handles.get(handleOrId) : handleOrId;

    if (targetHandle) {
      this.terminateCalls.push({
        handle: targetHandle,
        graceMs,
        timestamp: Date.now(),
      });
      // 终止即退出：以 SIGTERM 语义通知观察者，保证上层等待链路收敛
      this.emitExit(targetHandle, { code: null, signal: "SIGTERM" });
    }
  }

  /**
   * 模拟销毁进程并记录历史。
   */
  async dispose(handle: ProcessHandle): Promise<void> {
    const internal = this.handles.get(handle.id);
    if (internal) {
      internal.disposed = true;
    }
    this.disposeCalls.push({
      handle,
      timestamp: Date.now(),
    });
  }

  /**
   * 确定性模拟向观察者发送输出。
   */
  emitOutput(
    handleOrId: ProcessHandle | string,
    stream: "stdout" | "stderr" | "pty",
    data: Uint8Array | string
  ): void {
    const internal = this.resolveInternal(handleOrId);
    const bytes =
      typeof data === "string" ? new TextEncoder().encode(data) : data;
    internal.observer.output(stream, bytes);
  }

  /**
   * 确定性模拟进程退出事件。
   */
  emitExit(
    handleOrId: ProcessHandle | string,
    result?: { code?: number | null; signal?: string | null } | number
  ): void {
    const internal = this.resolveInternal(handleOrId);
    let code: number | null = 0;
    let signal: string | null = null;

    if (typeof result === "number") {
      code = result;
    } else if (result) {
      code = result.code !== undefined ? result.code : 0;
      signal = result.signal ?? null;
    }

    internal.observer.exited({ code, signal });
  }

  /**
   * 确定性模拟输出流彻底关闭事件。
   */
  emitOutputClosed(
    handleOrId: ProcessHandle | string,
    reason: "natural" | "drain-timeout" | "host-lost" = "natural"
  ): void {
    const internal = this.resolveInternal(handleOrId);
    internal.observer.outputClosed(reason);
  }

  /**
   * 确定性模拟驱动故障通知。
   */
  emitFault(handleOrId: ProcessHandle | string, error: Error): void {
    const internal = this.resolveInternal(handleOrId);
    internal.observer.fault?.(error);
  }

  /**
   * 注入下一次 spawn 故障异常。
   */
  simulateSpawnFailure(error: Error): void {
    this.nextSpawnError = error;
  }

  /**
   * 注入下一次 write 故障异常。
   */
  simulateWriteFailure(error: Error): void {
    this.nextWriteError = error;
  }

  /**
   * 注入下一次 resize 故障异常。
   */
  simulateResizeFailure(error: Error): void {
    this.nextResizeError = error;
  }

  /**
   * 注入下一次 terminate 故障异常。
   */
  simulateTerminateFailure(error: Error): void {
    this.nextTerminateError = error;
  }

  /**
   * 获取最近创建的进程句柄。
   */
  getLastHandle(): ProcessHandle | undefined {
    const last = this.spawnCalls[this.spawnCalls.length - 1];
    return last?.handle;
  }

  /**
   * 查询指定句柄标识对应的句柄实例。
   */
  getHandle(handleOrId: ProcessHandle | string): ProcessHandle | undefined {
    const id = typeof handleOrId === "string" ? handleOrId : handleOrId.id;
    return this.handles.get(id);
  }

  /**
   * 查询指定句柄对应的观察者。
   */
  getObserver(handleOrId: ProcessHandle | string): ProcessObserver | undefined {
    const id = typeof handleOrId === "string" ? handleOrId : handleOrId.id;
    return this.handles.get(id)?.observer;
  }

  /**
   * 获取针对指定句柄（或全部句柄）的写入字节切片列表。
   */
  getWrites(handleOrId?: ProcessHandle | string): Uint8Array[] {
    if (!handleOrId) {
      return this.writes.map((w) => w.data);
    }
    const id = typeof handleOrId === "string" ? handleOrId : handleOrId.id;
    return this.writes.filter((w) => w.handle.id === id).map((w) => w.data);
  }

  /**
   * 获取针对指定句柄（或全部句柄）写入的 UTF-8 解码文本列表。
   */
  getWrittenStrings(handleOrId?: ProcessHandle | string): string[] {
    const decoder = new TextDecoder();
    return this.getWrites(handleOrId).map((chunk) => decoder.decode(chunk));
  }

  /**
   * 判断指定句柄是否接收到了 EOF 输入结束通知。
   */
  hasInputEOF(handleOrId?: ProcessHandle | string): boolean {
    if (!handleOrId) {
      return this.eofCalls.length > 0;
    }
    const id = typeof handleOrId === "string" ? handleOrId : handleOrId.id;
    return this.eofCalls.some((c) => c.handle.id === id);
  }

  /**
   * 判断指定句柄是否接收到了前台作业中断通知。
   */
  hasInterrupted(handleOrId?: ProcessHandle | string): boolean {
    if (!handleOrId) {
      return this.interruptCalls.length > 0;
    }
    const id = typeof handleOrId === "string" ? handleOrId : handleOrId.id;
    return this.interruptCalls.some((c) => c.handle.id === id);
  }

  /**
   * 清除历史调用记录。
   */
  clearHistory(): void {
    this.spawnCalls.length = 0;
    this.writes.length = 0;
    this.eofCalls.length = 0;
    this.interruptCalls.length = 0;
    this.resizeCalls.length = 0;
    this.terminateCalls.length = 0;
    this.disposeCalls.length = 0;
  }

  /**
   * 重置全部句柄、模拟规则与调用历史。
   */
  reset(): void {
    this.clearHistory();
    this.handles.clear();
    this.nextSpawnError = undefined;
    this.nextWriteError = undefined;
    this.nextResizeError = undefined;
    this.nextTerminateError = undefined;
    this.onSpawn = undefined;
  }

  /**
   * 兼容旧版基于 processId 派生新进程。
   */
  private async spawnLegacy(
    processId: string,
    spec: LaunchSpec,
    callbacks: ProcessDriverCallbacks
  ): Promise<ProcessDriverHandle> {
    const observer: ProcessObserver = {
      output(stream, data) {
        callbacks.onOutput(stream, data);
      },
      exited(result) {
        callbacks.onExit(result);
      },
      outputClosed(reason) {
        callbacks.onOutputClosed?.(reason);
      },
      fault(err) {
        callbacks.onError(err);
      },
    };

    const handle = await this.spawnStandard(spec, observer, processId);
    return handle as unknown as ProcessDriverHandle;
  }

  /**
   * 内部解析指定句柄或标识。
   */
  private resolveInternal(handleOrId: ProcessHandle | string): FakeInternalHandle {
    const id = typeof handleOrId === "string" ? handleOrId : handleOrId.id;
    const handle = this.handles.get(id);
    if (!handle) {
      throw new Error(`FakeProcessDriver: No handle found with id '${id}'`);
    }
    return handle;
  }
}

/**
 * 兼容原有命名导出。
 */
export { FakeProcessDriver as MockProcessDriver };
