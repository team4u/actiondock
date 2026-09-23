import type {
  ControlGrant,
  Limits,
  OperationReceipt,
  ProcessControlAction,
  ProcessInfo,
} from "@actiondock/sdk";
import type { ProcessDriverHandle, ProcessHandle } from "./driver";
import type { ProcessRequestKey } from "./metadata-store";
import type { ProcessOutputLog } from "./output-log";
import type { EvictedOutputTombstone } from "./terminal-output-cache";

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
  token: string;
  bytes?: Uint8Array;
  action?: ProcessControlAction;
  /** 入队时进程的取消纪元，用于 stop 与 dispatch 竞态判定 */
  cancelEpoch: number;
  receipt: OperationReceipt;
  key: ProcessRequestKey;
  payloadHash: string;
}

/**
 * 排队等待获取控制权的调用者条目。
 */
export interface AcquireWaiter {
  requestId: string;
  waitMs: number;
  ttlMs: number;
  runId?: string;
  timer?: ReturnType<typeof setTimeout>;
  onAbort?: () => void;
  resolve: (grant: ControlGrant) => void;
  reject: (err: unknown) => void;
}

/**
 * 进程管理器内部维护的活跃受管进程记录。
 *
 * 该结构为进程管理器、控制权仲裁器与输入调度器的共享事实源：
 * 控制权与输入队列相关字段经仲裁器与调度器协作推进，禁止绕过二者直接改写。
 */
export interface ManagedProcessRecord {
  info: ProcessInfo;
  owner: ProcessOwner;
  scope: string;
  handle?: ProcessHandle & ProcessDriverHandle;
  outputLog: ProcessOutputLog;
  outputUnavailable?: boolean;
  outputTombstone?: EvictedOutputTombstone;
  controlEpoch: number;
  /** 取消纪元：stop 接管输入队列时递增，用于让挂起中的 dispatch 放弃过期结算 */
  cancelEpoch: number;
  currentGrant?: {
    token: string;
    epoch: number;
    ttlMs: number;
    expiresAt: string;
    runId?: string;
    requestId: string;
  };
  ttlTimer?: ReturnType<typeof setTimeout>;
  idleTimer?: ReturnType<typeof setTimeout>;
  lifetimeTimer?: ReturnType<typeof setTimeout>;
  drainTimer?: ReturnType<typeof setTimeout>;
  inputQueue: QueuedOperation[];
  pendingInputBytes: number;
  acquireWaiters: AcquireWaiter[];
  inputClosed: boolean;
  isDispatching: boolean;
  effectiveLimits: Required<Limits>;
}
