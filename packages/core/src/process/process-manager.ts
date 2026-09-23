import { createHash } from "node:crypto";
import {
  decodeBytes,
  encodeBytes,
  type CallOptions,
  type ControlGrant,
  type ControlState,
  type Limits,
  type Logger,
  type OperationReceipt,
  type OutputChunk,
  type ProcessAcquireInput,
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
  CONTROL_REVOKED,
  INPUT_VALIDATION_FAILED,
  NOT_FOUND,
  PROCESS_CANCELLED,
  PROCESS_LOST,
  PROCESS_QUARANTINED,
  PROCESS_SPAWN_ERROR,
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
import { ControlArbiter } from "./control-arbiter";
import { InputDispatcher } from "./input-dispatcher";
import { DiagnosticsSink } from "./diagnostics-sink";
import type {
  ProcessDriver,
  ProcessObserver,
} from "./driver";
import {
  MemoryProcessMetadataStore,
  type ProcessMetadataStore,
  type ProcessOwnerFilter,
  type ProcessRequestKey,
  type StoredProcessRecord,
} from "./metadata-store";
import type {
  ManagedProcessRecord,
  ProcessOwner,
} from "./managed-record";
import { ProcessOutputLog, type OutputChunk as InternalOutputChunk } from "./output-log";
import {
  ReservationTable,
  type RequestReservation,
} from "./reservation-table";
import { RunExecutor } from "./run-executor";
import { TerminalOutputCache } from "./terminal-output-cache";

export type {
  ManagedProcessRecord,
  QueuedOperation,
  AcquireWaiter,
  ProcessOwner,
} from "./managed-record";

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

  private processes = new Map<string, ManagedProcessRecord>();
  /** 内部诊断日志汇聚器：未注入 logger 时保留最近的持久化与驱动错误，避免静默吞没异常 */
  private readonly diagnosticsSink: DiagnosticsSink;
  /** 同步幂等预占表：以复合键在异步落盘窗口内锁定并发重复请求 */
  private readonly reservationTable: ReservationTable;
  /** 终态输出日志保留缓存：附带 TTL 过期回收与 LRU 淘汰，及墓碑登记 */
  private readonly terminalOutputCache: TerminalOutputCache;
  /** 一次性 run 执行器：仅依赖驱动、错误映射与输入校验，不触碰进程注册表 */
  private readonly runExecutor: RunExecutor;
  /** 控制权仲裁器：独占控制权状态机全部推进路径的唯一持有者 */
  private readonly controlArbiter: ControlArbiter;
  /** 输入调度器：输入队列入队、串行调度与接管原语的唯一持有者 */
  private readonly inputDispatcher: InputDispatcher;
  private initPromise: Promise<number> | undefined;
  private isShutdown = false;

  constructor(options: ProcessManagerOptions) {
    this.hostEpoch = options.hostEpoch ?? `epoch-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
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
    this.diagnosticsSink = new DiagnosticsSink({ logger: options.logger });
    this.reservationTable = new ReservationTable();
    this.terminalOutputCache = new TerminalOutputCache({
      retentionMs: this.terminalLogRetentionMs,
      maxHostBufferBytes: this.quotas.maxOutputBufferBytesPerHost,
    });
    this.runExecutor = new RunExecutor(this.driver);
    this.controlArbiter = new ControlArbiter({
      persistState: (processId, patch) => this.persistState(processId, patch),
      persistGrantReceipt: (grant, wait, proc) => this.persistReceipt(
        {
          hostEpoch: this.hostEpoch,
          scope: proc.scope,
          processId: proc.info.id,
          requestId: wait.requestId,
        },
        grant as any,
        hashRequestPayload({ waitMs: wait.waitMs, ttlMs: wait.ttlMs })
      ),
      refreshIdleTimer: (proc) => this.refreshIdleTimer(proc),
      quarantineProcess: (owner, processId, token, reason) =>
        this.quarantineProcess(owner, processId, token, reason),
      countHostAcquireWaiters: () => this.countHostAcquireWaiters(),
      maxWaitersPerProcess: this.quotas.maxWaitersPerProcess,
      maxWaitersPerHost: this.quotas.maxWaitersPerHost,
    });
    this.inputDispatcher = new InputDispatcher(
      {
        persistReceipt: (key, receipt, payloadHash) =>
          this.persistReceipt(key, receipt, payloadHash),
        persistState: (processId, patch) => this.persistState(processId, patch),
        quarantineProcess: (owner, processId, token, reason) =>
          this.quarantineProcess(owner, processId, token, reason),
        refreshIdleTimer: (proc) => this.refreshIdleTimer(proc),
        recordDiagnostic: (message, err) => this.recordDiagnostic(message, err),
        countHostPendingInputBytes: () => this.countHostPendingInputBytes(),
        maxPendingQueueBytesPerProcess: this.quotas.maxPendingQueueBytesPerProcess,
        maxPendingQueueBytesPerHost: this.quotas.maxPendingQueueBytesPerHost,
      },
      this.controlArbiter
    );
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
    this.diagnosticsSink.record(message, err);
  }

  /**
   * 获取最近的内部诊断日志快照（最近条目在前）。
   */
  get recentDiagnostics(): string[] {
    return this.diagnosticsSink.recent();
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
   * 实现委托给独立持有的预占表，语义详见 ReservationTable.reserve。
   */
  private reserveRequest(
    key: ProcessRequestKey,
    payloadHash: string,
    operation: string
  ): RequestReservation | undefined {
    return this.reservationTable.reserve(key, payloadHash, operation);
  }

  private commitReservation(key: ProcessRequestKey, operation: string, value: unknown): void {
    this.reservationTable.commit(key, operation, value);
  }

  private rejectReservation(key: ProcessRequestKey, operation: string, err: unknown): void {
    this.reservationTable.reject(key, operation, err);
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

    this.reservationTable.rejectAll(new ProcessError(PROCESS_CANCELLED, "Process manager has been shut down"));
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
    return new ContextProcessAPI(this, owner, runId ?? crypto.randomUUID(), signal, Boolean(runId));
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

      const processId = `proc-${crypto.randomUUID()}`;
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
        const observer: ProcessObserver = {
          processId,
          output: (stream, data) => {
            procRecord.outputLog.append(stream, data);
          },
          exited: (exit) => {
            this.handleProcessExit(procRecord, exit);
          },
          outputClosed: (reason) => {
            this.handleOutputClosed(procRecord, reason);
          },
          fault: (err) => {
            this.handleProcessError(procRecord, err);
          },
        };

        if (call?.signal?.aborted) {
          throw call.signal.reason instanceof ProcessError
            ? call.signal.reason
            : new ProcessError(PROCESS_CANCELLED, "Process start was cancelled");
        }

        const spawnPromise = this.driver.spawn(input.spec, observer);
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
            procRecord.handle = (await Promise.race([spawnPromise, abortPromise])) as any;
          } catch (raceErr) {
            void spawnPromise
              .then((h) => {
                if (h) {
                  void this.driver.terminate(h, 0);
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
          procRecord.handle = (await spawnPromise) as any;
        }

        if (call?.signal?.aborted) {
          if (procRecord.handle) {
            await this.driver.terminate(procRecord.handle, 0);
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
    } catch (err) {
      // 失败路径：以原始错误结算预占，等待同 requestId 的并发调用方收到真实失败原因而非固定冲突错误
      this.rejectReservation(key, "start", err);
      throw err;
    } finally {
      // 成功路径已在 commit 中移除预占；失败路径已在 catch 中以原始错误结算；
      // 此处仅为既未 commit 也未 reject 的异常逃逸路径释放预占并唤醒等待方
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

      // 控制权仲裁：空闲且无等待者时直接授予，否则 FIFO 排队等待
      // 排队路径凭据由唤醒方落盘；原请求 resolve 后在此处结算预约，保持两阶段时序不变
      const outcome = this.controlArbiter.tryAcquire(
        proc,
        { requestId: input.requestId, waitMs: input.waitMs, ttlMs: input.ttlMs },
        call,
        runId
      );
      const grant = await outcome.waiter!;
      if (outcome.granted) {
        await this.metadataStore.recordRequest(key, grant as any, payloadHash);
      }
      this.commitReservation(key, "acquire", grant);
      return grant;
    } catch (err) {
      // 失败路径：以原始错误结算预占，等待同 requestId 的并发调用方收到真实失败原因而非固定冲突错误
      this.rejectReservation(key, "acquire", err);
      throw err;
    } finally {
      // 成功路径已在 commit 中移除预占；失败路径已在 catch 中以原始错误结算；
      // 此处仅为既未 commit 也未 reject 的异常逃逸路径释放预占并唤醒等待方
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

    // 提交前校验持有凭据有效性，随后由仲裁器清理旧定时器并设置新定时器
    this.controlArbiter.validateHeldGrant(proc, token);

    return this.controlArbiter.renewGrant(proc, ttlMs);
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

    // 提交前校验持有凭据有效性
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

    // 仲裁器完成清理定时器、凭据置空与唯一唤醒下一个等待者
    this.controlArbiter.releaseGrant(proc);
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

      // 输入调度器同步阶段完成授权校验与队列容量预扣，异步阶段落盘入队
      const rawBytes = decodeBytes(input.data);
      const queued = await this.inputDispatcher.enqueueWrite(proc, {
        requestId: input.requestId,
        token: input.token,
        data: rawBytes,
        key,
        payloadHash,
      });

      this.commitReservation(key, "write", queued);
      return queued;
    } catch (err) {
      // 失败路径：以原始错误结算预占，等待同 requestId 的并发调用方收到真实失败原因而非固定冲突错误
      this.rejectReservation(key, "write", err);
      throw err;
    } finally {
      // 成功路径已在 commit 中移除预占；失败路径已在 catch 中以原始错误结算；
      // 此处仅为既未 commit 也未 reject 的异常逃逸路径释放预占并唤醒等待方
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

      // 校验能力支持（能力归属管理器，在调度器入队前完成）
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

      // 输入调度器完成授权校验、落盘与入队
      const queued = await this.inputDispatcher.enqueueControl(proc, {
        requestId: input.requestId,
        token: input.token,
        action: input.action,
        key,
        payloadHash,
      });

      this.commitReservation(key, "control", queued);
      return queued;
    } catch (err) {
      // 失败路径：以原始错误结算预占，等待同 requestId 的并发调用方收到真实失败原因而非固定冲突错误
      this.rejectReservation(key, "control", err);
      throw err;
    } finally {
      // 成功路径已在 commit 中移除预占；失败路径已在 catch 中以原始错误结算；
      // 此处仅为既未 commit 也未 reject 的异常逃逸路径释放预占并唤醒等待方
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
      const tombstone = proc.outputTombstone ?? this.terminalOutputCache.getTombstone(id);

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
    this.controlArbiter.disposeProcess(proc);

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

    // 调度器同步原子接管输入队列：纪元递增、标记失败、登记落盘、清空与字节归零
    this.inputDispatcher.takeoverQueue(proc, PROCESS_CANCELLED);

    // 终态拒绝全部排队等待者
    this.controlArbiter.revokeAllWaiters(proc, {
      code: CONTROL_REVOKED,
      message: "Process was stopped",
    });

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
        await this.driver.terminate(proc.handle, input.graceMs);
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

    // 调度器同步原子接管输入队列：纪元递增、标记失败、登记落盘、清空与字节归零
    this.inputDispatcher.takeoverQueue(proc, CONTROL_REVOKED);

    // 终态拒绝全部排队等待者
    this.controlArbiter.revokeAllWaiters(proc, {
      code: PROCESS_QUARANTINED,
      message: reason || "Process entered quarantined state",
    });

    await this.persistState(processId, {
      control: "quarantined",
      controlState: "quarantined",
    });
  }

  /**
   * 一次性运行外部命令，收集有限输出并支持协作式取消与超时回收。
   * 实现委托给独立持有的一次性 run 执行器，不触碰受管进程注册表。
   */
  async run(
    owner: ProcessOwner,
    input: ProcessRunInput,
    call?: CallOptions
  ): Promise<ProcessRunResult> {
    checkOwnerAuthorized(owner, owner);
    await this.ensureInitialized();
    this.assertNotShutdown();

    return this.runExecutor.execute(input, call);
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
      requestId: `idle-${crypto.randomUUID()}`,
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
      requestId: `lifetime-${crypto.randomUUID()}`,
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

    // 终态拒绝全部排队等待者（单一入口）
    this.controlArbiter.revokeAllWaiters(proc, {
      code: CONTROL_REVOKED,
      message: "Process has exited",
    });

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

    // 终态拒绝全部排队等待者（单一入口）
    this.controlArbiter.revokeAllWaiters(proc, {
      code: CONTROL_REVOKED,
      message: `Process error: ${err.message}`,
    });

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
    const retainedLog = this.terminalOutputCache.get(processId);
    const tombstone = this.terminalOutputCache.getTombstone(processId);
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
   * 统计终态保留日志当前在内存中实际占用的输出缓冲字节总数。
   */
  private countRetainedOutputBufferBytes(): number {
    return this.terminalOutputCache.retainedBytes();
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
    this.terminalOutputCache.retain(proc.info.id, proc.outputLog);

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
    const retainedBefore = this.countRetainedOutputBufferBytes();
    totalBuffer += retainedBefore;

    // 若新进程申请的缓冲使总预算超限，优先淘汰已有的终态保留日志（LRU 策略）
    // 淘汰门槛为宿主预算扣除活跃进程已占字节与新申请字节，淘汰释放的字节数同步回扣宿主预算
    if (totalBuffer + perProcBuf > this.quotas.maxOutputBufferBytesPerHost) {
      const activeBufferBytes = totalBuffer - retainedBefore;
      const evictedBytes = this.terminalOutputCache.evictLRUUntil(
        this.quotas.maxOutputBufferBytesPerHost - perProcBuf - activeBufferBytes
      );
      totalBuffer -= evictedBytes;
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
