import type {
  Limits,
  OperationReceipt,
  ProcessControlAction,
  ProcessInfo,
} from "@actiondock/sdk";
import type { ProcessDriverHandle, ProcessHandle } from "./driver";
import type { ProcessRequestKey } from "./metadata-store";
import type { ProcessOutputLog } from "./output-log";

/**
 * 受管进程归属所有者身份。
 */
export interface ProcessOwner {
  tenantId: string;
  principalId: string;
  packageInstanceId: string;
  generationId: string;
}

/**
 * 待调度的异步操作队列条目。
 */
export interface QueuedOperation {
  type: "write" | "control";
  requestId: string;
  bytes?: Uint8Array;
  action?: ProcessControlAction;
  /** 入队时进程的取消纪元，用于 stop 与 dispatch 竞态判定 */
  cancelEpoch: number;
  receipt: OperationReceipt;
  key: ProcessRequestKey;
  payloadHash: string;
}

/**
 * 进程管理器内部维护的活跃受管进程记录。
 *
 * 该结构为进程管理器与输入调度器的共享事实源：
 * 输入队列相关字段经调度器协作推进，禁止绕过调度器直接改写。
 */
export interface ManagedProcessRecord {
  info: ProcessInfo;
  owner: ProcessOwner;
  scope: string;
  handle?: ProcessHandle & ProcessDriverHandle;
  outputLog: ProcessOutputLog;
  outputUnavailable?: boolean;
  /** 取消纪元：stop 接管输入队列时递增，用于让挂起中的 dispatch 放弃过期结算 */
  cancelEpoch: number;
  idleTimer?: ReturnType<typeof setTimeout>;
  lifetimeTimer?: ReturnType<typeof setTimeout>;
  drainTimer?: ReturnType<typeof setTimeout>;
  inputQueue: QueuedOperation[];
  pendingInputBytes: number;
  inputClosed: boolean;
  isDispatching: boolean;
  effectiveLimits: Required<Limits>;
}
