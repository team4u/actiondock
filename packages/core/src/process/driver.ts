import type { Capabilities, LaunchSpec } from "@actiondock/sdk";

/**
 * 进程驱动实例底层控制句柄接口。
 */
export interface ProcessDriverHandle {
  /**
   * 向受管进程标准输入通道写入原始字节数据。
   *
   * @param data 原始字节切片
   */
  write(data: Uint8Array): Promise<void>;

  /**
   * 关闭标准输入流发送 EOF 信号。
   */
  sendInputEOF?(): Promise<void>;

  /**
   * 向进程前台作业组发送中断信号。
   */
  interruptForeground?(): Promise<void>;

  /**
   * 动态调整伪终端窗口尺寸。
   *
   * @param cols 列数
   * @param rows 行数
   */
  resize?(cols: number, rows: number): Promise<void>;

  /**
   * 优雅终止或强制终止底层进程。
   *
   * @param graceMs 优雅退出宽限时限（毫秒）
   */
  terminate(graceMs: number): Promise<{ code: number | null; signal: string | null } | void>;
}

/**
 * 进程驱动底层事件回调接口。
 */
export interface ProcessDriverCallbacks {
  /**
   * 接收来自进程的原始输出字节切片。
   *
   * @param stream 输出流来源标签
   * @param data 原始字节切片
   */
  onOutput(stream: "stdout" | "stderr" | "pty", data: Uint8Array): void;

  /**
   * 进程退出时触发。
   *
   * @param exit 退出状态码与信号
   */
  onExit(exit: { code: number | null; signal: string | null }): void;

  /**
   * 输出通道彻底关闭时触发。
   *
   * @param reason 关闭原因：自然关闭、drain 超时或宿主丢失
   */
  onOutputClosed?(reason: "natural" | "drain-timeout" | "host-lost"): void;

  /**
   * 进程发生底层错误时触发。
   *
   * @param err 异常对象
   */
  onError(err: Error): void;
}

/**
 * 默认允许继承的环境变量白名单。
 */
export const DEFAULT_ENV_ALLOWLIST: readonly string[] = Object.freeze([
  "PATH",
  "PATHEXT",
  "HOME",
  "USER",
  "LOGNAME",
  "SHELL",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "TERM",
  "TZ",
  "TMPDIR",
  "TMP",
  "TEMP",
  "SYSTEMROOT",
  "SYSTEMDRIVE",
  "COMSPEC",
  "APPDATA",
  "LOCALAPPDATA",
  "USERPROFILE",
  "HOMEDRIVE",
  "HOMEPATH",
  "WINDIR",
]);

/**
 * 解析并生成子进程生效环境变量集合。
 *
 * @param envConfig 启动规范中的环境变量配置
 * @param hostEnv 宿主环境变量字典，默认为 process.env
 */
export function resolveProcessEnv(
  envConfig?: LaunchSpec["env"],
  hostEnv: Record<string, string | undefined> = process.env
): Record<string, string> {
  const inherit = envConfig?.inherit ?? "allowlisted";
  const result: Record<string, string> = {};

  if (inherit === "allowlisted") {
    const isWin = process.platform === "win32";
    const allowSet = new Set(
      DEFAULT_ENV_ALLOWLIST.map((key) => (isWin ? key.toUpperCase() : key))
    );
    for (const [key, value] of Object.entries(hostEnv)) {
      if (value === undefined) continue;
      const lookupKey = isWin ? key.toUpperCase() : key;
      if (allowSet.has(lookupKey)) {
        result[key] = value;
      }
    }
  }

  if (envConfig?.set) {
    for (const [key, value] of Object.entries(envConfig.set)) {
      result[key] = value;
    }
  }

  if (envConfig?.unset) {
    const isWin = process.platform === "win32";
    for (const unsetKey of envConfig.unset) {
      if (isWin) {
        const unsetUpper = unsetKey.toUpperCase();
        for (const existingKey of Object.keys(result)) {
          if (existingKey.toUpperCase() === unsetUpper) {
            delete result[existingKey];
          }
        }
      } else {
        delete result[unsetKey];
      }
    }
  }

  return result;
}

/**
 * 进程观察者接口，接收来自底层驱动的流输出与生命周期通知。
 */
export interface ProcessObserver {
  /**
   * 接收来自进程的输出数据。
   *
   * @param stream 输出流类型
   * @param data 原始字节切片
   */
  output(stream: "stdout" | "stderr" | "pty", data: Uint8Array): void;

  /**
   * 进程退出通知。
   *
   * @param result 退出状态码与信号
   */
  exited(result: { code: number | null; signal: string | null }): void;

  /**
   * 输出流彻底关闭通知。
   *
   * @param reason 关闭原因：自然关闭、drain 超时或宿主丢失
   */
  outputClosed(reason: "natural" | "drain-timeout" | "host-lost"): void;

  /**
   * 底层驱动故障通知。
   *
   * @param error 故障异常对象
   */
  fault?(error: Error): void;
}

/**
 * 进程驱动句柄接口。
 */
export interface ProcessHandle {
  /** 句柄唯一标识 */
  readonly id: string;
  /** 操作系统进程标识符（若可用） */
  readonly pid?: number;
}

/**
 * 受管进程底层执行驱动接口。
 */
export interface ProcessDriver {
  /**
   * 查询当前驱动支持的运行时能力集快照。
   */
  getCapabilities(): Capabilities;

  /**
   * 依据《Managed Process 设计 v2》标准接口派生新进程。
   *
   * @param spec 进程启动规范
   * @param observer 进程生命周期与输出观察者
   */
  spawn(spec: LaunchSpec, observer: ProcessObserver): Promise<ProcessHandle>;

  /**
   * 兼容旧版基于 processId 派生新进程签名。
   */
  spawn(
    processId: string,
    spec: LaunchSpec,
    callbacks: ProcessDriverCallbacks
  ): Promise<ProcessDriverHandle>;

  /**
   * 向受管进程标准输入写入字节数据。
   *
   * @param handle 进程句柄
   * @param data 原始字节数据
   */
  write?(handle: ProcessHandle, data: Uint8Array): Promise<void>;

  /**
   * 关闭标准输入流发送 EOF 信号。
   */
  inputEOF?(handle: ProcessHandle): Promise<void>;

  /**
   * 向进程前台作业组发送中断信号。
   */
  interruptForeground?(handle: ProcessHandle): Promise<void>;

  /**
   * 动态调整终端窗口尺寸。
   */
  resize?(handle: ProcessHandle, cols: number, rows: number): Promise<void>;

  /**
   * 优雅终止或强制终止底层进程。
   */
  terminate(handle: ProcessHandle, graceMs: number): Promise<void>;
  terminate(processId: string, graceMs: number): Promise<void>;

  /**
   * 销毁进程句柄并清理关联资源。
   */
  dispose?(handle: ProcessHandle): Promise<void>;
}

/**
 * 内存模拟进程驱动实现，专用于确定性测试与离线环境。
 */
export class MemoryProcessDriver implements ProcessDriver {
  private capabilities: Capabilities;
  public handles = new Map<string, MemoryProcessDriverHandle>();
  public spawnHook?: (processId: string, spec: LaunchSpec, callbacks: ProcessDriverCallbacks) => Promise<MemoryProcessDriverHandle | void> | MemoryProcessDriverHandle | void;

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

  getCapabilities(): Capabilities {
    return { ...this.capabilities };
  }

  setCapabilities(caps: Partial<Capabilities>): void {
    this.capabilities = { ...this.capabilities, ...caps };
  }

  async spawn(
    specOrProcessId: LaunchSpec | string,
    observerOrSpec: ProcessObserver | LaunchSpec,
    maybeCallbacks?: ProcessDriverCallbacks
  ): Promise<any> {
    if (typeof specOrProcessId === "string") {
      const processId = specOrProcessId;
      const spec = observerOrSpec as LaunchSpec;
      const callbacks = maybeCallbacks!;
      if (this.spawnHook) {
        const customHandle = await this.spawnHook(processId, spec, callbacks);
        if (customHandle) {
          this.handles.set(processId, customHandle);
          return customHandle;
        }
      }

      const handle = new MemoryProcessDriverHandle(processId, spec, callbacks);
      this.handles.set(processId, handle);
      return handle;
    }

    const spec = specOrProcessId;
    const observer = observerOrSpec as ProcessObserver;
    const processId = `mem-${Math.random().toString(36).slice(2, 10)}`;
    const callbacks: ProcessDriverCallbacks = {
      onOutput(stream, data) {
        observer.output(stream, data);
      },
      onExit(exit) {
        observer.exited(exit);
      },
      onOutputClosed(reason) {
        observer.outputClosed(reason ?? "natural");
      },
      onError(err) {
        observer.fault?.(err);
      },
    };

    const handle = new MemoryProcessDriverHandle(processId, spec, callbacks);
    this.handles.set(processId, handle);
    return handle;
  }

  async terminate(handleOrId: ProcessHandle | string, graceMs: number): Promise<void> {
    const id = typeof handleOrId === "string" ? handleOrId : handleOrId.id;
    const handle = this.handles.get(id);
    if (handle) {
      await handle.terminate(graceMs);
    }
  }
}

/**
 * 内存模拟进程驱动句柄实现。
 */
export class MemoryProcessDriverHandle implements ProcessDriverHandle, ProcessHandle {
  public readonly id: string;
  public readonly processId: string;
  public readonly spec: LaunchSpec;
  public readonly callbacks: ProcessDriverCallbacks;
  public writtenChunks: Uint8Array[] = [];
  public eofSent = false;
  public interrupted = false;
  public currentSize?: { cols: number; rows: number };
  public terminated = false;
  public writeFailureError?: Error;

  constructor(
    processId: string,
    spec: LaunchSpec,
    callbacks: ProcessDriverCallbacks
  ) {
    this.id = processId;
    this.processId = processId;
    this.spec = spec;
    this.callbacks = callbacks;
  }

  async write(data: Uint8Array): Promise<void> {
    if (this.writeFailureError) {
      throw this.writeFailureError;
    }
    this.writtenChunks.push(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
  }

  async sendInputEOF(): Promise<void> {
    this.eofSent = true;
  }

  async interruptForeground(): Promise<void> {
    this.interrupted = true;
  }

  async resize(cols: number, rows: number): Promise<void> {
    this.currentSize = { cols, rows };
  }

  async terminate(graceMs: number): Promise<{ code: number | null; signal: string | null }> {
    this.terminated = true;
    const exitResult = { code: null, signal: "SIGTERM" };
    this.callbacks.onExit(exitResult);
    return exitResult;
  }

  emitOutput(stream: "stdout" | "stderr" | "pty", textOrBytes: string | Uint8Array): void {
    const bytes =
      typeof textOrBytes === "string"
        ? new TextEncoder().encode(textOrBytes)
        : textOrBytes;
    this.callbacks.onOutput(stream, bytes);
  }

  emitExit(code: number | null = 0, signal: string | null = null): void {
    this.callbacks.onExit({ code, signal });
  }

  emitOutputClosed(reason: "natural" | "drain-timeout" | "host-lost" = "natural"): void {
    this.callbacks.onOutputClosed?.(reason);
  }

  emitError(err: Error): void {
    this.callbacks.onError(err);
  }
}
