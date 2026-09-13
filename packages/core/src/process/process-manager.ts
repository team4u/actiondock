import { createHash, randomUUID } from "node:crypto";
import {
  decodeBytes,
  encodeBytes,
  type Bytes,
  type CallOptions,
  type Capabilities,
  type ControlGrant,
  type ControlState,
  type LaunchSpec,
  type Limits,
  type Logger,
  type OperationReceipt,
  type OutputChunk,
  type ProcessAcquireInput,
  type ProcessControlAction,
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
} from "@actiondock/sdk";
import {
  ACCESS_DENIED,
  CONTROL_BUSY,
  CONTROL_EXPIRED,
  CONTROL_REVOKED,
  INPUT_CLOSED,
  INPUT_OUTCOME_UNKNOWN,
  INPUT_VALIDATION_FAILED,
  NOT_FOUND,
  PROCESS_CANCELLED,
  PROCESS_LOST,
  PROCESS_QUARANTINED,
  PROCESS_SPAWN_ERROR,
  PROCESS_TIMEOUT,
  QUEUE_FULL,
  QUOTA_EXCEEDED,
  REQUEST_CONFLICT,
  SERVER_ERROR,
  UNSUPPORTED_CAPABILITY,
  INVALID_CURSOR,
  OUTPUT_UNAVAILABLE,
  ProcessError,
} from "../errors";
import { parseCursor, compareCursorPos } from "./cursor";
import { ContextProcessAPI } from "./context-process";
import type {
  ProcessDriver,
  ProcessDriverCallbacks,
  ProcessDriverHandle,
} from "./driver";
import {
  MemoryProcessMetadataStore,
  type ProcessMetadataStore,
  type ProcessOwnerFilter,
  type ProcessRequestKey,
  type StoredProcessRecord,
} from "./metadata-store";
import { ProcessOutputLog, type OutputChunk as InternalOutputChunk } from "./output-log";

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
 * 宿主与作用域资源配额配置。
 */
export interface ProcessManagerQuotas {
  /** 每个作用域允许并发存在的活跃进程上限，默认 8 */
  maxActiveProcessesPerScope: number;
  /** 每个宿主允许并发存在的活跃进程上限，默认 64 */
  maxActiveProcessesPerHost: number;
  /** 单个进程输出缓冲区保留字节数上限，默认 4MB */
  maxOutputBufferBytesPerProcess: number;
  /** 宿主所有活跃进程累计输出缓冲区字节数总上限，默认 128MB */
  maxOutputBufferBytesPerHost: number;
  /** 单个进程待写入输入队列保留字节数上限，默认 1MB */
  maxPendingQueueBytesPerProcess: number;
  /** 宿主所有进程待写入输入队列累计字节数总上限，默认 16MB */
  maxPendingQueueBytesPerHost: number;
  /** 单个进程并发等待独占控制权或输出日志的长轮询等待者上限，默认 8 */
  maxWaitersPerProcess: number;
  /** 宿主所有长轮询等待者累计上限，默认 256 */
  maxWaitersPerHost: number;
}

/**
 * 进程管理器构造选项。
 */
export interface ProcessManagerOptions {
  /** 宿主纪元代次标识，不传时自动生成 */
  hostEpoch?: string;
  /** 底层进程驱动实例 */
  driver: ProcessDriver;
  /** 元数据存储后端，默认采用内存存储 */
  metadataStore?: ProcessMetadataStore;
  /** 资源限额与配额覆盖 */
  quotas?: Partial<ProcessManagerQuotas>;
  /** 默认单进程硬性资源限额 */
  defaultLimits?: Partial<Limits>;
  /** 进程退出后输出排空宽限期（毫秒），默认 5000 */
  drainDeadlineMs?: number;
  /** 终态保留输出日志最大缓存保留时长（毫秒），默认 10 分钟 (600,000 毫秒) */
  terminalLogRetentionMs?: number;
  /** 可选结构化日志接口，用于透出持久化失败与驱动终止失败等诊断信息 */
  logger?: Logger;
}

/**
 * 待调度的异步操作队列条目。
 */
interface QueuedOperation {
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
interface AcquireWaiter {
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
 */
interface ManagedProcessRecord {
  info: ProcessInfo;
  owner: ProcessOwner;
  scope: string;
  handle?: ProcessDriverHandle;
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

/**
 * 格式化生成作用域唯一隔离字符串。
 */
export function formatProcessScope(owner: ProcessOwner): string {
  return `${owner.tenantId}:${owner.principalId}:${owner.packageInstanceId}:${owner.generationId}`;
}

/**
 * 校验调用方所有者凭据与目标记录是否完全匹配。
 */
function checkOwnerAuthorized(
  owner: ProcessOwner,
  target: ProcessOwnerFilter | StoredProcessRecord
): void {
  if (
    !owner ||
    !owner.tenantId ||
    !owner.principalId ||
    !owner.packageInstanceId ||
    !owner.generationId
  ) {
    throw new ProcessError(ACCESS_DENIED, "Missing required owner identity fields");
  }

  if (
    owner.tenantId !== target.tenantId ||
    owner.principalId !== target.principalId ||
    owner.packageInstanceId !== target.packageInstanceId ||
    owner.generationId !== target.generationId
  ) {
    throw new ProcessError(ACCESS_DENIED, "Access denied: owner identity mismatch");
  }
}

/**
 * 计算任意 JSON 负载对象的 SHA-256 哈希值。
 */
function hashRequestPayload(payload: unknown): string {
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

/**
 * 将持久化记录转换为 SDK 标准 ProcessInfo 快照。
 */
function toSdkProcessInfo(record: StoredProcessRecord): ProcessInfo {
  const ctrl = (record.control ?? record.controlState ?? "free") as ControlState;
  const exitDetails =
    record.exitCode !== undefined || record.exitSignal !== undefined
      ? { code: record.exitCode ?? null, signal: record.exitSignal ?? null }
      : undefined;

  return {
    id: record.processId,
    hostEpoch: record.hostEpoch,
    state: record.state as any,
    control: ctrl,
    io: (record.ioConfig ?? { mode: "pipe" }) as any,
    capabilities: (record.capabilities ?? {
      pty: false,
      resize: false,
      inputEOF: false,
      interruptForeground: false,
      terminationScope: "process",
    }) as any,
    createdAt: record.createdAt ?? new Date().toISOString(),
    exit: exitDetails,
    endReason: record.endReason as any,
    outputClosed: Boolean(record.outputClosed),
    outputEndReason: record.outputEndReason as any,
    effectiveLimits: (record.effectiveLimits ?? {
      idleMs: 60000,
      lifetimeMs: 3600000,
      outputBufferBytes: 4 * 1024 * 1024,
    }) as any,
  };
}

/**
 * 将内部模型转换为持久化记录。
 */
function toStoredProcessRecord(
  owner: ProcessOwner,
  info: ProcessInfo,
  startRequestId?: string
): StoredProcessRecord {
  return {
    processId: info.id,
    tenantId: owner.tenantId,
    principalId: owner.principalId,
    packageInstanceId: owner.packageInstanceId,
    generationId: owner.generationId,
    hostEpoch: info.hostEpoch,
    state: info.state,
    controlState: info.control,
    control: info.control,
    ioConfig: info.io as any,
    capabilities: info.capabilities as any,
    createdAt: info.createdAt,
    exitCode: info.exit ? info.exit.code : null,
    exitSignal: info.exit ? info.exit.signal : null,
    endReason: info.endReason ?? null,
    outputClosed: info.outputClosed,
    outputEndReason: info.outputEndReason ?? null,
    inputClosed: false,
    effectiveLimits: info.effectiveLimits as any,
    startRequestId,
  };
}

/**
 * 同步幂等预占条目：在异步落盘窗口内锁定同作用域、进程、操作类型与请求标识的并发请求。
 */
interface RequestReservation {
  payloadHash: string;
  operation: string;
  promise: Promise<unknown>;
  resolve: (value: unknown) => void;
  reject: (err: unknown) => void;
}

/**
 * 已淘汰输出日志的墓碑信息。
 */
interface EvictedOutputTombstone {
  tailCursor: string;
  earliestCursor: string;
  evictedAt: number;
}

/**
 * 终态输出日志缓存条目：附带驱逐时间戳支撑 TTL 过期回收与 LRU 淘汰。
 */
interface RetainedOutputLogEntry {
  log: ProcessOutputLog;
  evictedAt: number;
}

/**
 * 格式化同步幂等预占键。
 */
function formatReservationKey(key: ProcessRequestKey, operation: string): string {
  return `${key.hostEpoch}:${key.scope}:${key.processId ?? ""}:${operation}:${key.requestId}`;
}

/**
 * 校验正整数毫秒时长参数，非法时抛出参数错误。
 */
function checkPositiveDurationMs(value: number, field: string): void {
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    throw new ProcessError(INPUT_VALIDATION_FAILED, `Invalid ${field}: must be a positive integer (milliseconds)`, {
      [field]: value,
    });
  }
}

/**
 * 受管进程核心管理器。
 *
 * 职责范畴：
 * - 宿主身份与配额检查（每作用域活跃进程、每宿主进程、输出缓冲预算、等待者上限、输入队列容量）。
 * - 严格归属所有者鉴权校验（基于 tenantId, principalId, packageInstanceId, generationId）。
 * - 控制权状态机推进（free -> held -> quarantined -> closed）。
 * - 输入队列去重与串行调度执行。
 * - 资源生命周期定时器管理（idleTimeout, maxLifetime, drainDeadline）。
 */
export class ProcessManager {
  public readonly hostEpoch: string;
  public readonly driver: ProcessDriver;
  public readonly metadataStore: ProcessMetadataStore;
  public readonly quotas: ProcessManagerQuotas;
  public readonly defaultLimits: Required<Limits>;
  public readonly drainDeadlineMs: number;
  public readonly terminalLogRetentionMs: number;
  private readonly logger?: Logger;

  private processes = new Map<string, ManagedProcessRecord>();
  /** 已驱逐进程的输出日志缓存：附带时间戳支撑 TTL 过期回收与 LRU 淘汰 */
  private evictedOutputLogs = new Map<string, RetainedOutputLogEntry>();
  /** 已淘汰输出日志的墓碑缓存：防止因日志淘汰静默丢失输出数据，支撑缺口明确告知与不可用异常 */
  private evictedOutputTombstones = new Map<string, EvictedOutputTombstone>();
  /** 同步幂等预占表：以复合键在异步落盘窗口内锁定并发重复请求 */
  private requestReservations = new Map<string, RequestReservation>();
  private initPromise: Promise<number> | undefined;
  private isShutdown = false;
  /** 内部诊断日志：未注入 logger 时保留最近的持久化与驱动错误，避免静默吞没异常 */
  private diagnostics: string[] = [];

  constructor(options: ProcessManagerOptions) {
    this.hostEpoch = options.hostEpoch ?? `epoch-${Date.now()}-${randomUUID().slice(0, 8)}`;
    this.driver = options.driver;
    this.metadataStore = options.metadataStore ?? new MemoryProcessMetadataStore();

    this.quotas = {
      maxActiveProcessesPerScope: options.quotas?.maxActiveProcessesPerScope ?? 8,
      maxActiveProcessesPerHost: options.quotas?.maxActiveProcessesPerHost ?? 64,
      maxOutputBufferBytesPerProcess: options.quotas?.maxOutputBufferBytesPerProcess ?? 4 * 1024 * 1024,
      maxOutputBufferBytesPerHost: options.quotas?.maxOutputBufferBytesPerHost ?? 128 * 1024 * 1024,
      maxPendingQueueBytesPerProcess: options.quotas?.maxPendingQueueBytesPerProcess ?? 1 * 1024 * 1024,
      maxPendingQueueBytesPerHost: options.quotas?.maxPendingQueueBytesPerHost ?? 16 * 1024 * 1024,
      maxWaitersPerProcess: options.quotas?.maxWaitersPerProcess ?? 8,
      maxWaitersPerHost: options.quotas?.maxWaitersPerHost ?? 256,
    };

    this.defaultLimits = {
      idleMs: options.defaultLimits?.idleMs ?? 60000,
      lifetimeMs: options.defaultLimits?.lifetimeMs ?? 3600000,
      outputBufferBytes: options.defaultLimits?.outputBufferBytes ?? 4 * 1024 * 1024,
    };

    this.drainDeadlineMs = options.drainDeadlineMs ?? 5000;
    this.terminalLogRetentionMs = options.terminalLogRetentionMs ?? 10 * 60 * 1000;
    this.logger = options.logger;
  }

  /**
   * 初始化宿主环境，原子性收敛旧宿主遗留的非终态进程。
   * 幂等：重复调用返回同一份缓存 Promise。
   */
  async initialize(): Promise<number> {
    if (!this.initPromise) {
      this.initPromise = this.metadataStore
        .initializeHost(this.hostEpoch)
        .catch((err: unknown) => {
          this.initPromise = undefined;
          this.recordDiagnostic("initializeHost failed", err);
          throw err instanceof ProcessError
            ? err
            : new ProcessError(SERVER_ERROR, `Failed to initialize process host: ${err instanceof Error ? err.message : String(err)}`);
        });
    }
    return this.initPromise;
  }

  /**
   * 惰性收敛入口：所有公共操作前调用，确保崩溃恢复无需平台显式接线。
   */
  private ensureInitialized(): Promise<number> {
    return this.initialize();
  }

  /**
   * 记录内部诊断信息：优先写入注入的 logger，缺失时保留在内存环形缓冲区。
   */
  private recordDiagnostic(message: string, err?: unknown): void {
    const detail = err instanceof Error ? `${err.name}: ${err.message}` : err !== undefined ? String(err) : "";
    const line = detail ? `${message} (${detail})` : message;
    this.diagnostics.push(`${new Date().toISOString()} ${line}`);
    if (this.diagnostics.length > 100) {
      this.diagnostics.shift();
    }
    this.logger?.warn("[ProcessManager] " + line);
  }

  /**
   * 获取最近的内部诊断日志快照（最近条目在前）。
   */
  get recentDiagnostics(): string[] {
    return [...this.diagnostics].reverse();
  }

  /**
   * 异步落盘进程状态：捕获并记录持久化失败，杜绝静默吞没异常。
   */
  private async persistState(processId: string, patch: Partial<StoredProcessRecord>): Promise<void> {
    try {
      await this.metadataStore.updateProcessState(processId, patch);
    } catch (err) {
      this.recordDiagnostic(`Failed to persist state for process '${processId}'`, err);
    }
  }

  /**
   * 异步落盘请求凭据：捕获并记录持久化失败，杜绝静默吞没异常。
   */
  private async persistReceipt(
    key: ProcessRequestKey,
    receipt: OperationReceipt,
    payloadHash?: string
  ): Promise<void> {
    try {
      await this.metadataStore.recordRequest(key, receipt as any, payloadHash);
    } catch (err) {
      this.recordDiagnostic(`Failed to persist receipt for request '${key.requestId}'`, err);
    }
  }

  /**
   * 同步预占幂等请求：跨 await 的检查与落盘窗口内锁定同复合键并发调用。
   * 返回 undefined 表示预占成功，调用方继续异步路径并在完成时调用 commit/cancel。
   * 返回 RequestReservation 表示已有同请求进行中，调用方可等待其结果。
   * 若已有请求负载或操作类型不同，立即抛出 REQUEST_CONFLICT 杜绝混用结果。
   */
  private reserveRequest(
    key: ProcessRequestKey,
    payloadHash: string,
    operation: string
  ): RequestReservation | undefined {
    const reservationKey = formatReservationKey(key, operation);
    const existing = this.requestReservations.get(reservationKey);
    if (existing) {
      if (existing.payloadHash !== payloadHash || existing.operation !== operation) {
        throw new ProcessError(
          REQUEST_CONFLICT,
          "Request conflict: identical requestId with different payload",
          { requestId: key.requestId }
        );
      }
      return existing;
    }
    let resolveFn: (value: unknown) => void = () => {};
    let rejectFn: (err: unknown) => void = () => {};
    const promise = new Promise<unknown>((res, rej) => {
      resolveFn = res;
      rejectFn = rej;
    });
    // 预占 promise 可能永远无人等待：预先挂接空捕获，避免拒绝时触发 unhandledRejection
    promise.catch(() => {});
    const reservation: RequestReservation = {
      payloadHash,
      operation,
      promise,
      resolve: resolveFn,
      reject: rejectFn,
    };
    this.requestReservations.set(reservationKey, reservation);
    return undefined;
  }

  private commitReservation(key: ProcessRequestKey, operation: string, value: unknown): void {
    const reservationKey = formatReservationKey(key, operation);
    const reservation = this.requestReservations.get(reservationKey);
    if (reservation) {
      this.requestReservations.delete(reservationKey);
      reservation.resolve(value);
    }
  }

  private rejectReservation(key: ProcessRequestKey, operation: string, err: unknown): void {
    const reservationKey = formatReservationKey(key, operation);
    const reservation = this.requestReservations.get(reservationKey);
    if (reservation) {
      this.requestReservations.delete(reservationKey);
      reservation.reject(err);
    }
  }

  /**
   * 停止全部受管进程、清理全部定时器并置为关闭态，供宿主优雅退出使用。
   */
  async shutdown(): Promise<void> {
    if (this.isShutdown) {
      return;
    }
    this.isShutdown = true;

    const targets = Array.from(this.processes.values()).filter(
      (proc) =>
        proc.info.state !== "exited" &&
        proc.info.state !== "failed" &&
        proc.info.state !== "lost"
    );

    for (const proc of targets) {
      proc.info.endReason = proc.info.endReason ?? "requested";
      try {
        await this.stop(proc.owner, proc.info.id, {
          requestId: `shutdown-${proc.info.id}`,
          graceMs: 1000,
        });
      } catch (err) {
        this.recordDiagnostic(`Failed to stop process '${proc.info.id}' during shutdown`, err);
      }
    }

    // 防御性清理残余定时器（stop 内部已清理，此处兜底）
    for (const proc of this.processes.values()) {
      if (proc.ttlTimer) {
        clearTimeout(proc.ttlTimer);
        proc.ttlTimer = undefined;
      }
      if (proc.idleTimer) {
        clearTimeout(proc.idleTimer);
        proc.idleTimer = undefined;
      }
      if (proc.lifetimeTimer) {
        clearTimeout(proc.lifetimeTimer);
        proc.lifetimeTimer = undefined;
      }
      if (proc.drainTimer) {
        clearTimeout(proc.drainTimer);
        proc.drainTimer = undefined;
      }
    }

    for (const [reservationKey, res] of Array.from(this.requestReservations.entries())) {
      this.requestReservations.delete(reservationKey);
      res.reject(new ProcessError(PROCESS_CANCELLED, "Process manager has been shut down"));
    }
  }

  private assertNotShutdown(): void {
    if (this.isShutdown) {
      throw new ProcessError(PROCESS_CANCELLED, "Process manager has been shut down");
    }
  }

  /**
   * 为指定所有者与运行上下文创建 ProcessAPI 代理适配器。
   */
  forOwner(owner: ProcessOwner, runId?: string, signal?: AbortSignal): ContextProcessAPI {
    return new ContextProcessAPI(this, owner, runId ?? randomUUID(), signal, Boolean(runId));
  }

  /**
   * 启动新的受管进程资源。
   */
  async start(
    owner: ProcessOwner,
    input: ProcessStartInput,
    call?: CallOptions
  ): Promise<ProcessStartResult> {
    checkOwnerAuthorized(owner, owner);
    await this.ensureInitialized();
    this.assertNotShutdown();

    const scope = formatProcessScope(owner);
    const key: ProcessRequestKey = {
      hostEpoch: this.hostEpoch,
      scope,
      requestId: input.requestId,
    };
    const payloadHash = hashRequestPayload({ spec: input.spec, limits: input.limits });

    // 同步预占幂等请求，跨 await 窗口内拦截并发同 requestId 双重执行
    const inFlight = this.reserveRequest(key, payloadHash, "start");
    if (inFlight) {
      return (await inFlight.promise) as ProcessStartResult;
    }

    try {
      // 请求去重校验
      const existing = await this.metadataStore.getRequest(key);
      if (existing) {
        if (existing.payloadHash !== payloadHash) {
          throw new ProcessError(REQUEST_CONFLICT, "Request conflict: identical requestId with different payload", {
            requestId: input.requestId,
          });
        }
        const cached = existing.receipt as unknown as ProcessStartResult;
        this.commitReservation(key, "start", cached);
        return cached;
      }

      // 宿主与作用域配额检查
      this.checkSpawnQuotas(scope, input.limits?.outputBufferBytes);

      // 驱动能力校验
      const caps = this.driver.getCapabilities();
      if (input.spec.io.mode === "pty" && !caps.pty) {
        throw new ProcessError(UNSUPPORTED_CAPABILITY, "Driver does not support PTY mode");
      }

      const processId = `proc-${randomUUID()}`;
      const effectiveLimits: Required<Limits> = {
        idleMs: input.limits?.idleMs ?? this.defaultLimits.idleMs,
        lifetimeMs: input.limits?.lifetimeMs ?? this.defaultLimits.lifetimeMs,
        outputBufferBytes: input.limits?.outputBufferBytes ?? this.defaultLimits.outputBufferBytes,
      };

      const outputLog = new ProcessOutputLog(this.hostEpoch, processId, {
        maxBufferBytes: effectiveLimits.outputBufferBytes,
        maxWaiters: this.quotas.maxWaitersPerProcess,
      });

      const info: ProcessInfo = {
        id: processId,
        hostEpoch: this.hostEpoch,
        state: "starting",
        control: "free",
        io: input.spec.io,
        capabilities: caps,
        createdAt: new Date().toISOString(),
        outputClosed: false,
        effectiveLimits,
      };

      const procRecord: ManagedProcessRecord = {
        info,
        owner: { ...owner },
        scope,
        outputLog,
        controlEpoch: 0,
        cancelEpoch: 0,
        inputQueue: [],
        pendingInputBytes: 0,
        acquireWaiters: [],
        inputClosed: false,
        isDispatching: false,
        effectiveLimits,
      };

      this.processes.set(processId, procRecord);
      await this.metadataStore.saveProcess(toStoredProcessRecord(owner, info, input.requestId));

      // 调用驱动派生进程
      let abortListener: (() => void) | undefined;
      try {
        const callbacks: ProcessDriverCallbacks = {
          onOutput: (stream, data) => {
            procRecord.outputLog.append(stream, data);
          },
          onExit: (exit) => {
            this.handleProcessExit(procRecord, exit);
          },
          onOutputClosed: (reason) => {
            this.handleOutputClosed(procRecord, reason);
          },
          onError: (err) => {
            this.handleProcessError(procRecord, err);
          },
        };

        if (call?.signal?.aborted) {
          throw call.signal.reason instanceof ProcessError
            ? call.signal.reason
            : new ProcessError(PROCESS_CANCELLED, "Process start was cancelled");
        }

        const spawnPromise = this.driver.spawn(processId, input.spec, callbacks);
        if (call?.signal) {
          const abortPromise = new Promise<never>((_, reject) => {
            abortListener = () => {
              reject(
                call.signal?.reason instanceof ProcessError
                  ? call.signal.reason
                  : new ProcessError(PROCESS_CANCELLED, "Process start was cancelled")
              );
            };
            call.signal?.addEventListener("abort", abortListener, { once: true });
          });

          try {
            procRecord.handle = await Promise.race([spawnPromise, abortPromise]);
          } catch (raceErr) {
            void spawnPromise
              .then((h) => {
                if (h && typeof h.terminate === "function") {
                  void h.terminate(0);
                }
              })
              .catch(() => {});
            throw raceErr;
          } finally {
            if (abortListener) {
              call.signal.removeEventListener("abort", abortListener);
            }
          }
        } else {
          procRecord.handle = await spawnPromise;
        }

        if (call?.signal?.aborted) {
          if (procRecord.handle && typeof procRecord.handle.terminate === "function") {
            await procRecord.handle.terminate(0);
          }
          throw call.signal.reason instanceof ProcessError
            ? call.signal.reason
            : new ProcessError(PROCESS_CANCELLED, "Process start was cancelled");
        }

        // 仅在进程仍处于 starting 初始阶段时转为 running 并挂接定时器；
        // 若驱动在 spawn 完成前已触发 exited / failed / stopping，切勿回写为 running 且严禁启动空闲与寿命定时器
        if (procRecord.info.state === "starting") {
          procRecord.info.state = "running";
          await this.metadataStore.updateProcessState(processId, { state: "running" });

          this.startIdleTimer(procRecord);
          this.startLifetimeTimer(procRecord);
        }
      } catch (err: any) {
        if ((err instanceof ProcessError && err.code === PROCESS_CANCELLED) || call?.signal?.aborted) {
          if (procRecord.info.state !== "exited" && procRecord.info.state !== "failed") {
            procRecord.info.state = "exited";
            procRecord.info.endReason = "requested";
            procRecord.info.control = "closed";
            procRecord.outputLog.closeOutput("natural");
            await this.metadataStore.updateProcessState(processId, {
              state: "exited",
              endReason: "requested",
              control: "closed",
              controlState: "closed",
            });
          }
          throw err instanceof ProcessError
            ? err
            : new ProcessError(PROCESS_CANCELLED, "Process start was cancelled");
        }
        if (procRecord.info.state !== "exited" && procRecord.info.state !== "failed") {
          procRecord.info.state = "failed";
          procRecord.info.endReason = "spawn-failure";
          procRecord.info.control = "closed";
          procRecord.outputLog.closeOutput("natural");
          await this.metadataStore.updateProcessState(processId, {
            state: "failed",
            endReason: "spawn-failure",
            control: "closed",
            controlState: "closed",
          });
        }
        throw new ProcessError(PROCESS_SPAWN_ERROR, `Failed to spawn process: ${err?.message || String(err)}`);
      }

      const startResult: ProcessStartResult = {
        process: { ...procRecord.info },
        initialCursor: outputLog.earliestCursor,
      };

      await this.metadataStore.recordRequest(key, startResult as any, payloadHash);
      this.commitReservation(key, "start", startResult);
      return startResult;
    } finally {
      // 成功路径已在 commit 中移除预占；此处仅对异常路径释放并唤醒等待方
      this.rejectReservation(key, "start", new ProcessError(
        REQUEST_CONFLICT,
        "Concurrent start request did not produce a result",
        { requestId: input.requestId }
      ));
    }
  }

  /**
   * 查看指定受管进程资源的当前最新状态。
   */
  async inspect(owner: ProcessOwner, id: string, call?: CallOptions): Promise<ProcessInfo> {
    await this.ensureInitialized();
    const proc = await this.getOrLoadProcess(owner, id);
    return { ...proc.info };
  }

  /**
   * 分页列出指定归属所有者可见的受管进程列表。
   */
  async list(
    owner: ProcessOwner,
    input: ProcessListInput,
    call?: CallOptions
  ): Promise<ProcessListResult> {
    checkOwnerAuthorized(owner, owner);
    await this.ensureInitialized();

    const res = await this.metadataStore.listProcesses(owner, input.pageToken, input.limit);
    const processes: ProcessInfo[] = [];

    for (const item of res.processes) {
      const active = this.processes.get(item.processId);
      if (active) {
        processes.push({ ...active.info });
      } else {
        processes.push(toSdkProcessInfo(item as StoredProcessRecord));
      }
    }

    return {
      processes,
      nextPageToken: res.nextPageToken,
    };
  }

  /**
   * 申请指定受管进程的独占控制令牌。
   */
  async acquire(
    owner: ProcessOwner,
    id: string,
    input: ProcessAcquireInput,
    call?: CallOptions,
    runId?: string
  ): Promise<ControlGrant> {
    checkPositiveDurationMs(input.waitMs, "waitMs");
    checkPositiveDurationMs(input.ttlMs, "ttlMs");
    await this.ensureInitialized();
    this.assertNotShutdown();
    const proc = await this.getOrLoadProcess(owner, id);

    if (
      proc.info.state === "exited" ||
      proc.info.state === "failed" ||
      proc.info.state === "lost"
    ) {
      throw new ProcessError(CONTROL_REVOKED, "Process has terminated");
    }

    if (proc.info.control === "quarantined") {
      throw new ProcessError(PROCESS_QUARANTINED, "Process is in quarantined state");
    }

    if (proc.info.control === "closed") {
      throw new ProcessError(CONTROL_REVOKED, "Process control is closed");
    }

    const key: ProcessRequestKey = {
      hostEpoch: this.hostEpoch,
      scope: proc.scope,
      processId: id,
      requestId: input.requestId,
    };
    const payloadHash = hashRequestPayload({ waitMs: input.waitMs, ttlMs: input.ttlMs });

    // 同步预占幂等请求，跨 await 窗口内拦截并发同 requestId 双重授权
    const inFlight = this.reserveRequest(key, payloadHash, "acquire");
    if (inFlight) {
      return (await inFlight.promise) as ControlGrant;
    }

    try {
      // 幂等去重检查
      const existing = await this.metadataStore.getRequest(key);
      if (existing) {
        if (existing.payloadHash !== payloadHash) {
          throw new ProcessError(REQUEST_CONFLICT, "Request conflict: identical requestId with different payload", {
            requestId: input.requestId,
          });
        }
        const cached = existing.receipt as unknown as ControlGrant;
        this.commitReservation(key, "acquire", cached);
        return cached;
      }

      // 若控制权空闲且无等待者，直接授予
      if (proc.info.control === "free" && proc.acquireWaiters.length === 0) {
        const grant = this.grantControl(proc, input.requestId, input.ttlMs, runId);
        await this.metadataStore.recordRequest(key, grant as any, payloadHash);
        this.commitReservation(key, "acquire", grant);
        return grant;
      }

      // 控制权已被持有，检查等待队列配额并进入 FIFO 排队
      if (proc.acquireWaiters.length >= this.quotas.maxWaitersPerProcess) {
        throw new ProcessError(QUOTA_EXCEEDED, "Process acquire waiter quota exceeded", {
          limit: this.quotas.maxWaitersPerProcess,
        });
      }

      const totalHostWaiters = this.countHostAcquireWaiters();
      if (totalHostWaiters >= this.quotas.maxWaitersPerHost) {
        throw new ProcessError(QUOTA_EXCEEDED, "Host acquire waiter quota exceeded", {
          limit: this.quotas.maxWaitersPerHost,
        });
      }

      // 排队路径：由 wakeNextAcquireWaiter 在授予时落盘凭据并结算预占
      const grant = await new Promise<ControlGrant>((resolve, reject) => {
        let timer: ReturnType<typeof setTimeout> | undefined;

        const waiter: AcquireWaiter = {
          requestId: input.requestId,
          waitMs: input.waitMs,
          ttlMs: input.ttlMs,
          runId,
          resolve: (granted) => {
            cleanup();
            resolve(granted);
          },
          reject: (err) => {
            cleanup();
            reject(err);
          },
        };

        const cleanup = () => {
          if (timer) clearTimeout(timer);
          const idx = proc.acquireWaiters.indexOf(waiter);
          if (idx !== -1) {
            proc.acquireWaiters.splice(idx, 1);
          }
          if (call?.signal && waiter.onAbort) {
            call.signal.removeEventListener("abort", waiter.onAbort);
          }
        };

        if (call?.signal) {
          if (call.signal.aborted) {
            reject(call.signal.reason ?? new ProcessError(PROCESS_CANCELLED, "Acquire cancelled"));
            return;
          }
          waiter.onAbort = () => {
            cleanup();
            reject(call.signal?.reason ?? new ProcessError(PROCESS_CANCELLED, "Acquire cancelled"));
          };
          call.signal.addEventListener("abort", waiter.onAbort, { once: true });
        }

        timer = setTimeout(() => {
          cleanup();
          reject(new ProcessError(CONTROL_BUSY, "Timed out waiting for process control", {
            waitMs: input.waitMs,
          }));
        }, input.waitMs);
        if (typeof (timer as any)?.unref === "function") {
          (timer as any).unref();
        }

        proc.acquireWaiters.push(waiter);
      });

      this.commitReservation(key, "acquire", grant);
      return grant;
    } finally {
      // 成功路径已在 commit 中移除预占；此处仅对异常路径释放并唤醒等待方
      this.rejectReservation(key, "acquire", new ProcessError(
        REQUEST_CONFLICT,
        "Concurrent acquire request did not produce a result",
        { requestId: input.requestId }
      ));
    }
  }

  /**
   * 延长当前有效控制令牌的存活时间。
   */
  async renew(
    owner: ProcessOwner,
    id: string,
    token: string,
    ttlMs: number,
    call?: CallOptions
  ): Promise<ControlGrant> {
    checkPositiveDurationMs(ttlMs, "ttlMs");
    await this.ensureInitialized();
    const proc = await this.getOrLoadProcess(owner, id);

    if (proc.info.control === "quarantined") {
      throw new ProcessError(PROCESS_QUARANTINED, "Process is in quarantined state");
    }

    if (proc.info.control !== "held" || !proc.currentGrant) {
      throw new ProcessError(CONTROL_REVOKED, "Process control is not currently held");
    }

    if (proc.currentGrant.token !== token) {
      throw new ProcessError(ACCESS_DENIED, "Invalid control token");
    }

    if (new Date(proc.currentGrant.expiresAt).getTime() <= Date.now()) {
      throw new ProcessError(CONTROL_EXPIRED, "Control token has expired");
    }

    if (proc.ttlTimer) {
      clearTimeout(proc.ttlTimer);
    }

    const expiresAt = new Date(Date.now() + ttlMs).toISOString();
    proc.currentGrant.ttlMs = ttlMs;
    proc.currentGrant.expiresAt = expiresAt;

    proc.ttlTimer = setTimeout(() => {
      this.handleGrantTtlExpired(proc);
    }, ttlMs);
    if (typeof proc.ttlTimer.unref === "function") {
      proc.ttlTimer.unref();
    }

    // 延长控制权刷新 idleTimeout
    this.refreshIdleTimer(proc);

    return {
      token: proc.currentGrant.token,
      expiresAt,
    };
  }

  /**
   * 显式释放控制令牌，允许后续控制者申请。
   */
  async release(
    owner: ProcessOwner,
    id: string,
    token: string,
    call?: CallOptions
  ): Promise<void> {
    await this.ensureInitialized();
    const proc = await this.getOrLoadProcess(owner, id);

    if (proc.info.control === "quarantined") {
      throw new ProcessError(PROCESS_QUARANTINED, "Process is in quarantined state");
    }

    if (proc.info.control !== "held" || !proc.currentGrant) {
      throw new ProcessError(CONTROL_REVOKED, "Process control is not currently held");
    }

    if (proc.currentGrant.token !== token) {
      throw new ProcessError(ACCESS_DENIED, "Invalid control token");
    }

    // 当队列中存在待 dispatch 的操作时抛出 CONTROL_BUSY 拒绝 release
    if (proc.inputQueue.length > 0) {
      throw new ProcessError(CONTROL_BUSY, "Cannot release control while operations are pending in queue");
    }

    if (proc.ttlTimer) {
      clearTimeout(proc.ttlTimer);
      proc.ttlTimer = undefined;
    }
    proc.currentGrant = undefined;
    proc.info.control = "free";

    await this.persistState(id, {
      control: "free",
      controlState: "free",
    });

    // 正常 release 唤醒下一个等待者
    this.wakeNextAcquireWaiter(proc);
  }

  /**
   * 向受管进程输入流写入原始字节数据。
   */
  async write(
    owner: ProcessOwner,
    id: string,
    input: ProcessWriteInput,
    call?: CallOptions
  ): Promise<OperationReceipt> {
    await this.ensureInitialized();
    const proc = await this.getOrLoadProcess(owner, id);

    const key: ProcessRequestKey = {
      hostEpoch: this.hostEpoch,
      scope: proc.scope,
      processId: id,
      requestId: input.requestId,
    };
    const payloadHash = hashRequestPayload({ token: input.token, data: input.data });

    // 同步预占幂等请求，跨 await 窗口内拦截并发同 requestId 双重入队
    const inFlight = this.reserveRequest(key, payloadHash, "write");
    if (inFlight) {
      return (await inFlight.promise) as OperationReceipt;
    }

    try {
      // 幂等去重检查
      const existing = await this.metadataStore.getRequest(key);
      if (existing) {
        if (existing.payloadHash !== payloadHash) {
          throw new ProcessError(REQUEST_CONFLICT, "Request conflict: identical requestId with different payload", {
            requestId: input.requestId,
          });
        }
        const cached = existing.receipt as unknown as OperationReceipt;
        this.commitReservation(key, "write", cached);
        return cached;
      }

      // 入队前校验授权与控制状态
      this.checkOperationAuth(proc, input.token);

      if (proc.inputClosed) {
        throw new ProcessError(INPUT_CLOSED, "Input stream is closed");
      }

      const rawBytes = decodeBytes(input.data);
      const dataSize = rawBytes.byteLength;

      // 待写入队列容量检查：在任何 await 前同步原子校验并预占配额
      if (proc.pendingInputBytes + dataSize > this.quotas.maxPendingQueueBytesPerProcess) {
        throw new ProcessError(QUEUE_FULL, "Process pending input queue limit exceeded", {
          limit: this.quotas.maxPendingQueueBytesPerProcess,
        });
      }

      const totalHostPending = this.countHostPendingInputBytes();
      if (totalHostPending + dataSize > this.quotas.maxPendingQueueBytesPerHost) {
        throw new ProcessError(QUEUE_FULL, "Host pending input queue limit exceeded", {
          limit: this.quotas.maxPendingQueueBytesPerHost,
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

        await this.metadataStore.recordRequest(key, receipt as any, payloadHash);

        proc.inputQueue.push({
          type: "write",
          requestId: input.requestId,
          token: input.token,
          bytes: rawBytes,
          receipt,
          key,
          payloadHash,
          cancelEpoch: proc.cancelEpoch,
        });
        pendingBytesCommitted = true;

        // 异步调度推进
        queueMicrotask(() => void this.dispatchNext(proc));

        const queued = { ...receipt };
        this.commitReservation(key, "write", queued);
        return queued;
      } finally {
        if (!pendingBytesCommitted) {
          proc.pendingInputBytes = Math.max(0, proc.pendingInputBytes - dataSize);
        }
      }
    } finally {
      // 成功路径已在 commit 中移除预占；此处仅对异常路径释放并唤醒等待方
      this.rejectReservation(key, "write", new ProcessError(
        REQUEST_CONFLICT,
        "Concurrent write request did not produce a result",
        { requestId: input.requestId }
      ));
    }
  }

  /**
   * 向受管进程发送结构化控制指令。
   */
  async control(
    owner: ProcessOwner,
    id: string,
    input: ProcessControlInput,
    call?: CallOptions
  ): Promise<OperationReceipt> {
    await this.ensureInitialized();
    const proc = await this.getOrLoadProcess(owner, id);

    const key: ProcessRequestKey = {
      hostEpoch: this.hostEpoch,
      scope: proc.scope,
      processId: id,
      requestId: input.requestId,
    };
    const payloadHash = hashRequestPayload({ token: input.token, action: input.action });

    // 同步预占幂等请求，跨 await 窗口内拦截并发同 requestId 双重入队
    const inFlight = this.reserveRequest(key, payloadHash, "control");
    if (inFlight) {
      return (await inFlight.promise) as OperationReceipt;
    }

    try {
      // 幂等去重检查
      const existing = await this.metadataStore.getRequest(key);
      if (existing) {
        if (existing.payloadHash !== payloadHash) {
          throw new ProcessError(REQUEST_CONFLICT, "Request conflict: identical requestId with different payload", {
            requestId: input.requestId,
          });
        }
        const cached = existing.receipt as unknown as OperationReceipt;
        this.commitReservation(key, "control", cached);
        return cached;
      }

      // 入队前校验授权与控制状态
      this.checkOperationAuth(proc, input.token);

      // 校验能力支持
      if (input.action.type === "input-eof" && !proc.info.capabilities.inputEOF) {
        throw new ProcessError(UNSUPPORTED_CAPABILITY, "Driver does not support input-eof action");
      }
      if (
        input.action.type === "interrupt-foreground" &&
        !proc.info.capabilities.interruptForeground
      ) {
        throw new ProcessError(
          UNSUPPORTED_CAPABILITY,
          "Driver does not support interrupt-foreground action"
        );
      }
      if (
        input.action.type === "resize" &&
        (!proc.info.capabilities.resize || proc.info.io.mode !== "pty")
      ) {
        throw new ProcessError(
          UNSUPPORTED_CAPABILITY,
          "Driver does not support resize or IO mode is not pty"
        );
      }

      const receipt: OperationReceipt = {
        requestId: input.requestId,
        state: "queued",
      };

      await this.metadataStore.recordRequest(key, receipt as any, payloadHash);

      proc.inputQueue.push({
        type: "control",
        requestId: input.requestId,
        token: input.token,
        action: input.action,
        receipt,
        key,
        payloadHash,
        cancelEpoch: proc.cancelEpoch,
      });

      queueMicrotask(() => void this.dispatchNext(proc));

      const queued = { ...receipt };
      this.commitReservation(key, "control", queued);
      return queued;
    } finally {
      // 成功路径已在 commit 中移除预占；此处仅对异常路径释放并唤醒等待方
      this.rejectReservation(key, "control", new ProcessError(
        REQUEST_CONFLICT,
        "Concurrent control request did not produce a result",
        { requestId: input.requestId }
      ));
    }
  }

  /**
   * 查询指定请求标识的操作执行收据。
   */
  async operation(
    owner: ProcessOwner,
    id: string,
    requestId: string,
    call?: CallOptions
  ): Promise<OperationReceipt> {
    await this.ensureInitialized();
    const proc = await this.getOrLoadProcess(owner, id);

    const key: ProcessRequestKey = {
      hostEpoch: this.hostEpoch,
      scope: proc.scope,
      processId: id,
      requestId,
    };

    const record = await this.metadataStore.getRequest(key);
    if (!record) {
      throw new ProcessError(NOT_FOUND, `Operation receipt not found for request ID: ${requestId}`);
    }

    return record.receipt as unknown as OperationReceipt;
  }

  /**
   * 按游标读取受管进程输出流。
   */
  async read(
    owner: ProcessOwner,
    id: string,
    input: ProcessReadInput,
    call?: CallOptions
  ): Promise<ReadResult> {
    await this.ensureInitialized();
    const proc = await this.getOrLoadProcess(owner, id);

    if (proc.outputUnavailable) {
      const requestedPos = parseCursor(input.cursor, proc.info.hostEpoch, id);
      const tombstone = proc.outputTombstone ?? this.evictedOutputTombstones.get(id);

      if (tombstone) {
        const tailPos = parseCursor(tombstone.tailCursor, proc.info.hostEpoch, id);
        const cmp = compareCursorPos(requestedPos, tailPos);

        if (cmp > 0) {
          throw new ProcessError(
            INVALID_CURSOR,
            "Requested cursor is beyond the end of the output log",
            {
              cursor: input.cursor,
              tailCursor: tombstone.tailCursor,
            }
          );
        }

        if (cmp === 0) {
          return {
            chunks: [],
            nextCursor: tombstone.tailCursor,
            earliestCursor: tombstone.tailCursor,
            tailCursor: tombstone.tailCursor,
            truncated: false,
            eof: true,
            process: { ...proc.info },
          };
        }

        const gapMode = input.onGap ?? "error";
        if (gapMode === "error") {
          throw new ProcessError(
            OUTPUT_UNAVAILABLE,
            `Process output for '${id}' is unavailable because it has been evicted from memory`,
            { processId: id }
          );
        }

        return {
          chunks: [],
          nextCursor: tombstone.tailCursor,
          earliestCursor: tombstone.tailCursor,
          tailCursor: tombstone.tailCursor,
          truncated: true,
          gap: { fromCursor: input.cursor, toCursor: tombstone.tailCursor },
          eof: true,
          process: { ...proc.info },
        };
      }

      throw new ProcessError(
        OUTPUT_UNAVAILABLE,
        `Process output for '${id}' is unavailable because it has been evicted from memory`,
        { processId: id }
      );
    }

    const logResult = await proc.outputLog.waitForData(
      input.cursor,
      input.waitMs,
      call?.signal,
      {
        maxBytes: input.maxBytes,
        onGap: input.onGap,
      }
    );

    const chunks: OutputChunk[] = logResult.chunks.map((chunk: InternalOutputChunk) => ({
      stream: chunk.stream,
      data: encodeBytes(chunk.data),
    }));

    return {
      chunks,
      nextCursor: logResult.nextCursor,
      earliestCursor: logResult.earliestCursor,
      tailCursor: logResult.tailCursor,
      truncated: logResult.truncated,
      gap: logResult.gap,
      eof: logResult.eof,
      process: { ...proc.info },
    };
  }

  /**
   * 独立鉴权紧急终止通道，强行回收资源。
   */
  async stop(
    owner: ProcessOwner,
    id: string,
    input: ProcessStopInput,
    call?: CallOptions
  ): Promise<ProcessInfo> {
    await this.ensureInitialized();
    const proc = await this.getOrLoadProcess(owner, id);

    // 幂等返回已终止状态
    if (
      proc.info.state === "exited" ||
      proc.info.state === "failed" ||
      proc.info.state === "lost"
    ) {
      return { ...proc.info };
    }

    // 撤销控制权与定时器
    if (proc.ttlTimer) {
      clearTimeout(proc.ttlTimer);
      proc.ttlTimer = undefined;
    }
    proc.currentGrant = undefined;

    if (proc.idleTimer) {
      clearTimeout(proc.idleTimer);
      proc.idleTimer = undefined;
    }
    if (proc.lifetimeTimer) {
      clearTimeout(proc.lifetimeTimer);
      proc.lifetimeTimer = undefined;
    }
    if (proc.drainTimer) {
      clearTimeout(proc.drainTimer);
      proc.drainTimer = undefined;
    }

    // 递增取消纪元：接管输入队列，使挂起中的 dispatch 放弃过期结算
    proc.cancelEpoch = (proc.cancelEpoch ?? 0) + 1;

    // 取消待 dispatch 输入
    for (const op of proc.inputQueue) {
      op.receipt.state = "failed";
      op.receipt.errorCode = PROCESS_CANCELLED;
      await this.persistReceipt(op.key, op.receipt, op.payloadHash);
    }
    proc.inputQueue = [];
    proc.pendingInputBytes = 0;

    // 拒绝排队等待者
    while (proc.acquireWaiters.length > 0) {
      const waiter = proc.acquireWaiters.shift()!;
      waiter.reject(new ProcessError(CONTROL_REVOKED, "Process was stopped"));
    }

    proc.info.endReason = proc.info.endReason ?? "requested";
    proc.info.state = "stopping";
    proc.info.control = "closed";

    await this.persistState(id, {
      state: proc.info.state,
      control: "closed",
      controlState: "closed",
      endReason: proc.info.endReason,
    });

    // 调用底层驱动终止；真实退出状态与输出流关闭由底层观察者事件收敛
    try {
      if (proc.handle) {
        await proc.handle.terminate(input.graceMs);
      } else if (this.driver.terminate) {
        await this.driver.terminate(id, input.graceMs);
      }
    } catch (err) {
      this.recordDiagnostic(`Failed to terminate process '${id}' during stop`, err);
    }

    return { ...proc.info };
  }

  /**
   * 将进程置入隔离状态，撤销有效控制权并取消待 dispatch 的输入队列。
   */
  async quarantineProcess(
    owner: ProcessOwner,
    processId: string,
    token?: string,
    reason?: string
  ): Promise<void> {
    const proc = this.processes.get(processId);
    if (!proc) {
      return;
    }

    checkOwnerAuthorized(owner, proc.owner);

    if (token && proc.currentGrant && proc.currentGrant.token !== token) {
      return;
    }

    if (proc.info.control === "quarantined" || proc.info.control === "closed") {
      return;
    }

    proc.info.control = "quarantined";
    if (proc.ttlTimer) {
      clearTimeout(proc.ttlTimer);
      proc.ttlTimer = undefined;
    }
    proc.currentGrant = undefined;

    // 递增取消纪元：接管输入队列，使挂起中的 dispatch 放弃过期结算
    proc.cancelEpoch = (proc.cancelEpoch ?? 0) + 1;

    // 取消队列中所有待 dispatch 操作
    for (const op of proc.inputQueue) {
      op.receipt.state = "failed";
      op.receipt.errorCode = CONTROL_REVOKED;
      await this.persistReceipt(op.key, op.receipt, op.payloadHash);
    }
    proc.inputQueue = [];
    proc.pendingInputBytes = 0;

    // 拒绝排队等待者
    while (proc.acquireWaiters.length > 0) {
      const waiter = proc.acquireWaiters.shift()!;
      waiter.reject(new ProcessError(PROCESS_QUARANTINED, reason || "Process entered quarantined state"));
    }

    await this.persistState(processId, {
      control: "quarantined",
      controlState: "quarantined",
    });
  }

  /**
   * 一次性运行外部命令，收集有限输出并支持协作式取消与超时回收。
   */
  async run(
    owner: ProcessOwner,
    input: ProcessRunInput,
    call?: CallOptions
  ): Promise<ProcessRunResult> {
    checkOwnerAuthorized(owner, owner);
    await this.ensureInitialized();
    this.assertNotShutdown();

    const ioMode = input.spec.io?.mode ?? "pipe";
    if (ioMode !== "pipe") {
      throw new ProcessError(UNSUPPORTED_CAPABILITY, "Run requires IO mode to be 'pipe'");
    }

    const effectiveSpec: LaunchSpec = {
      ...input.spec,
      io: {
        ...input.spec.io,
        mode: "pipe",
      },
    };

    const runProcessId = `run-${randomUUID()}`;
    const chunks: OutputChunk[] = [];
    let totalBytes = 0;
    let truncated = false;
    let timedOut = false;
    let cancelled = false;

    let resolveExit!: (exit: { code: number | null; signal: string | null }) => void;
    let rejectError!: (err: Error) => void;
    const exitPromise = new Promise<{ code: number | null; signal: string | null }>((resolve, reject) => {
      resolveExit = resolve;
      rejectError = reject;
    });

    let driverHandle: ProcessDriverHandle | undefined;

    const callbacks: ProcessDriverCallbacks = {
      onOutput: (stream, data) => {
        if (truncated) return;
        if (stream !== "stdout" && stream !== "stderr") return;

        const remaining = input.maxOutputBytes - totalBytes;
        if (remaining <= 0) {
          truncated = true;
          if (driverHandle) {
            void driverHandle.terminate(1000);
          }
          return;
        }

        if (data.byteLength > remaining) {
          const slice = data.subarray(0, remaining);
          chunks.push({
            stream,
            data: encodeBytes(slice),
          });
          totalBytes += slice.byteLength;
          truncated = true;
          if (driverHandle) {
            void driverHandle.terminate(1000);
          }
        } else {
          chunks.push({
            stream,
            data: encodeBytes(data),
          });
          totalBytes += data.byteLength;
        }
      },
      onExit: (exit) => {
        resolveExit(exit);
      },
      onError: (err) => {
        rejectError(err);
      },
    };

    // 对齐 start 防御顺序：派生前检查取消信号，已中止直接抛出取消错误不再派生进程
    if (call?.signal?.aborted) {
      throw call.signal.reason instanceof ProcessError
        ? call.signal.reason
        : new ProcessError(PROCESS_CANCELLED, "Process run was cancelled");
    }

    driverHandle = await this.driver.spawn(runProcessId, effectiveSpec, callbacks);

    let timeoutTimer: ReturnType<typeof setTimeout> | undefined;
    if (input.timeoutMs > 0) {
      timeoutTimer = setTimeout(() => {
        timedOut = true;
        if (driverHandle) {
          void driverHandle.terminate(1000);
        }
      }, input.timeoutMs);
      if (typeof (timeoutTimer as any)?.unref === "function") {
        (timeoutTimer as any).unref();
      }
    }

    let onAbort: (() => void) | undefined;
    if (call?.signal) {
      if (call.signal.aborted) {
        if (timeoutTimer) clearTimeout(timeoutTimer);
        if (driverHandle) void driverHandle.terminate(1000);
        throw call.signal.reason ?? new ProcessError(PROCESS_CANCELLED, "Process run was cancelled");
      }
      onAbort = () => {
        cancelled = true;
        if (timeoutTimer) clearTimeout(timeoutTimer);
        if (driverHandle) void driverHandle.terminate(1000);
      };
      call.signal.addEventListener("abort", onAbort, { once: true });
    }

    try {
      const exit = await exitPromise;
      if (timeoutTimer) clearTimeout(timeoutTimer);
      if (call?.signal && onAbort) {
        call.signal.removeEventListener("abort", onAbort);
      }

      if (timedOut) {
        throw new ProcessError(PROCESS_TIMEOUT, `Process exceeded timeout of ${input.timeoutMs}ms`);
      }
      if (cancelled || call?.signal?.aborted) {
        throw call?.signal?.reason ?? new ProcessError(PROCESS_CANCELLED, "Process run was cancelled");
      }

      return {
        exit,
        chunks,
        truncated,
      };
    } catch (err: any) {
      if (timeoutTimer) clearTimeout(timeoutTimer);
      if (call?.signal && onAbort) {
        call.signal.removeEventListener("abort", onAbort);
      }
      if (timedOut) {
        throw new ProcessError(PROCESS_TIMEOUT, `Process exceeded timeout of ${input.timeoutMs}ms`);
      }
      if (cancelled || call?.signal?.aborted) {
        throw call?.signal?.reason ?? new ProcessError(PROCESS_CANCELLED, "Process run was cancelled");
      }
      throw err;
    }
  }

  /**
   * 授予指定受管进程控制令牌。
   */
  private grantControl(
    proc: ManagedProcessRecord,
    requestId: string,
    ttlMs: number,
    runId?: string
  ): ControlGrant {
    proc.controlEpoch += 1;
    const token = `tok_${proc.info.id}_${proc.controlEpoch}_${randomUUID().replace(/-/g, "")}`;
    const expiresAt = new Date(Date.now() + ttlMs).toISOString();

    proc.info.control = "held";
    proc.currentGrant = {
      token,
      epoch: proc.controlEpoch,
      ttlMs,
      expiresAt,
      runId,
      requestId,
    };

    proc.ttlTimer = setTimeout(() => {
      this.handleGrantTtlExpired(proc);
    }, ttlMs);
    if (typeof proc.ttlTimer.unref === "function") {
      proc.ttlTimer.unref();
    }

    void this.persistState(proc.info.id, {
      control: "held",
      controlState: "held",
    });

    return {
      token,
      expiresAt,
    };
  }

  /**
   * 控制权到期未释放时自动转为隔离状态。
   */
  private handleGrantTtlExpired(proc: ManagedProcessRecord): void {
    if (proc.info.control !== "held" || !proc.currentGrant) {
      return;
    }
    void this.quarantineProcess(proc.owner, proc.info.id, proc.currentGrant.token, "Control token TTL expired");
  }

  /**
   * 唤醒排队等待控制权的下一个调用者。
   */
  private wakeNextAcquireWaiter(proc: ManagedProcessRecord): void {
    if (proc.acquireWaiters.length === 0) {
      return;
    }

    const next = proc.acquireWaiters.shift()!;
    const grant = this.grantControl(proc, next.requestId, next.ttlMs, next.runId);

    const key: ProcessRequestKey = {
      hostEpoch: this.hostEpoch,
      scope: proc.scope,
      processId: proc.info.id,
      requestId: next.requestId,
    };
    const payloadHash = hashRequestPayload({ waitMs: next.waitMs, ttlMs: next.ttlMs });
    void this.persistReceipt(key, grant as any, payloadHash);

    next.resolve(grant);
  }

  /**
   * 串行调度执行输入队列操作。
   */
  private async dispatchNext(proc: ManagedProcessRecord): Promise<void> {
    if (proc.isDispatching || proc.inputQueue.length === 0) {
      return;
    }

    proc.isDispatching = true;
    try {
      while (proc.inputQueue.length > 0) {
        const op = proc.inputQueue[0];

        // dispatch 前校验 token、epoch 与授权
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
            await this.persistReceipt(op.key, op.receipt, op.payloadHash);
          }
          proc.inputQueue.shift();
          if (op.bytes && op.cancelEpoch === proc.cancelEpoch) {
            proc.pendingInputBytes -= op.bytes.byteLength;
          }
          continue;
        }

        op.receipt.state = "dispatching";
        await this.persistReceipt(op.key, op.receipt, op.payloadHash);

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
            this.refreshIdleTimer(proc);
          } catch (err) {
            // 写入返回异常时同样校验取消纪元：被接管则放弃过期结算
            if (op.cancelEpoch !== proc.cancelEpoch || proc.inputQueue[0] !== op) {
              continue;
            }
            // 若写入出现不确定失败，结果标记为 unknown，进程转入 quarantined
            op.receipt.state = "unknown";
            op.receipt.errorCode = INPUT_OUTCOME_UNKNOWN;
            await this.persistReceipt(op.key, op.receipt, op.payloadHash);
            proc.inputQueue.shift();
            proc.pendingInputBytes -= op.bytes.byteLength;
            await this.quarantineProcess(
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

            // 控制指令返回后校验取消纪元与队首位置：已被接管则放弃过期结算
            if (op.cancelEpoch !== proc.cancelEpoch || proc.inputQueue[0] !== op) {
              continue;
            }

            if (op.action.type === "input-eof") {
              proc.inputClosed = true;
              await this.persistState(proc.info.id, { inputClosed: true } as any);
            }

            op.receipt.state = "completed";
            this.refreshIdleTimer(proc);
          } catch (err: any) {
            if (op.cancelEpoch !== proc.cancelEpoch || proc.inputQueue[0] !== op) {
              continue;
            }
            op.receipt.state = "failed";
            op.receipt.errorCode = err instanceof ProcessError ? err.code : "CONTROL_FAILED";
            if (err instanceof Error && err.message) {
              op.receipt.errorMessage = err.message;
            }
            this.recordDiagnostic(`Control action '${op.action.type}' failed for request '${op.requestId}'`, err);
          }
        }

        // 结算前再次校验：若结算窗口内被 stop 或 quarantine 接管则放弃改写
        if (op.cancelEpoch !== proc.cancelEpoch || proc.inputQueue[0] !== op) {
          continue;
        }

        await this.persistReceipt(op.key, op.receipt, op.payloadHash);
        proc.inputQueue.shift();
        if (op.bytes) {
          proc.pendingInputBytes -= op.bytes.byteLength;
        }
      }
    } finally {
      proc.isDispatching = false;
    }
  }

  /**
   * 操作提交前校验持有者令牌与授权。
   */
  private checkOperationAuth(proc: ManagedProcessRecord, token: string): void {
    if (proc.info.control === "quarantined") {
      throw new ProcessError(PROCESS_QUARANTINED, "Process is in quarantined state");
    }

    if (proc.info.control !== "held" || !proc.currentGrant) {
      throw new ProcessError(ACCESS_DENIED, "Process control is not currently held");
    }

    if (proc.currentGrant.token !== token) {
      throw new ProcessError(ACCESS_DENIED, "Invalid control token");
    }

    if (new Date(proc.currentGrant.expiresAt).getTime() <= Date.now()) {
      throw new ProcessError(CONTROL_EXPIRED, "Control token has expired");
    }
  }

  /**
   * 启动空闲超时定时器。
   */
  private startIdleTimer(proc: ManagedProcessRecord): void {
    if (proc.effectiveLimits.idleMs <= 0) {
      return;
    }
    if (proc.idleTimer) {
      clearTimeout(proc.idleTimer);
    }
    proc.idleTimer = setTimeout(() => {
      this.handleIdleTimeout(proc);
    }, proc.effectiveLimits.idleMs);
    if (typeof proc.idleTimer.unref === "function") {
      proc.idleTimer.unref();
    }
  }

  /**
   * 刷新空闲超时定时器（仅在成功输入与续租时刷新，输出不刷新）。
   */
  private refreshIdleTimer(proc: ManagedProcessRecord): void {
    if (
      proc.info.state === "exited" ||
      proc.info.state === "failed" ||
      proc.info.state === "lost"
    ) {
      return;
    }
    this.startIdleTimer(proc);
  }

  /**
   * 启动硬性存活上限定时器。
   */
  private startLifetimeTimer(proc: ManagedProcessRecord): void {
    if (proc.effectiveLimits.lifetimeMs <= 0) {
      return;
    }
    proc.lifetimeTimer = setTimeout(() => {
      this.handleLifetimeTimeout(proc);
    }, proc.effectiveLimits.lifetimeMs);
    if (typeof proc.lifetimeTimer.unref === "function") {
      proc.lifetimeTimer.unref();
    }
  }

  /**
   * 处理空闲超时到期。
   */
  private handleIdleTimeout(proc: ManagedProcessRecord): void {
    if (
      proc.info.state === "exited" ||
      proc.info.state === "failed" ||
      proc.info.state === "lost"
    ) {
      return;
    }
    proc.info.endReason = "idle";
    this.stop(proc.owner, proc.info.id, {
      requestId: `idle-${randomUUID()}`,
      graceMs: 1000,
    }).catch((err: unknown) => {
      this.recordDiagnostic(`Idle timeout stop failed for process '${proc.info.id}'`, err);
    });
  }

  /**
   * 处理存活上限到期。
   */
  private handleLifetimeTimeout(proc: ManagedProcessRecord): void {
    if (
      proc.info.state === "exited" ||
      proc.info.state === "failed" ||
      proc.info.state === "lost"
    ) {
      return;
    }
    proc.info.endReason = "lifetime";
    this.stop(proc.owner, proc.info.id, {
      requestId: `lifetime-${randomUUID()}`,
      graceMs: 1000,
    }).catch((err: unknown) => {
      this.recordDiagnostic(`Lifetime timeout stop failed for process '${proc.info.id}'`, err);
    });
  }

  /**
   * 处理驱动通知的自然退出或信号退出。
   */
  private handleProcessExit(
    proc: ManagedProcessRecord,
    exit: { code: number | null; signal: string | null }
  ): void {
    if (
      proc.info.state === "exited" ||
      proc.info.state === "failed" ||
      proc.info.state === "lost"
    ) {
      return;
    }

    if (proc.idleTimer) clearTimeout(proc.idleTimer);
    if (proc.lifetimeTimer) clearTimeout(proc.lifetimeTimer);
    if (proc.ttlTimer) clearTimeout(proc.ttlTimer);

    proc.info.state = "exited";
    proc.info.control = "closed";
    proc.info.exit = { code: exit.code, signal: exit.signal };
    if (!proc.info.endReason) {
      proc.info.endReason = "natural";
    }

    proc.currentGrant = undefined;

    // 拒绝排队等待者
    while (proc.acquireWaiters.length > 0) {
      const waiter = proc.acquireWaiters.shift()!;
      waiter.reject(new ProcessError(CONTROL_REVOKED, "Process has exited"));
    }

    void this.persistState(proc.info.id, {
      state: "exited",
      control: "closed",
      controlState: "closed",
      endReason: proc.info.endReason,
      exitCode: exit.code,
      exitSignal: exit.signal,
    });

    // 启动 drain 宽限期
    proc.drainTimer = setTimeout(() => {
      if (!proc.outputLog.outputClosed) {
        proc.outputLog.closeOutput("drain-timeout");
        proc.info.outputClosed = true;
        proc.info.outputEndReason = "drain-timeout";
        void this.persistState(proc.info.id, {
          outputClosed: true,
          outputEndReason: "drain-timeout",
        });
        this.maybeEvictProcess(proc);
      }
    }, this.drainDeadlineMs);
    if (typeof proc.drainTimer.unref === "function") {
      proc.drainTimer.unref();
    }
  }

  /**
   * 处理驱动通知的输出流彻底关闭事件。
   */
  private handleOutputClosed(
    proc: ManagedProcessRecord,
    reason: "natural" | "drain-timeout" | "host-lost" = "natural"
  ): void {
    if (proc.drainTimer) {
      clearTimeout(proc.drainTimer);
      proc.drainTimer = undefined;
    }
    if (!proc.outputLog.outputClosed) {
      proc.outputLog.closeOutput(reason);
      proc.info.outputClosed = true;
      proc.info.outputEndReason = reason;
      void this.persistState(proc.info.id, {
        outputClosed: true,
        outputEndReason: reason,
      });
    }

    this.maybeEvictProcess(proc);
  }

  /**
   * 处理驱动通知的底层故障。
   */
  private handleProcessError(proc: ManagedProcessRecord, err: Error): void {
    if (
      proc.info.state === "exited" ||
      proc.info.state === "failed" ||
      proc.info.state === "lost"
    ) {
      return;
    }

    if (proc.idleTimer) clearTimeout(proc.idleTimer);
    if (proc.lifetimeTimer) clearTimeout(proc.lifetimeTimer);
    if (proc.ttlTimer) clearTimeout(proc.ttlTimer);

    proc.info.state = "failed";
    proc.info.control = "closed";
    proc.info.endReason = "natural";
    proc.outputLog.closeOutput("natural");
    proc.info.outputClosed = true;

    while (proc.acquireWaiters.length > 0) {
      const waiter = proc.acquireWaiters.shift()!;
      waiter.reject(new ProcessError(CONTROL_REVOKED, `Process error: ${err.message}`));
    }

    void this.persistState(proc.info.id, {
      state: "failed",
      control: "closed",
      controlState: "closed",
      endReason: "natural",
      outputClosed: true,
      outputEndReason: "natural",
    });

    this.maybeEvictProcess(proc);
  }

  /**
   * 加载或读取受管进程记录并校验所有者鉴权。
   */
  private async getOrLoadProcess(
    owner: ProcessOwner,
    processId: string
  ): Promise<ManagedProcessRecord> {
    const memoryProc = this.processes.get(processId);
    if (memoryProc) {
      checkOwnerAuthorized(owner, memoryProc.owner);
      return memoryProc;
    }

    const record = await this.metadataStore.getProcess(processId);
    if (!record) {
      throw new ProcessError(NOT_FOUND, `Process '${processId}' not found`, { processId });
    }

    checkOwnerAuthorized(owner, record);

    // 旧纪元非终态记录：宿主已丢失，拒绝后续操作并标记 lost
    if (
      record.hostEpoch !== this.hostEpoch &&
      record.state !== "exited" &&
      record.state !== "failed" &&
      record.state !== "lost"
    ) {
      await this.metadataStore.updateProcessState(processId, {
        state: "lost",
        controlState: "closed",
        control: "closed",
        endReason: "host-lost",
        outputClosed: true,
        outputEndReason: "host-lost",
      });
      throw new ProcessError(
        PROCESS_LOST,
        `Process '${processId}' belonged to a previous host epoch '${record.hostEpoch}' and has been marked lost; current epoch is '${this.hostEpoch}'`,
        { processId, hostEpoch: record.hostEpoch, currentHostEpoch: this.hostEpoch }
      );
    }

    const info = toSdkProcessInfo(record);
    const retainedLog = this.getRetainedOutputLog(processId);
    const tombstone = this.evictedOutputTombstones.get(processId);
    const isTerminalLoaded =
      info.state === "exited" || info.state === "failed" || info.state === "lost";
    const isOutputUnavailable =
      !retainedLog && (Boolean(tombstone) || (isTerminalLoaded && Boolean(record.outputClosed)));

    const outputLog =
      retainedLog ??
      new ProcessOutputLog(record.hostEpoch, processId, {
        maxBufferBytes: info.effectiveLimits.outputBufferBytes,
        maxWaiters: this.quotas.maxWaitersPerProcess,
      });
    if (record.outputClosed && !outputLog.outputClosed) {
      outputLog.closeOutput(record.outputEndReason as any ?? "natural");
    }

    const loaded: ManagedProcessRecord = {
      info,
      owner: {
        tenantId: record.tenantId,
        principalId: record.principalId,
        packageInstanceId: record.packageInstanceId,
        generationId: record.generationId,
      },
      scope: formatProcessScope(owner),
      outputLog,
      outputUnavailable: isOutputUnavailable,
      outputTombstone: tombstone,
      controlEpoch: 0,
      cancelEpoch: 0,
      inputQueue: [],
      pendingInputBytes: 0,
      acquireWaiters: [],
      inputClosed: Boolean(record.inputClosed),
      isDispatching: false,
      effectiveLimits: info.effectiveLimits,
    };

    // 终态且输出已关闭的记录不再回填内存表，保持终态驱逐语义
    if (isTerminalLoaded && info.outputClosed) {
      return loaded;
    }

    this.processes.set(processId, loaded);
    return loaded;
  }

  /**
   * 记录已淘汰输出日志的墓碑信息（保留最近 2048 条，防止内存无限积压）。
   */
  private recordTombstone(processId: string, tombstone: EvictedOutputTombstone): void {
    if (this.evictedOutputTombstones.size >= 2048) {
      const oldestKey = this.evictedOutputTombstones.keys().next().value;
      if (oldestKey) {
        this.evictedOutputTombstones.delete(oldestKey);
      }
    }
    this.evictedOutputTombstones.set(processId, tombstone);
  }

  /**
   * 清理已过期的终态输出日志条目。
   */
  private cleanExpiredTerminalLogs(): void {
    const now = Date.now();
    for (const [id, entry] of this.evictedOutputLogs.entries()) {
      if (now - entry.evictedAt > this.terminalLogRetentionMs) {
        this.recordTombstone(id, {
          tailCursor: entry.log.tailCursor,
          earliestCursor: entry.log.earliestCursor,
          evictedAt: now,
        });
        this.evictedOutputLogs.delete(id);
      }
    }
  }

  /**
   * 统计终态保留日志当前在内存中实际占用的输出缓冲字节总数。
   */
  private countRetainedOutputBufferBytes(): number {
    this.cleanExpiredTerminalLogs();
    let bytes = 0;
    for (const entry of this.evictedOutputLogs.values()) {
      bytes += entry.log.currentBytes;
    }
    return bytes;
  }

  /**
   * 将终态输出日志存入保留缓存，并根据宿主配额执行 LRU 与 TTL 淘汰。
   */
  private retainTerminalOutputLog(processId: string, log: ProcessOutputLog): void {
    this.cleanExpiredTerminalLogs();

    // 若新加入条目会导致总输出配额超限或数量超限，按 LRU 顺序淘汰最旧条目
    while (
      (this.countRetainedOutputBufferBytes() + log.currentBytes > this.quotas.maxOutputBufferBytesPerHost ||
        this.evictedOutputLogs.size >= 512) &&
      this.evictedOutputLogs.size > 0
    ) {
      const oldestKey = this.evictedOutputLogs.keys().next().value;
      if (!oldestKey) break;
      const oldestEntry = this.evictedOutputLogs.get(oldestKey);
      if (oldestEntry) {
        this.recordTombstone(oldestKey, {
          tailCursor: oldestEntry.log.tailCursor,
          earliestCursor: oldestEntry.log.earliestCursor,
          evictedAt: Date.now(),
        });
      }
      this.evictedOutputLogs.delete(oldestKey);
    }

    this.evictedOutputLogs.set(processId, {
      log,
      evictedAt: Date.now(),
    });
  }

  /**
   * 获取终态保留日志（附带过期清理与 LRU 触达更新）。
   */
  private getRetainedOutputLog(processId: string): ProcessOutputLog | undefined {
    this.cleanExpiredTerminalLogs();
    const entry = this.evictedOutputLogs.get(processId);
    if (!entry) return undefined;
    // 触达刷新 LRU 顺序
    this.evictedOutputLogs.delete(processId);
    this.evictedOutputLogs.set(processId, entry);
    return entry.log;
  }

  /**
   * 终态驱逐与驱动释放：进程到达终态且输出已关闭后移除内存记录，
   * 并防御性释放底层驱动句柄（失败仅记录诊断不中断）。
   */
  private maybeEvictProcess(proc: ManagedProcessRecord): void {
    const isTerminal =
      proc.info.state === "exited" || proc.info.state === "failed" || proc.info.state === "lost";
    if (!isTerminal || !proc.info.outputClosed) {
      return;
    }

    // 仍存在排队等待者或未结算输入时暂缓驱逐
    if (proc.acquireWaiters.length > 0 || proc.inputQueue.length > 0) {
      return;
    }

    this.processes.delete(proc.info.id);

    // 保留输出日志支撑后续游标读取（内存输出无法从持久层恢复）
    this.retainTerminalOutputLog(proc.info.id, proc.outputLog);

    if (proc.handle && typeof this.driver.dispose === "function") {
      try {
        const disposed = this.driver.dispose(proc.handle as any);
        if (disposed && typeof (disposed as any).catch === "function") {
          (disposed as Promise<void>).catch((err: unknown) => {
            this.recordDiagnostic(`Driver dispose failed for process '${proc.info.id}'`, err);
          });
        }
      } catch (err) {
        this.recordDiagnostic(`Driver dispose failed for process '${proc.info.id}'`, err);
      }
    }
  }

  /**
   * 启动受管进程时的配额容量校验。
   */
  private checkSpawnQuotas(scope: string, requestedBufferBytes?: number): void {
    let scopeActive = 0;
    let hostActive = 0;
    let totalBuffer = 0;

    for (const p of this.processes.values()) {
      if (
        p.info.state === "starting" ||
        p.info.state === "running" ||
        p.info.state === "stopping"
      ) {
        hostActive += 1;
        totalBuffer += p.effectiveLimits.outputBufferBytes;
        if (p.scope === scope) {
          scopeActive += 1;
        }
      }
    }

    if (scopeActive >= this.quotas.maxActiveProcessesPerScope) {
      throw new ProcessError(QUOTA_EXCEEDED, "Scope active process quota exceeded", {
        scope,
        limit: this.quotas.maxActiveProcessesPerScope,
      });
    }

    if (hostActive >= this.quotas.maxActiveProcessesPerHost) {
      throw new ProcessError(QUOTA_EXCEEDED, "Host active process quota exceeded", {
        limit: this.quotas.maxActiveProcessesPerHost,
      });
    }

    const perProcBuf = requestedBufferBytes ?? this.defaultLimits.outputBufferBytes;
    if (perProcBuf > this.quotas.maxOutputBufferBytesPerProcess) {
      throw new ProcessError(QUOTA_EXCEEDED, "Output buffer per process quota exceeded", {
        requested: perProcBuf,
        limit: this.quotas.maxOutputBufferBytesPerProcess,
      });
    }

    // 终态保留输出日志实际占用字节数纳入宿主预算
    totalBuffer += this.countRetainedOutputBufferBytes();

    // 若新进程申请的缓冲使总预算超限，优先淘汰已有的终态保留日志（LRU 策略）
    while (
      totalBuffer + perProcBuf > this.quotas.maxOutputBufferBytesPerHost &&
      this.evictedOutputLogs.size > 0
    ) {
      const oldestKey = this.evictedOutputLogs.keys().next().value;
      if (!oldestKey) break;
      const oldest = this.evictedOutputLogs.get(oldestKey);
      if (oldest) {
        this.recordTombstone(oldestKey, {
          tailCursor: oldest.log.tailCursor,
          earliestCursor: oldest.log.earliestCursor,
          evictedAt: Date.now(),
        });
        totalBuffer -= oldest.log.currentBytes;
      }
      this.evictedOutputLogs.delete(oldestKey);
    }

    if (totalBuffer + perProcBuf > this.quotas.maxOutputBufferBytesPerHost) {
      throw new ProcessError(QUOTA_EXCEEDED, "Host output buffer quota exceeded", {
        limit: this.quotas.maxOutputBufferBytesPerHost,
      });
    }
  }

  /**
   * 统计当前宿主所有活跃进程累计排队等待控制权的调用者总数。
   */
  private countHostAcquireWaiters(): number {
    let total = 0;
    for (const p of this.processes.values()) {
      total += p.acquireWaiters.length;
    }
    return total;
  }

  /**
   * 统计当前宿主所有活跃进程累计输入队列待写入字节总数。
   */
  private countHostPendingInputBytes(): number {
    let total = 0;
    for (const p of this.processes.values()) {
      total += p.pendingInputBytes;
    }
    return total;
  }
}
