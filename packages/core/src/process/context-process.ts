import type {
  CallOptions,
  ControlGrant,
  OperationReceipt,
  ProcessAcquireInput,
  ProcessAPI,
  ProcessControlInput,
  ProcessInfo,
  ProcessListInput,
  ProcessListResult,
  ProcessReadInput,
  ProcessRunInput,
  ProcessRunResult,
  ProcessStartInput,
  ProcessStartResult,
  ProcessStopInput,
  ProcessWriteInput,
  ReadResult,
} from "@actiondock/sdk";
import type { ProcessManager, ProcessOwner } from "./process-manager";

/**
 * 绑定当前 ActionContext 上下文凭据与运行标识的 ProcessAPI 适配器实现。
 *
 * 核心保证：
 * - 自动注入当前运行上下文的归属所有者与运行标识。
 * - 跟踪由当前 Run 申请成功持有的控制权令牌。
 * - 拦截 Run 退出或异常生命周期：若当前 Run 未显式 release 释放控制权，自动撤销 grant 并将目标进程置入隔离状态 quarantined。
 */
export class ContextProcessAPI implements ProcessAPI {
  private readonly heldProcesses = new Map<string, string>();
  private isDisposed = false;
  private onAbortHandler?: () => void;
  public readonly processManager: ProcessManager;
  public readonly owner: ProcessOwner;
  public readonly runId: string;
  public readonly signal?: AbortSignal;
  /** 是否为运行级作用域凭据：缺省时依据构造时是否显式传入 runId 判定 */
  public readonly runScoped: boolean;

  constructor(
    processManager: ProcessManager,
    owner: ProcessOwner,
    runId: string,
    signal?: AbortSignal,
    runScoped?: boolean
  ) {
    this.processManager = processManager;
    this.owner = owner;
    this.runId = runId;
    this.signal = signal;
    this.runScoped = runScoped ?? Boolean(runId);
    if (this.signal) {
      if (this.signal.aborted) {
        void this.dispose();
      } else {
        this.onAbortHandler = () => {
          void this.dispose();
        };
        this.signal.addEventListener("abort", this.onAbortHandler, { once: true });
      }
    }
  }

  /**
   * 底层进程管理器实例（协同入口的公开只读访问）。
   */
  public get manager(): ProcessManager {
    return this.processManager;
  }

  /**
   * 一次性运行外部命令。
   */
  async run(input: ProcessRunInput, call?: CallOptions): Promise<ProcessRunResult> {
    return this.processManager.run(this.owner, input, this.mergeCallOptions(call));
  }

  /**
   * 启动新的受管进程资源。
   */
  async start(input: ProcessStartInput, call?: CallOptions): Promise<ProcessStartResult> {
    return this.processManager.start(this.owner, input, this.mergeCallOptions(call));
  }

  /**
   * 查看指定受管进程资源的状态快照。
   */
  async inspect(id: string, call?: CallOptions): Promise<ProcessInfo> {
    return this.processManager.inspect(this.owner, id, this.mergeCallOptions(call));
  }

  /**
   * 分页列出当前所有者可见的受管进程列表。
   */
  async list(input: ProcessListInput, call?: CallOptions): Promise<ProcessListResult> {
    return this.processManager.list(this.owner, input, this.mergeCallOptions(call));
  }

  /**
   * 申请指定受管进程的独占控制令牌。
   */
  async acquire(
    id: string,
    input: ProcessAcquireInput,
    call?: CallOptions
  ): Promise<ControlGrant> {
    const grant = await this.processManager.acquire(
      this.owner,
      id,
      input,
      this.mergeCallOptions(call),
      this.runId
    );
    this.heldProcesses.set(id, grant.token);
    return grant;
  }

  /**
   * 延长当前有效控制令牌的存活时间。
   */
  async renew(
    id: string,
    token: string,
    ttlMs: number,
    call?: CallOptions
  ): Promise<ControlGrant> {
    const renewed = await this.processManager.renew(
      this.owner,
      id,
      token,
      ttlMs,
      this.mergeCallOptions(call)
    );
    this.heldProcesses.set(id, renewed.token);
    return renewed;
  }

  /**
   * 显式释放控制令牌。
   */
  async release(id: string, token: string, call?: CallOptions): Promise<void> {
    await this.processManager.release(
      this.owner,
      id,
      token,
      this.mergeCallOptions(call)
    );
    this.heldProcesses.delete(id);
  }

  /**
   * 向受管进程输入流写入原始字节数据。
   */
  async write(
    id: string,
    input: ProcessWriteInput,
    call?: CallOptions
  ): Promise<OperationReceipt> {
    return this.processManager.write(this.owner, id, input, this.mergeCallOptions(call));
  }

  /**
   * 查询指定请求标识的操作执行收据。
   */
  async operation(
    id: string,
    requestId: string,
    call?: CallOptions
  ): Promise<OperationReceipt> {
    return this.processManager.operation(
      this.owner,
      id,
      requestId,
      this.mergeCallOptions(call)
    );
  }

  /**
   * 按游标读取受管进程输出流。
   */
  async read(
    id: string,
    input: ProcessReadInput,
    call?: CallOptions
  ): Promise<ReadResult> {
    return this.processManager.read(this.owner, id, input, this.mergeCallOptions(call));
  }

  /**
   * 向受管进程发送结构化控制指令。
   */
  async control(
    id: string,
    input: ProcessControlInput,
    call?: CallOptions
  ): Promise<OperationReceipt> {
    return this.processManager.control(
      this.owner,
      id,
      input,
      this.mergeCallOptions(call)
    );
  }

  /**
   * 终止指定的受管进程资源。
   */
  async stop(
    id: string,
    input: ProcessStopInput,
    call?: CallOptions
  ): Promise<ProcessInfo> {
    const info = await this.processManager.stop(
      this.owner,
      id,
      input,
      this.mergeCallOptions(call)
    );
    this.heldProcesses.delete(id);
    return info;
  }

  /**
   * 拦截 Action Run 生命周期终结：
   * 若当前 Run 持有进程控制权且未显式 release，自动撤销 grant 并将目标进程置入隔离状态。
   */
  async dispose(): Promise<void> {
    if (this.isDisposed) {
      return;
    }
    this.isDisposed = true;

    if (this.signal && this.onAbortHandler) {
      this.signal.removeEventListener("abort", this.onAbortHandler);
      this.onAbortHandler = undefined;
    }

    if (this.heldProcesses.size === 0) {
      return;
    }

    const pendingEntries = Array.from(this.heldProcesses.entries());
    this.heldProcesses.clear();

    for (const [processId, token] of pendingEntries) {
      try {
        await this.processManager.quarantineProcess(
          this.owner,
          processId,
          token,
          "Run terminated without explicitly releasing control"
        );
      } catch {
        // 忽略终结清理阶段次级异常
      }
    }
  }

  /**
   * 合并上下文取消信号与单次调用选项中的取消信号。
   */
  private mergeCallOptions(call?: CallOptions): CallOptions | undefined {
    if (!this.signal && !call?.signal) {
      return call;
    }
    if (this.signal && !call?.signal) {
      return { ...call, signal: this.signal };
    }
    if (!this.signal && call?.signal) {
      return call;
    }

    // 两个信号同时存在时合成单一信号
    const combinedSignal = (AbortSignal as any).any
      ? (AbortSignal as any).any([this.signal, call!.signal])
      : call!.signal;

    return { ...call, signal: combinedSignal };
  }
}
