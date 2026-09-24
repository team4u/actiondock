import { existsSync } from "node:fs";
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
import { parseActionRef } from "../catalog/resolve-action";
import { computeDigest } from "../project/digest";
import { loadActions, loadProjectConfig } from "../project/loader";
import type { ProjectConfig } from "../project/types";
import type { Clock } from "../runtime/clock";
import type { ModuleLoader } from "../runtime/module-loader";
import { type EventSink, InMemoryEventSink } from "../runtime/events";
import { ActionRunner, type ExecutionHandle } from "../runtime/runner";
import {
  ActionDockError,
  ACTION_NOT_FOUND,
  EXECUTION_FAILED,
  IDEMPOTENCY_CONFLICT,
  RUN_REPOSITORY_UNAVAILABLE,
  UNHANDLED_EXECUTION_ERROR,
  describeActionLoadFailure,
} from "../errors";
import { resultStatusToRunStatus, type RuntimeStorage } from "../storage/types";
import { createPackageIdentity, type PackageIdentity } from "../runtime/identity";
import type {
  ActionInvoker,
  CancelResult,
  ExecutionService,
  ExecutionServiceOptions,
  ExecutionTicket,
  InvocationContext,
  LocalActionResolver,
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
  public readonly identity: PackageIdentity;
  public readonly packageId: string;
  private storage: RuntimeStorage;
  private projectConfig?: ProjectConfig;
  private projectRoot?: string;
  private moduleLoader?: ModuleLoader;
  public readonly eventSink: EventSink;
  public readonly packageInstanceId: string;
  public readonly generationId: string;
  private maxActiveRuns: number;
  private ownerId: string;
  public hostSessionId?: string;
  private _runner: ActionRunner;
  private logger?: Logger;
  private clock?: Clock;
  private process?: ProcessAPI;
  private actionResolver?: LocalActionResolver;
  private activeRuns = new Map<string, ActiveRun>();
  private globalStorage?: RuntimeStorage;
  private actionInvoker?: ActionInvoker;
  private isClosing = false;
  private reservedSlots = 0;

  constructor(options: ExecutionServiceOptions) {
    if (!options.identity) {
      throw new Error("DefaultExecutionService requires 'identity' PackageIdentity option");
    }
    if (!options.storage) {
      throw new Error("DefaultExecutionService requires 'storage' option");
    }
    this.identity = options.identity;
    this.packageId = this.identity.id;
    this.packageInstanceId = this.identity.instanceId;
    this.generationId = this.identity.generation;
    this.hostSessionId = options.hostSessionId;
    this.projectConfig = options.projectConfig;
    this.projectRoot = options.projectRoot;
    this.moduleLoader = options.moduleLoader;
    this.eventSink = options.eventSink || new InMemoryEventSink();
    this.maxActiveRuns = options.maxActiveRuns || 32;
    this.ownerId = options.ownerId || `host-${crypto.randomUUID().slice(0, 8)}`;
    this.actionResolver = options.actionResolver;
    this.logger = options.logger;
    this.actionInvoker = options.actionInvoker;
    this.storage = options.storage;
    this.globalStorage = options.globalStorage;
    this.clock = options.clock;
    this.process = options.process;

    this._runner = new ActionRunner({
      identity: this.identity,
      hostSessionId: this.hostSessionId,
      storage: this.storage,
      globalStorage: this.globalStorage,
      projectRoot: options.projectRoot,
      projectConfig: this.projectConfig,
      configOverrides: options.configOverrides,
      actions: options.actions,
      process: this.process,
      clock: this.clock,
      actionResolver: this.actionResolver,
      customHome: options.customHome,
      actionInvoker: this.actionInvoker,
    });
  }

  public setActionInvoker(invoker?: ActionInvoker): void {
    this.actionInvoker = invoker;
    this._runner.setActionInvoker(invoker);
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

  async execute(
    ref: ActionRef | string,
    input: JsonValue,
    context: InvocationContext
  ): Promise<ExecutionResult> {
    const ticket = await this.start(ref, input, context);
    if (!ticket.result) {
      throw new Error(`Execution ticket for run '${ticket.runId}' has no result Promise`);
    }
    return ticket.result;
  }

  async run(
    ref: ActionRef | string,
    input: JsonValue,
    context: InvocationContext
  ): Promise<ExecutionResult> {
    return this.execute(ref, input, context);
  }

  public get activeRunsCount(): number {
    return this.activeRuns.size + this.reservedSlots;
  }

  async start(
    ref: ActionRef | string,
    input: JsonValue,
    context: InvocationContext
  ): Promise<ExecutionTicket> {
    if (this.isClosing) {
      throw new Error("ExecutionService is closing: new tasks rejected");
    }

    const currentTotal = this.activeRuns.size + this.reservedSlots;
    if (currentTotal >= this.maxActiveRuns) {
      throw new Error(
        `Concurrency limit reached: ${currentTotal}/${this.maxActiveRuns} active runs`
      );
    }

    this.reservedSlots++;
    let hasReservedSlot = true;
    const releaseSlot = () => {
      if (hasReservedSlot) {
        this.reservedSlots--;
        hasReservedSlot = false;
      }
    };

    try {
      let parsedRef: ActionRef;
      try {
        parsedRef = parseActionRef(ref);
      } catch {
        parsedRef = typeof ref === "object" ? ref : { actionId: ref };
      }
      const targetActionId = parsedRef.actionId;
      const targetPackageId = parsedRef.packageId || this.packageId;
      const actionRef = `${targetPackageId}/${targetActionId}`;
      const effectiveClock = this.clock;

      // requestId 幂等检查与去重处理
      const gateResult = await this.checkIdempotencyGate(
        input,
        context,
        actionRef,
        effectiveClock
      );
      if (gateResult.ticket) {
        releaseSlot();
        return gateResult.ticket;
      }
      const designatedRunId = gateResult.designatedRunId;

      const target = await this.resolveExecutionTarget(parsedRef, targetPackageId, targetActionId);
      if (!target.action) {
        releaseSlot();
        return this.failTicketForMissingAction({
          target,
          input,
          context,
          targetPackageId,
          targetActionId,
          designatedRunId,
          effectiveClock,
        });
      }

      if (this.isClosing) {
        throw new Error("ExecutionService is closing: new tasks rejected");
      }

      const controller = new AbortController();
      let onAbort: (() => void) | undefined;
      if (context.signal && typeof context.signal.addEventListener === "function") {
        if (context.signal.aborted) {
          controller.abort(context.signal.reason);
        } else {
          onAbort = () => controller.abort(context.signal?.reason);
          context.signal.addEventListener(
            "abort",
            onAbort,
            { once: true }
          );
        }
      }

      const runId = designatedRunId || context.runId || crypto.randomUUID();
      const bridge = this.createEventBridge({ runId, context, effectiveClock });

      target.runner.registerAction(targetActionId, target.action);
      const handle = target.runner.start(targetActionId, input, {
        runId,
        rootRunId: context.rootRunId,
        parentRunId: context.parentRunId,
        callStack: context.callStack ? [...context.callStack] : undefined,
        hostSessionId: context.hostSessionId || this.hostSessionId,
        maxCallDepth: context.maxCallDepth,
        configOverrides: context.config as Record<string, unknown> | undefined,
        signal: controller.signal,
        timeoutMs: context.timeoutMs,
        progress: bridge.progressReporter,
        logger: bridge.executionLogger,
        process: context.process || this.process,
        packageInstanceId: context.package.instanceId,
        generationId: context.package.generation,
        tenantId: context.owner?.tenantId || context.tenantId,
        principalId: context.owner?.principalId || context.principalId,
        owner: context.owner
          ? {
              tenantId: context.owner.tenantId,
              principalId: context.owner.principalId,
              packageInstanceId:
                context.owner.packageInstanceId || context.package.instanceId,
              generationId:
                context.owner.generationId || context.package.generation,
            }
          : undefined,
        actionInvoker: this.actionInvoker,
      });

      const activeItem: ActiveRun = {
        runId: handle.runId,
        handle,
        controller,
        status: "running",
        startedAt: (effectiveClock?.now() ?? new Date()).toISOString(),
        signal: context.signal,
        onAbort,
      };

      this.activeRuns.set(handle.runId, activeItem);
      releaseSlot();
      bridge.emitEvent({ type: "status", status: "running" });

      this.watchHandleCompletion(handle, activeItem, bridge);

      return {
        runId: handle.runId,
        status: "running",
        result: handle.result,
      };
    } catch (err) {
      releaseSlot();
      throw err;
    }
  }

  /**
   * 幂等门检查：digest 计算与冲突/重复分流（重复命中时直接返回已有票据）。
   */
  private async checkIdempotencyGate(
    input: JsonValue,
    context: InvocationContext,
    actionRef: string,
    effectiveClock?: Clock
  ): Promise<{ ticket?: ExecutionTicket; designatedRunId?: string }> {
    if (!context.requestId) {
      return {};
    }

    const digestPayload = {
      input,
      config: context.config,
      timeoutMs: context.timeoutMs,
    };
    const inputDigest = computeDigest(digestPayload);
    const provisionalRunId = crypto.randomUUID();

    if (!this.storage.checkAndRecordIdempotency) {
      return {};
    }

    const idemp = this.storage.checkAndRecordIdempotency({
      ownerId: this.ownerId,
      actionRef,
      requestId: context.requestId,
      inputDigest,
      runId: provisionalRunId,
      createdAt: (effectiveClock?.now() ?? new Date()).toISOString(),
    });

    if (idemp.outcome === "conflict") {
      throw new ActionDockError(
        IDEMPOTENCY_CONFLICT,
        `Idempotency conflict for requestId '${context.requestId}': input parameters digest mismatch`,
        {
          requestId: context.requestId,
          actionRef,
          expectedDigest: idemp.existingDigest,
          actualDigest: inputDigest,
        }
      );
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
   * 解析执行目标：确定目标 Action 定义。
   * 铁律 4：Runner 不找 Package，ExecutionService 仅执行本 Package 的 Action。
   */
  private async resolveExecutionTarget(
    parsedRef: ActionRef,
    targetPackageId: string,
    targetActionId: string
  ): Promise<{ runner: ActionRunner; action?: ActionDefinition; resolveError?: RuntimeError }> {
    const runnerToUse: ActionRunner = this._runner;
    let resolveError: RuntimeError | undefined;

    if (targetPackageId && targetPackageId !== this.packageId) {
      resolveError = {
        code: ACTION_NOT_FOUND,
        message: `Package '${this.packageId}' cannot execute action for external package '${targetPackageId}'`,
      };
      return { runner: runnerToUse, action: undefined, resolveError };
    }

    let action: ActionDefinition | undefined =
      runnerToUse.getAction(targetActionId) || runnerToUse.getAction(`${targetPackageId}/${targetActionId}`);

    if (!action) {
      const resolution = await runnerToUse.resolveAction(parsedRef);
      if (resolution.status === "found") {
        action = resolution.action;
      } else {
        const targetAction = await this.actionResolver?.(targetActionId);
        if (targetAction) {
          action = targetAction;
        } else if (this.projectRoot && existsSync(this.projectRoot)) {
          let config: ProjectConfig;
          try {
            config = this.projectConfig || loadProjectConfig(this.projectRoot);
          } catch (err: any) {
            resolveError = describeActionLoadFailure(err, {
              actionId: targetActionId,
              packageId: this.packageId,
              projectRoot: this.projectRoot,
            });
            return { runner: runnerToUse, action: undefined, resolveError };
          }

          let actionsMap: Map<string, ActionDefinition>;
          try {
            actionsMap = await loadActions(this.projectRoot, config.actionsDir, {
              loader: this.moduleLoader,
            });
          } catch (err: any) {
            resolveError = describeActionLoadFailure(err, {
              actionId: targetActionId,
              packageId: this.packageId,
              projectRoot: this.projectRoot,
            });
            return { runner: runnerToUse, action: undefined, resolveError };
          }

          const matched = actionsMap.get(targetActionId);
          if (matched) {
            action = matched;
            runnerToUse.registerAction(targetActionId, matched);
          } else {
            resolveError = {
              code: ACTION_NOT_FOUND,
              message: `Action '${targetActionId}' not found in package '${targetPackageId}'`,
              details: resolution.reason ? { reason: resolution.reason } : undefined,
            };
          }
        } else {
          resolveError = {
            code: ACTION_NOT_FOUND,
            message: `Action '${targetActionId}' not found in package '${targetPackageId}'`,
            details: resolution.reason ? { reason: resolution.reason } : undefined,
          };
        }
      }
    }

    return { runner: runnerToUse, action, resolveError };
  }

  /**
   * 解析指定 Action 定义（供 PackageRuntime 或内部使用）。
   */
  public async resolveAction(ref: ActionRef | string): Promise<ActionDefinition | undefined> {
    let parsedRef: ActionRef;
    try {
      parsedRef = parseActionRef(ref);
    } catch {
      parsedRef = typeof ref === "object" ? ref : { actionId: ref };
    }
    const targetActionId = parsedRef.actionId;
    const targetPackageId = parsedRef.packageId || this.packageId;
    const target = await this.resolveExecutionTarget(parsedRef, targetPackageId, targetActionId);
    return target.action;
  }

  /**
   * 目标 Action 缺失时的失败票据：落库 failed 记录并补发 status 与 finish 事件。
   */
  private failTicketForMissingAction(args: {
    target: { runner: ActionRunner; resolveError?: RuntimeError };
    input: JsonValue;
    context: InvocationContext;
    targetPackageId: string;
    targetActionId: string;
    designatedRunId?: string;
    effectiveClock?: Clock;
  }): ExecutionTicket {
    const { target, input, context, targetPackageId, targetActionId, designatedRunId, effectiveClock } = args;
    const runId = designatedRunId || context.runId || crypto.randomUUID();
    const now = (effectiveClock?.now() ?? new Date()).toISOString();
    const error: RuntimeError = target.resolveError || {
      code: ACTION_NOT_FOUND,
      message: `Action '${targetActionId}' not found in package '${targetPackageId}'`,
    };
    const rootRunId = context.rootRunId || context.parentRunId || runId;
    const initialRun: RunRecord = {
      id: runId,
      rootRunId,
      parentRunId: context.parentRunId,
      packageId: targetPackageId,
      packageInstanceId: context.package.instanceId || target.runner.packageInstanceId,
      actionId: targetActionId,
      generationId: context.package.generation || target.runner.generationId,
      ownerId: this.ownerId,
      hostSessionId: context.hostSessionId || this.hostSessionId,
      status: "failed",
      input,
      error,
      startedAt: now,
      finishedAt: now,
    };
    try {
      target.runner.getStorage().createRun(initialRun);
    } catch (err: any) {
      throw new ActionDockError(
        RUN_REPOSITORY_UNAVAILABLE,
        `RUN_REPOSITORY_UNAVAILABLE: Failed to initialize run record in repository: ${err?.message || String(err)}`,
        { originalError: err?.message }
      );
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
    context: InvocationContext;
    effectiveClock?: Clock;
  }): ExecutionEventBridge {
    const { runId, context, effectiveClock } = args;
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
        rootRunId: context.rootRunId || context.parentRunId || runId,
        sequence: sequence++,
        timestamp: (effectiveClock?.now() ?? new Date()).toISOString(),
      };
      this.eventSink.emit(evt);
    };

    const progressReporter: ProgressReporter = {
      report(current: number, total?: number, message?: string) {
        context.progress?.report(current, total, message);
        emitEvent({
          type: "progress",
          current,
          total,
          message,
        });
      },
    };

    const mkLevelLogger =
      (level: "debug" | "info" | "warn" | "error") =>
      (message: string, data?: unknown) => {
        this.logger?.[level](message, data);
        context.logger?.[level](message, data);
        emitEvent({
          type: "log",
          level,
          message,
          data: data as JsonValue | undefined,
        });
      };

    const executionLogger: Logger = {
      debug: mkLevelLogger("debug"),
      info: mkLevelLogger("info"),
      warn: mkLevelLogger("warn"),
      error: mkLevelLogger("error"),
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
        const finalStatus = resultStatusToRunStatus(
          result.ok,
          result.ok ? undefined : result.error?.code
        );
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
    return this.storage.getRun(runId) ?? undefined;
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
    this.reservedSlots = 0;
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

    await this._runner.dispose();

  }
}

export { DefaultExecutionService as ExecutionService };
