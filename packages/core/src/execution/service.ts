import { randomUUID } from "node:crypto";
import type {
  ActionDefinition,
  ActionRef,
  ExecutionEvent,
  ExecutionResult,
  JsonValue,
  Logger,
  ProcessAPI,
  ProgressReporter,
  RunRecord,
  RunStatus,
  RuntimeError,
} from "@actiondock/sdk";
import { ActionResolver } from "../catalog/action-resolver";
import { computeDigest } from "../project/digest";
import type { ProjectConfig } from "../project/types";
import type { Clock } from "../runtime/clock";
import { type EventSink, InMemoryEventSink } from "../runtime/events";
import { ActionRunner, type ExecutionHandle } from "../runtime/runner";
import {
  ACTION_CANCELLED,
  ACTION_NOT_FOUND,
  ACTION_TIMEOUT,
  EXECUTION_FAILED,
  IDEMPOTENCY_CONFLICT,
  RUN_REPOSITORY_UNAVAILABLE,
  UNHANDLED_EXECUTION_ERROR,
  describeActionLoadFailure,
} from "../errors";
import type { RuntimeStorage } from "../storage/types";
import type { RuntimePlatform } from "../platform/types";
import type {
  CancelResult,
  ExecuteOptions,
  ExecutionService,
  ExecutionServiceOptions,
  ExecutionTicket,
} from "./types";

export type { ExecutionServiceOptions };

interface ActiveRun {
  runId: string;
  handle: ExecutionHandle;
  controller: AbortController;
  status: RunStatus;
  startedAt: string;
  signal?: AbortSignal;
  onAbort?: () => void;
}

/**
 * 执行事件桥：单次执行的事件发射、进度报告器与双写日志适配器集合。
 */
interface ExecutionEventBridge {
  /** 发射单条执行生命周期事件（自动分配递增序号与时间戳） */
  emitEvent(payload:
    | { type: "log"; level: "debug" | "info" | "warn" | "error"; message: string; data?: JsonValue }
    | { type: "progress"; current?: number; total?: number; message?: string }
    | { type: "status"; status: RunStatus }
    | { type: "finish"; result: ExecutionResult }): void;
  /** 进度报告器（转发外部进度并发射 progress 事件） */
  progressReporter: ProgressReporter;
  /** 双写日志适配器（同时写入外部 logger 与事件流） */
  executionLogger: Logger;
}

/**
 * 统一执行协调服务实现。
 */
export class DefaultExecutionService implements ExecutionService {
  private packageId: string;
  private storage: RuntimeStorage;
  private projectConfig?: ProjectConfig;
  public readonly eventSink: EventSink;
  private maxActiveRuns: number;
  private ownerId: string;
  public hostSessionId?: string;
  private _runner: ActionRunner;
  private logger?: Logger;
  private clock?: Clock;
  private process?: ProcessAPI;
  private platform?: RuntimePlatform;
  private actionResolver?: (ref: ActionRef | string) => ActionDefinition | undefined | Promise<ActionDefinition | undefined>;
  private activeRuns = new Map<string, ActiveRun>();
  private isClosing = false;
  private ownsStorage: boolean;
  private ownsGlobalStorage: boolean;
  private globalStorage?: RuntimeStorage;

  constructor(options: ExecutionServiceOptions) {
    this.platform = options.platform;
    this.packageId = options.packageId;
    this.hostSessionId = options.hostSessionId;
    this.projectConfig = options.projectConfig;
    this.eventSink = options.eventSink || (options.platform as any)?.eventSink || new InMemoryEventSink();
    this.maxActiveRuns = options.maxActiveRuns || 32;
    this.ownerId = options.ownerId || `host-${randomUUID().slice(0, 8)}`;
    this.actionResolver = options.actionResolver;
    this.logger = options.logger;

    if (options.platform) {
      this.clock = options.platform.clock;
      this.process = options.platform.process;
      this.storage =
        options.storage ??
        options.platform.storage.createStorage(this.packageId, {
          projectRoot: options.projectRoot,
          customHome: options.customHome,
        });
    } else {
      this.clock = options.clock;
      this.process = options.process;
      if (!options.storage) {
        throw new Error("ExecutionService requires either 'storage' or 'platform' option");
      }
      this.storage = options.storage;
    }

    const globalStorage = options.platform
      ? (options.globalStorage ?? options.platform.storage.createGlobalStorage({ customHome: options.customHome }))
      : options.globalStorage;

    this.ownsStorage = !options.storage;
    this.ownsGlobalStorage = !options.globalStorage && !!options.platform;
    this.globalStorage = globalStorage;

    this._runner = new ActionRunner({
      packageId: this.packageId,
      hostSessionId: this.hostSessionId,
      storage: this.storage,
      globalStorage,
      projectRoot: options.projectRoot,
      projectConfig: this.projectConfig,
      configOverrides: options.configOverrides,
      actions: options.actions,
      process: this.process,
      clock: this.clock,
      platform: options.platform,
      maxCallDepth: options.maxCallDepth,
      maxSubRuns: options.maxSubRuns,
      actionResolver: (ref, currentPkgId) => {
        const parsed = typeof ref === "string" ? ActionResolver.parseRef(ref) : ref;
        if (parsed.packageId && parsed.packageId !== this.packageId) {
          return undefined;
        }
        if (currentPkgId && currentPkgId !== this.packageId) {
          return undefined;
        }
        return this.actionResolver ? this.actionResolver(parsed) : undefined;
      },
      getStorageForPackage: options.getStorageForPackage,
      packageContextResolver: options.packageContextResolver,
      customHome: options.customHome,
    });
  }

  public get runner(): ActionRunner {
    return this._runner;
  }

  public registerAction(id: string, action: ActionDefinition): void;
  public registerAction(action: ({ id: string; action?: ActionDefinition } & Partial<ActionDefinition>) | ActionDefinition): void;
  public registerAction(
    idOrAction: string | (({ id: string; action?: ActionDefinition } & Partial<ActionDefinition>) | ActionDefinition),
    actionDef?: ActionDefinition
  ): void {
    if (typeof idOrAction === "string") {
      this._runner.registerAction(idOrAction, actionDef!);
    } else {
      this._runner.registerAction(idOrAction);
    }
  }

  public getAction(id: string): ActionDefinition | undefined {
    return this._runner.getAction(id);
  }

  public listActions(): ActionDefinition[] {
    return this._runner.listActions();
  }

  public getActiveHandle(runId: string): ExecutionHandle | undefined {
    return this.activeRuns.get(runId)?.handle;
  }

  public setPackageContextResolver(resolver: any): void {
    this._runner.setPackageContextResolver(resolver);
  }

  private async resolveTargetAction(ref: ActionRef | string): Promise<ActionDefinition | undefined> {
    const parsed = typeof ref === "string" ? ActionResolver.parseRef(ref) : ref;
    const actionId = parsed.actionId;
    const targetPackageId = parsed.packageId || this.packageId;
    let runner = this._runner;
    if (targetPackageId !== this.packageId) {
      const targetRunner = await this._runner.resolveTargetPackageRunner(targetPackageId);
      if (!targetRunner) return undefined;
      runner = targetRunner;
    }
    const fromRunner = runner.getAction(actionId);
    if (fromRunner) return fromRunner;
    if (this.actionResolver && targetPackageId === this.packageId) {
      return this.actionResolver(parsed);
    }
    return undefined;
  }

  async execute(
    ref: ActionRef | string,
    input: JsonValue,
    options: ExecuteOptions = {}
  ): Promise<ExecutionResult> {
    const ticket = await this.start(ref, input, options);
    if (!ticket.result) {
      throw new Error(`Execution ticket for run '${ticket.runId}' has no result Promise`);
    }
    return ticket.result;
  }

  async start(
    ref: ActionRef | string,
    input: JsonValue,
    options: ExecuteOptions = {}
  ): Promise<ExecutionTicket> {
    if (this.isClosing) {
      throw new Error("ExecutionService is closing: new tasks rejected");
    }

    if (this.activeRuns.size >= this.maxActiveRuns) {
      throw new Error(
        `Concurrency limit reached: ${this.activeRuns.size}/${this.maxActiveRuns} active runs`
      );
    }

    let parsedRef: ActionRef;
    try {
      parsedRef = ActionResolver.parseRef(ref);
    } catch {
      parsedRef = typeof ref === "object" ? ref : { actionId: ref };
    }
    const targetActionId = parsedRef.actionId;
    const targetPackageId = parsedRef.packageId || this.packageId;
    const actionRef = `${targetPackageId}/${targetActionId}`;
    const effectiveClock = options.platform?.clock ?? this.clock;

    // requestId 幂等检查与去重处理
    const gateResult = await this.checkIdempotencyGate(
      input,
      options,
      actionRef,
      effectiveClock
    );
    if (gateResult.ticket) {
      return gateResult.ticket;
    }
    const designatedRunId = gateResult.designatedRunId;

    const target = await this.resolveExecutionTarget(parsedRef, targetPackageId, targetActionId);
    if (!target.action) {
      return this.failTicketForMissingAction({
        target,
        input,
        options,
        targetPackageId,
        targetActionId,
        designatedRunId,
        effectiveClock,
      });
    }

    const controller = new AbortController();
    let onAbort: (() => void) | undefined;
    if (options.signal && typeof options.signal.addEventListener === "function") {
      if (options.signal.aborted) {
        controller.abort(options.signal.reason);
      } else {
        onAbort = () => controller.abort(options.signal?.reason);
        options.signal.addEventListener(
          "abort",
          onAbort,
          { once: true }
        );
      }
    }

    const runId = designatedRunId || randomUUID();
    const bridge = this.createEventBridge({ runId, options, effectiveClock });

    this.registerResolvedAction(target.runner, targetPackageId, targetActionId, target.action);
    const handle = target.runner.start(targetActionId, input, {
      runId,
      rootRunId: options.rootRunId,
      parentRunId: options.parentRunId,
      hostSessionId: options.hostSessionId || this.hostSessionId,
      maxCallDepth: options.maxCallDepth,
      configOverrides: options.config as Record<string, unknown> | undefined,
      signal: controller.signal,
      timeoutMs: options.timeoutMs,
      progress: bridge.progressReporter,
      logger: bridge.executionLogger,
      process: options.process || options.platform?.process || this.process,
      platform: options.platform || this.platform,
    });

    const activeItem: ActiveRun = {
      runId: handle.runId,
      handle,
      controller,
      status: "running",
      startedAt: (effectiveClock?.now() ?? new Date()).toISOString(),
      signal: options.signal,
      onAbort,
    };

    this.activeRuns.set(handle.runId, activeItem);
    bridge.emitEvent({ type: "status", status: "running" });

    this.watchHandleCompletion(handle, activeItem, bridge);

    return {
      runId: handle.runId,
      status: "running",
      result: handle.result,
    };
  }

  /**
   * 幂等门检查：digest 计算与冲突/重复分流（重复命中时直接返回已有票据）。
   */
  private async checkIdempotencyGate(
    input: JsonValue,
    options: ExecuteOptions,
    actionRef: string,
    effectiveClock?: Clock
  ): Promise<{ ticket?: ExecutionTicket; designatedRunId?: string }> {
    if (!options.requestId) {
      return {};
    }

    const digestPayload = {
      input,
      config: options.config,
      timeoutMs: options.timeoutMs,
    };
    const inputDigest = computeDigest(digestPayload);
    const provisionalRunId = randomUUID();

    if (!this.storage.checkAndRecordIdempotency) {
      return {};
    }

    const idemp = this.storage.checkAndRecordIdempotency({
      ownerId: this.ownerId,
      actionRef,
      requestId: options.requestId,
      inputDigest,
      runId: provisionalRunId,
      createdAt: (effectiveClock?.now() ?? new Date()).toISOString(),
    });

    if (idemp.outcome === "conflict") {
      const conflictError: RuntimeError = {
        code: IDEMPOTENCY_CONFLICT,
        message: `Idempotency conflict for requestId '${options.requestId}': input parameters digest mismatch`,
        details: {
          requestId: options.requestId,
          actionRef,
          expectedDigest: idemp.existingDigest,
          actualDigest: inputDigest,
        },
      };
      const err = new Error(conflictError.message);
      (err as any).code = conflictError.code;
      (err as any).details = conflictError.details;
      throw err;
    }

    if (idemp.outcome === "duplicate") {
      const existingRunId = idemp.runId;
      const active = this.activeRuns.get(existingRunId);
      if (active) {
        return {
          ticket: {
            runId: existingRunId,
            status: active.status,
            result: active.handle.result,
          },
        };
      }
      const record = await this.get(existingRunId);
      if (record) {
        const execRes: ExecutionResult =
          record.status === "success"
            ? { ok: true, runId: existingRunId, data: record.output ?? null }
            : {
                ok: false,
                runId: existingRunId,
                error: record.error || {
                  code: EXECUTION_FAILED,
                  message: `Run terminated with status '${record.status}'`,
                },
              };
        return {
          ticket: {
            runId: existingRunId,
            status: record.status,
            result: Promise.resolve(execRes),
          },
        };
      }
    }

    return { designatedRunId: provisionalRunId };
  }

  /**
   * 解析执行目标：确定目标 Runner 并解析目标 Action 定义。
   */
  private async resolveExecutionTarget(
    parsedRef: ActionRef,
    targetPackageId: string,
    targetActionId: string
  ): Promise<{ runner: ActionRunner; action?: ActionDefinition; resolveError?: RuntimeError }> {
    let runnerToUse: ActionRunner = this._runner;
    let resolveError: RuntimeError | undefined;

    if (targetPackageId && targetPackageId !== this.packageId) {
      const targetRunner = await this._runner.resolveTargetPackageRunner(targetPackageId);
      if (targetRunner) {
        runnerToUse = targetRunner;
      } else {
        resolveError = {
          code: ACTION_NOT_FOUND,
          message: `Target package '${targetPackageId}' not found or unresolvable`,
        };
      }
    }

    let action: ActionDefinition | undefined;
    if (!resolveError) {
      action = runnerToUse.getAction(targetActionId) || runnerToUse.getAction(`${targetPackageId}/${targetActionId}`);

      if (!action) {
        const resolution = await runnerToUse.resolveAction(parsedRef);
        if (resolution.status === "found") {
          action = resolution.action;
        } else if (resolution.status === "load_failed") {
          resolveError = describeActionLoadFailure(resolution.error, {
            actionId: targetActionId,
            packageId: resolution.packageId,
            projectRoot: resolution.projectRoot,
          });
        } else {
          const targetAction = await this.resolveTargetAction(parsedRef);
          if (targetAction) {
            action = targetAction;
          } else {
            resolveError = {
              code: ACTION_NOT_FOUND,
              message: `Action '${targetActionId}' not found in package '${targetPackageId}'`,
              details: resolution.reason ? { reason: resolution.reason } : undefined,
            };
          }
        }
      }
    }

    return { runner: runnerToUse, action, resolveError };
  }

  /**
   * 注册解析成功的目标 Action 至目标 Runner（收敛为单一注册入口）。
   */
  private registerResolvedAction(
    runner: ActionRunner,
    targetPackageId: string,
    targetActionId: string,
    action: ActionDefinition
  ): void {
    runner.registerAction(targetActionId, action);
  }

  /**
   * 目标 Action 缺失时的失败票据：落库 failed 记录并补发 status 与 finish 事件。
   */
  private failTicketForMissingAction(args: {
    target: { runner: ActionRunner; resolveError?: RuntimeError };
    input: JsonValue;
    options: ExecuteOptions;
    targetPackageId: string;
    targetActionId: string;
    designatedRunId?: string;
    effectiveClock?: Clock;
  }): ExecutionTicket {
    const { target, input, options, targetPackageId, targetActionId, designatedRunId, effectiveClock } = args;
    const runId = designatedRunId || randomUUID();
    const now = (effectiveClock?.now() ?? new Date()).toISOString();
    const error: RuntimeError = target.resolveError || {
      code: ACTION_NOT_FOUND,
      message: `Action '${targetActionId}' not found in package '${targetPackageId}'`,
    };
    const rootRunId = options.rootRunId || options.parentRunId || runId;
    const initialRun: RunRecord = {
      id: runId,
      rootRunId,
      parentRunId: options.parentRunId,
      packageId: targetPackageId,
      packageInstanceId: targetPackageId,
      actionId: targetActionId,
      generationId: "1",
      ownerId: this.ownerId,
      hostSessionId: options.hostSessionId || this.hostSessionId,
      status: "failed",
      input,
      error,
      startedAt: now,
      finishedAt: now,
    };
    try {
      target.runner.getStorage().createRun(initialRun);
    } catch (err: any) {
      const repErr = new Error(`RUN_REPOSITORY_UNAVAILABLE: Failed to initialize run record in repository: ${err?.message || String(err)}`);
      (repErr as any).code = RUN_REPOSITORY_UNAVAILABLE;
      (repErr as any).details = { originalError: err?.message };
      throw repErr;
    }

    this.eventSink.emit({
      runId,
      rootRunId,
      sequence: 0,
      timestamp: now,
      type: "status",
      status: "failed",
    });
    const errEvt: ExecutionEvent = {
      runId,
      rootRunId,
      sequence: 1,
      timestamp: now,
      type: "finish",
      result: {
        ok: false,
        runId,
        error,
      },
    };
    this.eventSink.emit(errEvt);
    return {
      runId,
      status: "failed",
      result: Promise.resolve({
        ok: false,
        runId,
        error,
      }),
    };
  }

  /**
   * 创建执行事件桥：事件序列号分配、进度报告器与双写日志适配器。
   */
  private createEventBridge(args: {
    runId: string;
    options: ExecuteOptions;
    effectiveClock?: Clock;
  }): ExecutionEventBridge {
    const { runId, options, effectiveClock } = args;
    let sequence = 0;
    type EventPayload =
      | { type: "log"; level: "debug" | "info" | "warn" | "error"; message: string; data?: JsonValue }
      | { type: "progress"; current?: number; total?: number; message?: string }
      | { type: "status"; status: RunStatus }
      | { type: "finish"; result: ExecutionResult };

    const emitEvent = (payload: EventPayload) => {
      const evt: ExecutionEvent = {
        ...payload,
        runId,
        rootRunId: options.rootRunId || options.parentRunId || runId,
        sequence: sequence++,
        timestamp: (effectiveClock?.now() ?? new Date()).toISOString(),
      };
      this.eventSink.emit(evt);
    };

    const progressReporter: ProgressReporter = {
      report(current: number, total?: number, message?: string) {
        options.progress?.report(current, total, message);
        emitEvent({
          type: "progress",
          current,
          total,
          message,
        });
      },
    };

    const executionLogger: Logger = {
      debug: (message: string, data?: unknown) => {
        this.logger?.debug(message, data);
        options.logger?.debug(message, data);
        emitEvent({
          type: "log",
          level: "debug",
          message,
          data: data as JsonValue | undefined,
        });
      },
      info: (message: string, data?: unknown) => {
        this.logger?.info(message, data);
        options.logger?.info(message, data);
        emitEvent({
          type: "log",
          level: "info",
          message,
          data: data as JsonValue | undefined,
        });
      },
      warn: (message: string, data?: unknown) => {
        this.logger?.warn(message, data);
        options.logger?.warn(message, data);
        emitEvent({
          type: "log",
          level: "warn",
          message,
          data: data as JsonValue | undefined,
        });
      },
      error: (message: string, data?: unknown) => {
        this.logger?.error(message, data);
        options.logger?.error(message, data);
        emitEvent({
          type: "log",
          level: "error",
          message,
          data: data as JsonValue | undefined,
        });
      },
    };

    return { emitEvent, progressReporter, executionLogger };
  }

  /**
   * 监听执行句柄终态：映射终态状态、补发 status 与 finish 事件并注销活跃运行。
   */
  private watchHandleCompletion(
    handle: ExecutionHandle,
    activeItem: ActiveRun,
    bridge: ExecutionEventBridge
  ): void {
    handle.result
      .then((result: ExecutionResult) => {
        const finalStatus: RunStatus = result.ok
          ? "success"
          : result.error?.code === ACTION_TIMEOUT
          ? "timed_out"
          : result.error?.code === ACTION_CANCELLED
          ? "cancelled"
          : "failed";
        activeItem.status = finalStatus;
        bridge.emitEvent({ type: "status", status: finalStatus });
        bridge.emitEvent({ type: "finish", result });
      })
      .catch((err: any) => {
        activeItem.status = "failed";
        bridge.emitEvent({ type: "status", status: "failed" });
        bridge.emitEvent({
          type: "finish",
          result: {
            ok: false,
            runId: handle.runId,
            error: {
              code: UNHANDLED_EXECUTION_ERROR,
              message: err?.message || String(err),
            },
          },
        });
      })
      .finally(() => {
        if (activeItem.signal && activeItem.onAbort) {
          activeItem.signal.removeEventListener("abort", activeItem.onAbort);
          activeItem.onAbort = undefined;
        }
        this.activeRuns.delete(handle.runId);
      });
  }

  async get(runId: string): Promise<RunRecord | undefined> {
    const record = this.storage.getRun(runId);
    if (record) return record;

    // 检查所有已解析的目标包 Runner 存储
    const visited = new Set<ActionRunner>([this._runner]);
    const queue: ActionRunner[] = [this._runner];
    while (queue.length > 0) {
      const runner = queue.shift()!;
      for (const [_, childRunner] of runner.getPackageRunners()) {
        if (!visited.has(childRunner)) {
          visited.add(childRunner);
          queue.push(childRunner);
          const childRecord = childRunner.getStorage().getRun(runId);
          if (childRecord) {
            return childRecord;
          }
        }
      }
    }

    return undefined;
  }

  async cancel(runId: string, reason?: string): Promise<CancelResult> {
    const active = this.activeRuns.get(runId);
    if (!active) {
      const record = await this.get(runId);
      if (record) {
        return { outcome: "already_terminal", runId, status: record.status };
      }
      return { outcome: "not_found", runId };
    }

    if (active.signal && active.onAbort) {
      active.signal.removeEventListener("abort", active.onAbort);
      active.onAbort = undefined;
    }
    active.controller.abort(new Error(reason || "Execution cancelled"));
    active.handle.cancel(reason);
    return { outcome: "requested", runId };
  }

  events(
    runId: string,
    options: { after?: number | string; signal?: AbortSignal; maxQueueSize?: number } = {}
  ): AsyncIterable<ExecutionEvent> {
    return this.eventSink.subscribe(runId, options);
  }

  async close(options: { graceMs?: number } = {}): Promise<void> {
    this.isClosing = true;
    const graceMs = options.graceMs ?? 5000;

    for (const [_, active] of this.activeRuns) {
      active.controller.abort(new Error("Service shutting down"));
      active.handle.cancel("Service shutting down");
    }

    if (this.activeRuns.size > 0) {
      const waitPromise = Promise.all(
        Array.from(this.activeRuns.values()).map((a) => a.handle.result.catch(() => {}))
      );
      let timeoutTimer: ReturnType<typeof setTimeout> | undefined;
      const timeoutPromise = new Promise((resolve) => {
        timeoutTimer = setTimeout(resolve, graceMs);
      });
      try {
        await Promise.race([waitPromise, timeoutPromise]);
      } finally {
        if (timeoutTimer !== undefined) {
          clearTimeout(timeoutTimer);
        }
      }
    }

    this.activeRuns.clear();

    if (this.ownsStorage && this.storage && typeof (this.storage as any).close === "function") {
      await (this.storage as any).close();
    }
    if (this.ownsGlobalStorage && this.globalStorage && typeof (this.globalStorage as any).close === "function") {
      await (this.globalStorage as any).close();
    }
  }
}

export { DefaultExecutionService as ExecutionService };
