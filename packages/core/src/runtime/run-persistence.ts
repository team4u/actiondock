import type { JsonValue, RuntimeError, RunRecord } from "@actiondock/sdk";
import { ActionDockError, RUN_PERSISTENCE_FAILED, RUN_REPOSITORY_UNAVAILABLE } from "../errors";
import type { RuntimeStorage, TerminalRunStatus } from "../storage/types";

/**
 * 运行记录落库参数（RunRecord 构造与写入的领域入参）。
 *
 * 由 Runner 编排层在执行启动时装配，落库模块仅依赖该纯数据契约，不感知执行编排
 * 与上下文构建细节。
 */
export interface InitialRunRecordInput {
  /** 本次执行生成的全局唯一运行 ID */
  runId: string;
  /** 根运行 ID */
  rootRunId: string;
  /** 父级运行 ID（嵌套调用场景下建立调用链树） */
  parentRunId?: string;
  /** 执行归属所有者标识 */
  ownerId?: string;
  /** 执行宿主会话标识 */
  hostSessionId?: string;
  /** 包物理实例标识 */
  packageInstanceId?: string;
  /** 快照代次标识 */
  generationId?: string;
  /** 目标 Package 标识 */
  targetPackageId: string;
  /** 目标 Action 标识 */
  targetActionId: string;
  /** 执行开始时间戳 */
  startedAt: string;
  /** 原始输入数据 */
  input: unknown;
  /** 宿主 Runner 的 Package 标识 */
  runnerPackageId: string;
  /** 宿主 Runner 的包物理实例标识 */
  runnerPackageInstanceId: string;
  /** 宿主 Runner 的快照代次标识 */
  runnerGenerationId: string;
  /** Runner 构造注入的执行宿主会话标识 */
  runnerHostSessionId?: string;
}

/**
 * 运行终态收敛器（收敛原 finalized、persistError、isTimeout、timeoutTimer 闭包状态）。
 */
export interface RunFinalizer {
  /** 是否已写入终态 */
  finalized: boolean;
  /** 是否命中超时 */
  isTimeout: boolean;
  /** 落库异常错误信息 */
  persistError: RuntimeError | undefined;
  /** 超时定时器句柄 */
  timeoutTimer: ReturnType<typeof setTimeout> | undefined;
  /** 超时守卫绑定的取消控制器 */
  controller: AbortController | undefined;
  /** 外部中止信号对象 */
  signal?: AbortSignal;
  /** 外部中止信号监听句柄 */
  onAbort?: () => void;
  /** 竞态监听句柄注销函数列表（finalize 时统一清理，覆盖成功路径） */
  raceListenerRemovers: Array<() => void>;
  /** 绑定取消控制器并启动超时定时器 */
  startTimeout(controller: AbortController, timeoutMs: number): void;
  /** 写入终态（幂等，自动清理超时定时器与全部监听句柄） */
  finalize(status: TerminalRunStatus, output?: unknown, error?: RuntimeError): void;
}

/**
 * 构建运行初始记录（RunRecord 组装单一事实源）。
 */
export function buildInitialRunRecord(
  params: InitialRunRecordInput,
  status: "running" | "failed",
  error?: RuntimeError
): RunRecord {
  const {
    runId,
    rootRunId,
    parentRunId,
    ownerId,
    hostSessionId,
    packageInstanceId,
    generationId,
    targetPackageId,
    targetActionId,
    startedAt,
    input,
    runnerPackageId,
    runnerPackageInstanceId,
    runnerGenerationId,
    runnerHostSessionId,
  } = params;
  const record: RunRecord = {
    id: runId,
    rootRunId,
    parentRunId,
    packageId: targetPackageId,
    packageInstanceId:
      packageInstanceId || (runnerPackageId === targetPackageId ? runnerPackageInstanceId : targetPackageId),
    actionId: targetActionId,
    generationId: generationId || (runnerPackageId === targetPackageId ? runnerGenerationId : "1"),
    ownerId: ownerId || "local",
    hostSessionId: hostSessionId || runnerHostSessionId,
    status,
    error,
    startedAt,
  };
  if (status === "running") {
    record.input = input as JsonValue | undefined;
  } else {
    record.finishedAt = startedAt;
  }
  return record;
}

/**
 * 尝试将初始记录写入存储（存储异常静默忽略，用于非法输入等弱依赖场景）。
 */
export function tryCreateRun(storage: RuntimeStorage, record: RunRecord): void {
  try {
    storage.createRun(record);
  } catch {}
}

/**
 * 强制将初始记录写入存储（存储不可用时抛出 RUN_REPOSITORY_UNAVAILABLE）。
 */
export function createRunOrThrow(storage: RuntimeStorage, record: RunRecord): void {
  try {
    storage.createRun(record);
  } catch (err: any) {
    throw new ActionDockError(
      RUN_REPOSITORY_UNAVAILABLE,
      `RUN_REPOSITORY_UNAVAILABLE: Failed to initialize run record in repository: ${err?.message || String(err)}`,
      { originalError: err?.message }
    );
  }
}

/**
 * 更新运行终态并捕获落库异常（异常转译为 RUN_PERSISTENCE_FAILED 错误对象返回）。
 */
export function updateRunStatus(
  storage: RuntimeStorage,
  runId: string,
  status: TerminalRunStatus,
  output?: unknown,
  error?: RuntimeError
): RuntimeError | undefined {
  try {
    storage.updateRun(runId, status, output, error);
    return undefined;
  } catch (persistErr: any) {
    return {
      code: RUN_PERSISTENCE_FAILED,
      message: `RUN_PERSISTENCE_FAILED: Failed to persist run state: ${persistErr?.message || String(persistErr)}`,
      details: { originalError: persistErr?.message },
    };
  }
}

/**
 * 创建运行终态收敛器：封装终态去重、超时定时器清理与落库异常捕获。
 */
export function createRunFinalizer(
  storage: RuntimeStorage,
  runId: string
): RunFinalizer {
  const finalizer: RunFinalizer = {
    finalized: false,
    isTimeout: false,
    persistError: undefined,
    timeoutTimer: undefined,
    controller: undefined,
    signal: undefined,
    onAbort: undefined,
    raceListenerRemovers: [],
    startTimeout: (controller: AbortController, timeoutMs: number) => {
      finalizer.controller = controller;
      finalizer.timeoutTimer = setTimeout(() => {
        finalizer.isTimeout = true;
        finalizer.controller?.abort(new Error(`Action exceeded timeout of ${timeoutMs}ms`));
      }, timeoutMs);
    },
    finalize: (status: TerminalRunStatus, output?: unknown, error?: RuntimeError) => {
      if (finalizer.timeoutTimer) {
        clearTimeout(finalizer.timeoutTimer);
        finalizer.timeoutTimer = undefined;
      }
      if (finalizer.signal && finalizer.onAbort) {
        finalizer.signal.removeEventListener("abort", finalizer.onAbort);
        finalizer.onAbort = undefined;
      }
      // 成功路径同样注销竞态监听句柄，避免信号对象残留引用
      for (const remove of finalizer.raceListenerRemovers.splice(0)) {
        try {
          remove();
        } catch {}
      }
      if (finalizer.finalized) return;
      finalizer.finalized = true;
      finalizer.persistError = updateRunStatus(storage, runId, status, output, error);
    },
  };
  return finalizer;
}
