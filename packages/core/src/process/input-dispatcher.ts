import type { OperationReceipt } from "@actiondock/sdk";
import {
  CONTROL_REVOKED,
  INPUT_CLOSED,
  INPUT_OUTCOME_UNKNOWN,
  PROCESS_QUARANTINED,
  QUEUE_FULL,
  ProcessError,
} from "../errors";
import type {
  ManagedProcessRecord,
  ProcessOwner,
  QueuedOperation,
} from "./managed-record";
import type { ControlArbiter } from "./control-arbiter";
import type { ProcessRequestKey, StoredProcessRecord } from "./metadata-store";

/**
 * 输入调度器宿主协作回调集合。
 *
 * 持有者始终为 ProcessManager：调度器仅经回调透传副作用，不反向依赖管理器。
 */
export interface InputDispatcherHost {
  /** 收据与状态落盘（异步尽力而为，失败仅记录诊断） */
  persistReceipt(
    key: ProcessRequestKey,
    receipt: OperationReceipt,
    payloadHash?: string
  ): Promise<void>;
  persistState(processId: string, patch: Partial<StoredProcessRecord>): Promise<void>;
  /** 写入不确定失败后的隔离处置 */
  quarantineProcess(
    owner: ProcessOwner,
    processId: string,
    token?: string,
    reason?: string
  ): Promise<void> | unknown;
  /** 成功输入后的空闲定时器刷新 */
  refreshIdleTimer(proc: ManagedProcessRecord): void;
  /** 内部诊断记录 */
  recordDiagnostic(message: string, err?: unknown): void;
  /** 宿主级输入队列待写字节统计 */
  countHostPendingInputBytes(): number;
  /** 输入队列容量配额 */
  readonly maxPendingQueueBytesPerProcess: number;
  readonly maxPendingQueueBytesPerHost: number;
}

/**
 * write 入队请求参数。
 */
export interface EnqueueWriteInput {
  requestId: string;
  token: string;
  data: Uint8Array;
  key: ProcessRequestKey;
  payloadHash: string;
}

/**
 * control 入队请求参数。
 */
export interface EnqueueControlInput {
  requestId: string;
  token: string;
  action: QueuedOperation["action"];
  key: ProcessRequestKey;
  payloadHash: string;
}

/**
 * 输入调度器。
 *
 * 单一职责：待写入输入队列的入队、串行调度与接管——
 * - 入队：同步阶段完成容量检查与字节预扣（同一同步块，杜绝 await 窗口配额穿透），异步阶段落盘并推送队列
 * - 调度：inputQueue 串行循环，全部 await 返回点保留取消纪元与队首身份双重校验
 * - 接管：takeoverQueue 同步原子原语（纪元递增、标记失败、落盘回调、清空、字节归零）
 *
 * 调度循环对控制权的复核经控制权仲裁器委托执行。
 */
export class InputDispatcher {
  private readonly host: InputDispatcherHost;
  private readonly arbiter: ControlArbiter;

  constructor(host: InputDispatcherHost, arbiter: ControlArbiter) {
    this.host = host;
    this.arbiter = arbiter;
  }

  /**
   * 入队写入操作：同步阶段完成授权校验、输入通道校验、队列容量检查与字节预扣；
   * 异步阶段落盘排队收据并推送队列，随后触发串行调度。
   *
   * 返回的 Promise 在收据成功入队后 resolve（state 为 queued）；
   * 落盘或推送失败时回滚字节预扣并原样抛出。
   */
  async enqueueWrite(proc: ManagedProcessRecord, input: EnqueueWriteInput): Promise<OperationReceipt> {
    // 入队前校验授权与控制状态
    this.arbiter.validateOperation(proc, input.token);

    if (proc.inputClosed) {
      throw new ProcessError(INPUT_CLOSED, "Input stream is closed");
    }

    const rawBytes = input.data;
    const dataSize = rawBytes.byteLength;

    // 待写入队列容量检查：在任何 await 前同步原子校验并预占配额
    if (proc.pendingInputBytes + dataSize > this.host.maxPendingQueueBytesPerProcess) {
      throw new ProcessError(QUEUE_FULL, "Process pending input queue limit exceeded", {
        limit: this.host.maxPendingQueueBytesPerProcess,
      });
    }

    const totalHostPending = this.host.countHostPendingInputBytes();
    if (totalHostPending + dataSize > this.host.maxPendingQueueBytesPerHost) {
      throw new ProcessError(QUEUE_FULL, "Host pending input queue limit exceeded", {
        limit: this.host.maxPendingQueueBytesPerHost,
      });
    }

    // 同步占位预扣队列配额，杜绝并发 await 窗口穿透
    proc.pendingInputBytes += dataSize;
    let pendingBytesCommitted = false;

    try {
      const receipt: OperationReceipt = {
        requestId: input.requestId,
        state: "queued",
      };

      await this.host.persistReceipt(input.key, receipt, input.payloadHash);

      proc.inputQueue.push({
        type: "write",
        requestId: input.requestId,
        token: input.token,
        bytes: rawBytes,
        receipt,
        key: input.key,
        payloadHash: input.payloadHash,
        cancelEpoch: proc.cancelEpoch,
      });
      pendingBytesCommitted = true;

      // 异步调度推进
      queueMicrotask(() => void this.dispatchNext(proc));

      return { ...receipt };
    } finally {
      if (!pendingBytesCommitted) {
        proc.pendingInputBytes = Math.max(0, proc.pendingInputBytes - dataSize);
      }
    }
  }

  /**
   * 入队控制指令：异步阶段落盘排队收据并推送队列，随后触发串行调度。
   */
  async enqueueControl(proc: ManagedProcessRecord, input: EnqueueControlInput): Promise<OperationReceipt> {
    // 入队前校验授权与控制状态
    this.arbiter.validateOperation(proc, input.token);

    const receipt: OperationReceipt = {
      requestId: input.requestId,
      state: "queued",
    };

    await this.host.persistReceipt(input.key, receipt, input.payloadHash);

    proc.inputQueue.push({
      type: "control",
      requestId: input.requestId,
      token: input.token,
      action: input.action,
      receipt,
      key: input.key,
      payloadHash: input.payloadHash,
      cancelEpoch: proc.cancelEpoch,
    });

    queueMicrotask(() => void this.dispatchNext(proc));

    return { ...receipt };
  }

  /**
   * 输入队列接管原语：递增取消纪元、标记全部待调度操作失败并清空队列。
   *
   * 同步原子序列（无 await 窗口）：纪元递增 -> 逐条标记 failed ->
   * 逐条登记落盘回调（fire-and-forget，落盘函数内部自捕获异常）->
   * 清空队列 -> 待写字节归零。
   * stop 与 quarantine 接管输入队列必须经由此单一入口。
   */
  takeoverQueue(proc: ManagedProcessRecord, errorCode: string): void {
    // 递增取消纪元：接管输入队列，使挂起中的 dispatch 放弃过期结算
    proc.cancelEpoch = (proc.cancelEpoch ?? 0) + 1;

    for (const op of proc.inputQueue) {
      op.receipt.state = "failed";
      op.receipt.errorCode = errorCode;
      void this.host.persistReceipt(op.key, op.receipt, op.payloadHash);
    }
    proc.inputQueue = [];
    proc.pendingInputBytes = 0;
  }

  /**
   * 串行调度执行输入队列操作。
   *
   * 全部 await 返回点保留双重校验：取消纪元一致（未被 stop/quarantine 接管）
   * 且队首身份未变（未被并发结算改写）。
   */
  private async dispatchNext(proc: ManagedProcessRecord): Promise<void> {
    if (proc.isDispatching || proc.inputQueue.length === 0) {
      return;
    }

    proc.isDispatching = true;
    try {
      while (proc.inputQueue.length > 0) {
        const op = proc.inputQueue[0];

        // dispatch 前校验 token、epoch 与授权（经控制权仲裁器委托复核）
        if (
          proc.info.control !== "held" ||
          !proc.currentGrant ||
          proc.currentGrant.token !== op.token ||
          new Date(proc.currentGrant.expiresAt).getTime() <= Date.now() ||
          op.cancelEpoch !== proc.cancelEpoch
        ) {
          if (op.cancelEpoch === proc.cancelEpoch) {
            op.receipt.state = "failed";
            op.receipt.errorCode =
              proc.info.control === "quarantined" ? PROCESS_QUARANTINED : CONTROL_REVOKED;
            await this.host.persistReceipt(op.key, op.receipt, op.payloadHash);
          }
          proc.inputQueue.shift();
          if (op.bytes && op.cancelEpoch === proc.cancelEpoch) {
            proc.pendingInputBytes -= op.bytes.byteLength;
          }
          continue;
        }

        op.receipt.state = "dispatching";
        await this.host.persistReceipt(op.key, op.receipt, op.payloadHash);

        if (op.type === "write" && op.bytes) {
          try {
            if (!proc.handle) {
              throw new Error("Missing driver handle");
            }
            await proc.handle.write(op.bytes);

            // 写入返回后校验取消纪元与队首位置：已被 stop 或 quarantine 接管则放弃过期结算
            if (op.cancelEpoch !== proc.cancelEpoch || proc.inputQueue[0] !== op) {
              continue;
            }

            op.receipt.state = "completed";
            op.receipt.acceptedBytes = op.bytes.byteLength;
            this.host.refreshIdleTimer(proc);
          } catch (err) {
            // 写入返回异常时同样校验取消纪元：被接管则放弃过期结算
            if (op.cancelEpoch !== proc.cancelEpoch || proc.inputQueue[0] !== op) {
              continue;
            }
            // 若写入出现不确定失败，结果标记为 unknown，进程转入 quarantined
            op.receipt.state = "unknown";
            op.receipt.errorCode = INPUT_OUTCOME_UNKNOWN;
            await this.host.persistReceipt(op.key, op.receipt, op.payloadHash);
            proc.inputQueue.shift();
            proc.pendingInputBytes -= op.bytes.byteLength;
            await this.host.quarantineProcess(
              proc.owner,
              proc.info.id,
              op.token,
              "Write failed with uncertain outcome"
            );
            break;
          }
        } else if (op.type === "control" && op.action) {
          try {
            if (!proc.handle) {
              throw new Error("Missing driver handle");
            }
            if (op.action.type === "input-eof") {
              if (proc.handle.sendInputEOF) {
                await proc.handle.sendInputEOF();
              }
            } else if (op.action.type === "interrupt-foreground") {
              if (proc.handle.interruptForeground) {
                await proc.handle.interruptForeground();
              }
            } else if (op.action.type === "resize") {
              if (proc.handle.resize) {
                await proc.handle.resize(op.action.cols, op.action.rows);
              }
            }

            // 控制指令返回后校验取消纪元与队首位置：已被 stop 或 quarantine 接管则放弃过期结算
            if (op.cancelEpoch !== proc.cancelEpoch || proc.inputQueue[0] !== op) {
              continue;
            }

            if (op.action.type === "input-eof") {
              proc.inputClosed = true;
              await this.host.persistState(proc.info.id, { inputClosed: true } as any);
            }

            op.receipt.state = "completed";
            this.host.refreshIdleTimer(proc);
          } catch (err: any) {
            if (op.cancelEpoch !== proc.cancelEpoch || proc.inputQueue[0] !== op) {
              continue;
            }
            op.receipt.state = "failed";
            op.receipt.errorCode = err instanceof ProcessError ? err.code : "CONTROL_FAILED";
            if (err instanceof Error && err.message) {
              op.receipt.errorMessage = err.message;
            }
            this.host.recordDiagnostic(`Control action '${op.action.type}' failed for request '${op.requestId}'`, err);
          }
        }

        // 结算前再次校验：若结算窗口内被 stop 或 quarantine 接管则放弃改写
        if (op.cancelEpoch !== proc.cancelEpoch || proc.inputQueue[0] !== op) {
          continue;
        }

        await this.host.persistReceipt(op.key, op.receipt, op.payloadHash);
        proc.inputQueue.shift();
        if (op.bytes) {
          proc.pendingInputBytes -= op.bytes.byteLength;
        }
      }
    } finally {
      proc.isDispatching = false;
    }
  }
}
