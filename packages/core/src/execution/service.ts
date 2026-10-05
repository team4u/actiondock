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
import { type Clock, SystemClock } from "../storage/clock";
import type { ModuleLoader } from "../platform/module-loader";
import { type EventSink, InMemoryEventSink } from "../runtime/events";
import {
  ActionDockError,
  ACTION_CANCELLED,
  ACTION_FAILED,
  ACTION_NOT_FOUND,
  ACTION_TIMEOUT,
  EXECUTION_CONCURRENCY_LIMIT,
  EXECUTION_FAILED,
  IDEMPOTENCY_CONFLICT,
  INPUT_NOT_JSON,
  INPUT_VALIDATION_FAILED,
  INVALID_ARGUMENT,
  INVOCATION_UNSUPPORTED,
  OUTPUT_NOT_JSON,
  OUTPUT_VALIDATION_FAILED,
  RUN_REPOSITORY_UNAVAILABLE,
  SERVICE_CLOSED,
  UNHANDLED_EXECUTION_ERROR,
  describeActionLoadFailure,
} from "../errors";
import { resultStatusToRunStatus, type RuntimeStorage } from "../storage/types";
import { type PackageIdentity } from "../runtime/identity";
import type {
  ActionInvoker,
  CancelResult,
  ExecutionHandle,
  ExecutionService,
  ExecutionServiceOptions,
  ExecutionTicket,
  LocalActionResolver,
} from "./types";
import {
  type InvocationContext,
  type RunOptions,
  createDefaultProcessOwner,
} from "../invocation/types";
import {
  ActionRegistry,
  isActionDefinitionObject,
  resolveAnonymousActionId,
} from "../runtime/action-registry";
import {
  buildInitialRunRecord,
  createRunFinalizer,
  createRunOrThrow,
  tryCreateRun,
  type InitialRunRecordInput,
  type RunFinalizer,
} from "../runtime/run-persistence";
import { createActionContext } from "../runtime/context";
import type { ProcessOwner } from "../process";
import { validateActionInputValue, validateJsonValue } from "../value-validator";
import { validateSchemaOnly } from "../schema/validator";

export type { ExecutionServiceOptions };

/**
 * 在途运行心跳刷新间隔（毫秒）。
 *
 * 必须显著小于存活判定的宽限期（见 run-liveness 的 RUN_LIVENESS_GRACE_MS），
 * 保证心跳正常的宿主绝不被误判过期；间隔内崩溃由进程探测兜底，
 * 心跳只服务无进程标识的遗留记录收敛判定。
 */
export const RUN_HEARTBEAT_INTERVAL_MS = 30_000;

interface ActiveRun {
  runId: string;
  controller: AbortController;
  status: RunStatus;
  startedAt: string;
  signal?: AbortSignal;
  onAbort?: () => void;
  ticket: ExecutionTicket & ExecutionHandle;
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
 * 将输入值校验结果映射为标准运行时错误（单一事实源）。
 */
function buildInputValidationError(
  targetActionId: string,
  check: Exclude<ReturnType<typeof validateActionInputValue>, { valid: true }>
): RuntimeError {
  if (check.kind === "json-value") {
    return {
      code: INPUT_NOT_JSON,
      message: `Input validation failed for action '${targetActionId}': ${check.reason}`,
    };
  }
  return {
    code: INPUT_VALIDATION_FAILED,
    message: `Input validation failed for action '${targetActionId}': ${check.reason}`,
    details: [check.reason],
  };
}

/**
 * 统一执行引擎（融合原协调服务与运行器）。
 * 消除双层 AbortController 与重复参数透传，收敛唯一生命周期与存储落库。
 */
export class DefaultExecutionService implements ExecutionService {
  public readonly identity: PackageIdentity;
  public readonly packageId: string;
  public readonly packageInstanceId: string;
  public readonly generationId: string;
  public hostSessionId?: string;
  /** 宿主进程标识：落库到运行记录供跨进程存活判定（并发打开同一数据目录时不误收割） */
  public readonly hostPid: number;
  public readonly eventSink: EventSink;

  private storage: RuntimeStorage;
  private globalStorage?: RuntimeStorage;
  private projectConfig?: ProjectConfig;
  private projectRoot?: string;
  private configOverrides: Record<string, unknown>;
  private moduleLoader?: ModuleLoader;
  private maxActiveRuns: number;
  private ownerId: string;
  private actionResolver?: LocalActionResolver;
  private logger?: Logger;
  private clock: Clock;
  private process?: ProcessAPI;
  private actionInvoker?: ActionInvoker;
  private registry: ActionRegistry;
  private activeRuns = new Map<string, ActiveRun>();
  /** 在途运行心跳定时器：周期性刷新心跳时间戳，支撑无进程标识判定路径的兜底收敛 */
  private heartbeatTimer?: ReturnType<typeof setInterval>;
  private isClosing = false;
  private reservedSlots = 0;

  constructor(options: ExecutionServiceOptions) {
    if (!options.identity) {
      throw new ActionDockError(INVALID_ARGUMENT, "DefaultExecutionService requires 'identity' PackageIdentity option");
    }
    if (!options.storage) {
      throw new ActionDockError(INVALID_ARGUMENT, "DefaultExecutionService requires 'storage' option");
    }
    this.identity = options.identity;
    this.packageId = this.identity.id;
    this.packageInstanceId = this.identity.instanceId;
    this.generationId = this.identity.generation;
    this.hostSessionId = options.hostSessionId;
    this.hostPid = process.pid;
    this.projectConfig = options.projectConfig;
    this.projectRoot = options.projectRoot;
    this.configOverrides = options.configOverrides || {};
    this.moduleLoader = options.moduleLoader;
    this.eventSink = options.eventSink || new InMemoryEventSink();
    this.maxActiveRuns = options.maxActiveRuns || 32;
    this.ownerId = options.ownerId || `host-${crypto.randomUUID().slice(0, 8)}`;
    this.actionResolver = options.actionResolver;
    this.logger = options.logger;
    this.actionInvoker = options.actionInvoker;
    this.storage = options.storage;
    this.globalStorage = options.globalStorage;
    this.clock = options.clock ?? new SystemClock();
    this.process = options.process;
    this.registry = new ActionRegistry(options.actions);
  }

  /** 获取运行底层存储实例 */
  public getStorage(): RuntimeStorage {
    return this.storage;
  }

  /** 兼容性引用，执行引擎即执行器自身 */
  public get _runner(): this {
    return this;
  }

  public get activeRunsCount(): number {
    return this.activeRuns.size + this.reservedSlots;
  }

  public setActionInvoker(invoker?: ActionInvoker): void {
    this.actionInvoker = invoker;
  }

  public registerAction(id: string, action: ActionDefinition): void;
  public registerAction(
    action: ({ id: string; action?: ActionDefinition } & Partial<ActionDefinition>) | ActionDefinition
  ): void;
  public registerAction(
    idOrAction: string | (({ id: string; action?: ActionDefinition } & Partial<ActionDefinition>) | ActionDefinition),
    actionDef?: ActionDefinition
  ): void {
    if (typeof idOrAction === "string") {
      this.registry.registerAction(idOrAction, actionDef!);
    } else {
      this.registry.registerAction(idOrAction as any);
    }
  }

  public getAction(id: string): ActionDefinition | undefined {
    return this.registry.getAction(id);
  }

  public listActions(): ActionDefinition[] {
    return this.registry.listActions();
  }

  public getActiveHandle(runId: string): ExecutionHandle | undefined {
    return this.activeRuns.get(runId)?.ticket;
  }

  public async execute(
    ref: ActionDefinition | ActionRef | string,
    input: unknown = {},
    contextOrOptions?: InvocationContext | RunOptions | Record<string, unknown>
  ): Promise<ExecutionResult> {
    const ticket = await this.start(ref, input, contextOrOptions);
    if (!ticket.result) {
      throw new ActionDockError(EXECUTION_FAILED, `Execution ticket for run '${ticket.runId}' has no result Promise`);
    }
    return ticket.result;
  }

  public async run(
    ref: ActionDefinition | ActionRef | string,
    input: unknown = {},
    contextOrOptions?: InvocationContext | RunOptions | Record<string, unknown>
  ): Promise<ExecutionResult> {
    return this.execute(ref, input, contextOrOptions);
  }

  public async start(
    ref: ActionDefinition | ActionRef | string,
    input: unknown = {},
    contextOrOptions?: InvocationContext | RunOptions | Record<string, unknown>
  ): Promise<ExecutionTicket & ExecutionHandle> {
    if (this.isClosing) {
      throw new ActionDockError(SERVICE_CLOSED, "ExecutionService is closing: new tasks rejected");
    }

    const currentTotal = this.activeRuns.size + this.reservedSlots;
    if (currentTotal >= this.maxActiveRuns) {
      throw new ActionDockError(
        EXECUTION_CONCURRENCY_LIMIT,
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
      let targetActionDef: ActionDefinition | undefined;

      if (isActionDefinitionObject(ref)) {
        targetActionDef = ref;
        const actObj = ref as any;
        const targetActionId = actObj.id || resolveAnonymousActionId(this.registry.map, ref);
        this.registry.registerAction(targetActionId, ref);
        parsedRef = { packageId: this.packageId, actionId: targetActionId };
      } else {
        try {
          parsedRef = parseActionRef(ref);
        } catch {
          parsedRef = typeof ref === "object" ? ref : { actionId: ref };
        }
      }

      const targetActionId = parsedRef.actionId;
      const targetPackageId = parsedRef.packageId || this.packageId;
      const actionRef = `${targetPackageId}/${targetActionId}`;
      const effectiveClock = this.clock;

      const context = this.normalizeContext(contextOrOptions);

      // requestId 幂等检查与去重处理
      const gateResult = await this.checkIdempotencyGate(
        input as JsonValue,
        context,
        actionRef,
        effectiveClock
      );
      if (gateResult.ticket) {
        releaseSlot();
        return gateResult.ticket as ExecutionTicket & ExecutionHandle;
      }
      const designatedRunId = gateResult.designatedRunId;

      const target = targetActionDef
        ? { action: targetActionDef }
        : await this.resolveExecutionTarget(parsedRef, targetPackageId, targetActionId);

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

      const currentAction = target.action;

      if (this.isClosing) {
        throw new ActionDockError(SERVICE_CLOSED, "ExecutionService is closing: new tasks rejected");
      }

      const runId = designatedRunId || context.runId || crypto.randomUUID();
      const rootRunId = context.rootRunId || context.parentRunId || runId;
      const bridge = this.createEventBridge({ runId, context, effectiveClock });

      // 输入参数 JSON 格式与合法性校验
      const inputCheck = validateActionInputValue(input);
      if (!inputCheck.valid) {
        releaseSlot();
        const error = buildInputValidationError(targetActionId, inputCheck);
        tryCreateRun(
          this.storage,
          buildInitialRunRecord(
            this.buildPersistenceInput({
              runId,
              rootRunId,
              context,
              targetPackageId,
              targetActionId,
              input,
              effectiveClock,
            }),
            "failed",
            error
          )
        );
        bridge.emitEvent({ type: "status", status: "failed" });
        bridge.emitEvent({ type: "finish", result: { ok: false, runId, error } });
        return {
          runId,
          status: "failed",
          result: Promise.resolve({ ok: false, runId, error }),
          cancel: () => false,
        };
      }

      // 输入 Schema 校验
      const schemaError = this.checkActionInputSchema(currentAction, targetActionId, input);
      if (schemaError) {
        releaseSlot();
        tryCreateRun(
          this.storage,
          buildInitialRunRecord(
            this.buildPersistenceInput({
              runId,
              rootRunId,
              context,
              targetPackageId,
              targetActionId,
              input,
              effectiveClock,
            }),
            "failed",
            schemaError
          )
        );
        bridge.emitEvent({ type: "status", status: "failed" });
        bridge.emitEvent({ type: "finish", result: { ok: false, runId, error: schemaError } });
        return {
          runId,
          status: "failed",
          result: Promise.resolve({ ok: false, runId, error: schemaError }),
          cancel: () => false,
        };
      }

      // 持久化 running 初始记录
      createRunOrThrow(
        this.storage,
        buildInitialRunRecord(
          this.buildPersistenceInput({
            runId,
            rootRunId,
            context,
            targetPackageId,
            targetActionId,
            input,
            effectiveClock,
          }),
          "running"
        )
      );
      const finalizer = createRunFinalizer(this.storage, runId);

      // 调用栈快照跟踪
      const callStack = context.callStack ? [...context.callStack] : [];
      const callKey = targetPackageId ? `${targetPackageId}/${targetActionId}` : targetActionId;
      const lastStackItem = callStack[callStack.length - 1];
      const isAlreadyAtTop =
        lastStackItem === callKey ||
        (targetActionId && lastStackItem === targetActionId) ||
        (targetPackageId && lastStackItem === `${targetPackageId}/${targetActionId}`);
      if (!isAlreadyAtTop) {
        callStack.push(callKey);
      }

      // 单一 AbortController 控制器
      const controller = new AbortController();
      let onAbort: (() => void) | undefined;
      if (context.signal) {
        if (context.signal.aborted) {
          controller.abort(context.signal.reason);
        } else {
          onAbort = () => controller.abort(context.signal?.reason);
          context.signal.addEventListener("abort", onAbort, { once: true });
          finalizer.signal = context.signal;
          finalizer.onAbort = onAbort;
        }
      }

      if (typeof context.timeoutMs === "number" && context.timeoutMs > 0) {
        finalizer.startTimeout(controller, context.timeoutMs);
      }

      const effectiveOwner: ProcessOwner =
        context.owner ||
        createDefaultProcessOwner({
          tenantId: context.tenantId,
          principalId: context.principalId,
          packageInstanceId: this.packageInstanceId,
          generationId: this.generationId,
        });

      const effectiveProcess = context.process || this.process;

      const actionCtx = createActionContext({
        actionId: targetActionId,
        storage: this.storage,
        globalStorage: this.globalStorage,
        overrides: { ...this.configOverrides, ...(context.config || {}) },
        projectConfig: this.projectConfig,
        runId,
        rootRunId,
        parentRunId: context.parentRunId,
        signal: controller.signal,
        process: effectiveProcess,
        owner: effectiveOwner,
        progress: bridge.progressReporter,
        logger: bridge.executionLogger,
        onActionInvoke: (childAction, childInput, parentRunId) =>
          this.invokeChildAction({
            controller,
            rootRunId,
            childAction,
            childInput,
            parentRunId: parentRunId || runId,
            currentActionId: targetActionId,
            currentAction,
            callStack,
            context,
            effectiveProcess,
            effectiveOwner,
          }),
      });

      const executionPromise = this.raceExecution({
        currentAction,
        targetActionId,
        input,
        actionCtx,
        controller,
        finalizer,
        runId,
        context,
      });

      const cancelFn = (reason?: string): boolean => {
        if (finalizer.finalized || controller.signal.aborted) {
          return false;
        }
        if (context.signal && onAbort) {
          context.signal.removeEventListener("abort", onAbort);
          finalizer.onAbort = undefined;
        }
        controller.abort(new Error(reason || "Action execution was cancelled"));
        return true;
      };

      const ticket: ExecutionTicket & ExecutionHandle = {
        runId,
        status: "running",
        result: executionPromise,
        cancel: cancelFn,
      };

      const activeItem: ActiveRun = {
        runId,
        controller,
        status: "running",
        startedAt: (effectiveClock?.now() ?? this.clock.now()).toISOString(),
        signal: context.signal,
        onAbort,
        ticket,
      };

      this.activeRuns.set(runId, activeItem);
      releaseSlot();
      this.ensureHeartbeatTimer();
      bridge.emitEvent({ type: "status", status: "running" });

      executionPromise
        .then((result) => {
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
              runId,
              error: {
                code: UNHANDLED_EXECUTION_ERROR,
                message: err?.message || String(err),
              },
            },
          });
        })
        .finally(async () => {
          if (activeItem.signal && activeItem.onAbort) {
            activeItem.signal.removeEventListener("abort", activeItem.onAbort);
            activeItem.onAbort = undefined;
          }
          this.activeRuns.delete(runId);
          if (
            actionCtx &&
            (actionCtx as any).process?.runScoped === true &&
            typeof (actionCtx as any).process.dispose === "function"
          ) {
            try {
              await (actionCtx as any).process.dispose();
            } catch {}
          }
        });

      return ticket;
    } catch (err) {
      releaseSlot();
      throw err;
    }
  }

  private normalizeContext(
    contextOrOptions?: InvocationContext | RunOptions | Record<string, unknown>
  ): InvocationContext {
    if (contextOrOptions && (contextOrOptions as InvocationContext).package) {
      return contextOrOptions as InvocationContext;
    }
    const opts = (contextOrOptions || {}) as any;
    return {
      runId: opts.runId,
      rootRunId: opts.rootRunId,
      parentRunId: opts.parentRunId,
      callStack: opts.callStack ? [...opts.callStack] : [],
      package: opts.package || this.identity,
      signal: opts.signal,
      timeoutMs: opts.timeoutMs,
      maxCallDepth: opts.maxCallDepth,
      config: opts.config || opts.configOverrides,
      tenantId: opts.tenantId || opts.owner?.tenantId,
      principalId: opts.principalId || opts.ownerId || opts.owner?.principalId,
      hostSessionId: opts.hostSessionId || this.hostSessionId,
      logger: opts.logger,
      progress: opts.progress,
      process: opts.process || this.process,
      owner: opts.owner,
      requestId: opts.requestId,
    };
  }

  private async raceExecution(args: {
    currentAction: ActionDefinition;
    targetActionId: string;
    input: unknown;
    actionCtx: any;
    controller: AbortController;
    finalizer: RunFinalizer;
    runId: string;
    context: InvocationContext;
  }): Promise<ExecutionResult> {
    const { currentAction, targetActionId, input, actionCtx, controller, finalizer, runId, context } = args;

    const abortPromise = new Promise<never>((_, reject) => {
      const rejectWithReason = () =>
        reject(controller.signal.reason || new Error("Action execution was cancelled"));
      if (controller.signal.aborted) {
        rejectWithReason();
      } else {
        controller.signal.addEventListener("abort", rejectWithReason, { once: true });
        finalizer.raceListenerRemovers.push(() => {
          controller.signal.removeEventListener("abort", rejectWithReason);
        });
      }
    });

    try {
      const rawOutput = await Promise.race([
        Promise.resolve().then(() => currentAction.run(input, actionCtx)),
        abortPromise,
      ]);

      const outputCheck = validateJsonValue(rawOutput);
      if (!outputCheck.valid) {
        const error: RuntimeError = {
          code: OUTPUT_NOT_JSON,
          message: `Output validation failed for action '${targetActionId}': ${outputCheck.reason}`,
        };
        finalizer.finalize("failed", undefined, error);
        return { ok: false, runId, error };
      }

      const outputSchemaError = this.checkActionOutputSchema(currentAction, targetActionId, rawOutput);
      if (outputSchemaError) {
        finalizer.finalize("failed", undefined, outputSchemaError);
        return { ok: false, runId, error: outputSchemaError };
      }

      finalizer.finalize("success", rawOutput);
      if (finalizer.persistError) {
        return { ok: false, runId, error: finalizer.persistError };
      }
      return {
        ok: true,
        runId,
        data: rawOutput as JsonValue,
      };
    } catch (err: any) {
      return this.classifyExecutionError(err, runId, context.timeoutMs, controller, finalizer);
    }
  }

  private classifyExecutionError(
    err: any,
    runId: string,
    timeoutMs: number | undefined,
    controller: AbortController,
    finalizer: RunFinalizer
  ): ExecutionResult {
    if (finalizer.isTimeout) {
      const error: RuntimeError = {
        code: ACTION_TIMEOUT,
        message: `Action exceeded timeout of ${timeoutMs}ms`,
      };
      finalizer.finalize("timed_out", undefined, error);
      return { ok: false, runId, error: finalizer.persistError || error };
    }

    if (controller.signal.aborted) {
      const reason = controller.signal.reason;
      const reasonMsg =
        reason instanceof Error
          ? reason.message
          : typeof reason === "string"
          ? reason
          : undefined;
      const error: RuntimeError = {
        code: ACTION_CANCELLED,
        message: "Action execution was cancelled",
        details: reasonMsg ? { reason: reasonMsg } : undefined,
      };
      finalizer.finalize("cancelled", undefined, error);
      return { ok: false, runId, error: finalizer.persistError || error };
    }

    const error: RuntimeError = {
      code: err?.code || ACTION_FAILED,
      message: err?.message || String(err),
      details: err?.details,
    };
    finalizer.finalize("failed", undefined, error);
    return {
      ok: false,
      runId,
      error: finalizer.persistError || error,
    };
  }

  private async invokeChildAction(args: {
    controller: AbortController;
    rootRunId: string;
    childAction: ActionRef | string;
    childInput: unknown;
    parentRunId: string;
    currentActionId: string;
    currentAction: ActionDefinition;
    callStack: string[];
    context: InvocationContext;
    effectiveProcess: ProcessAPI | undefined;
    effectiveOwner: ProcessOwner;
  }): Promise<unknown> {
    const {
      controller,
      rootRunId,
      childAction,
      childInput,
      parentRunId,
      currentActionId,
      currentAction,
      callStack,
      context,
      effectiveProcess,
      effectiveOwner,
    } = args;

    const invoker = this.actionInvoker;
    if (!invoker) {
      throw new ActionDockError(
        INVOCATION_UNSUPPORTED,
        "Nested action invocation requires a Host ActionInvoker"
      );
    }

    const childRunId = crypto.randomUUID();
    const invocationContext: InvocationContext = {
      runId: childRunId,
      rootRunId,
      parentRunId,
      caller: {
        packageId: this.packageId,
        actionId: currentActionId,
        runId: parentRunId,
        declaredUses:
          (currentAction as any)?.uses ||
          this.projectConfig?.actions?.[currentActionId]?.uses,
      },
      callStack: [...callStack],
      package: this.identity,
      signal: controller.signal,
      timeoutMs: context.timeoutMs,
      maxCallDepth: context.maxCallDepth,
      config: context.config,
      tenantId: effectiveOwner.tenantId,
      principalId: effectiveOwner.principalId,
      hostSessionId: context.hostSessionId || this.hostSessionId,
      logger: context.logger,
      progress: context.progress,
      process: effectiveProcess,
      owner: effectiveOwner,
    };
    return await invoker(childAction, childInput, invocationContext);
  }

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
      createdAt: (effectiveClock?.now() ?? this.clock.now()).toISOString(),
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
          ticket: active.ticket,
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
            cancel: () => false,
          },
        };
      }
    }

    return { designatedRunId: provisionalRunId };
  }

  private async resolveExecutionTarget(
    parsedRef: ActionRef,
    targetPackageId: string,
    targetActionId: string
  ): Promise<{ action?: ActionDefinition; resolveError?: RuntimeError }> {
    if (targetPackageId && targetPackageId !== this.packageId) {
      const resolveError: RuntimeError = {
        code: ACTION_NOT_FOUND,
        message: `Package '${this.packageId}' cannot execute action for external package '${targetPackageId}'`,
        details: {
          reason: `Cross-package action '${targetPackageId}/${targetActionId}' cannot be resolved by ActionRunner of package '${this.packageId}'`,
        },
      };
      return { action: undefined, resolveError };
    }

    let action: ActionDefinition | undefined =
      this.registry.getAction(targetActionId) ||
      this.registry.getAction(`${targetPackageId}/${targetActionId}`);

    if (action) {
      return { action };
    }

    if (this.actionResolver) {
      try {
        const customResolved = await this.actionResolver(targetActionId);
        if (customResolved) {
          this.registry.registerAction(targetActionId, customResolved);
          if (this.packageId) {
            this.registry.registerAction(`${this.packageId}/${targetActionId}`, customResolved);
          }
          return { action: customResolved };
        }
      } catch (err: any) {
        return {
          action: undefined,
          resolveError: {
            code: ACTION_NOT_FOUND,
            message: `Action '${targetActionId}' not found in package '${targetPackageId}'`,
            details: { reason: err.message },
          },
        };
      }
    }

    if (this.projectRoot && existsSync(this.projectRoot)) {
      let config: ProjectConfig;
      try {
        config = this.projectConfig || loadProjectConfig(this.projectRoot);
      } catch (err: any) {
        const resolveError = describeActionLoadFailure(err, {
          actionId: targetActionId,
          packageId: this.packageId,
          projectRoot: this.projectRoot,
        });
        return { action: undefined, resolveError };
      }

      let actionsMap: Map<string, ActionDefinition>;
      try {
        actionsMap = await loadActions(this.projectRoot, config.actionsDir, {
          loader: this.moduleLoader,
        });
      } catch (err: any) {
        const resolveError = describeActionLoadFailure(err, {
          actionId: targetActionId,
          packageId: this.packageId,
          projectRoot: this.projectRoot,
        });
        return { action: undefined, resolveError };
      }

      const matched = actionsMap.get(targetActionId);
      if (matched) {
        this.registry.registerAction(targetActionId, matched);
        return { action: matched };
      }
    }

    const resolveError: RuntimeError = {
      code: ACTION_NOT_FOUND,
      message: `Action '${targetActionId}' not found in package '${targetPackageId}'`,
    };
    return { action: undefined, resolveError };
  }

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

  private failTicketForMissingAction(args: {
    target: { action?: ActionDefinition; resolveError?: RuntimeError };
    input: unknown;
    context: InvocationContext;
    targetPackageId: string;
    targetActionId: string;
    designatedRunId?: string;
    effectiveClock?: Clock;
  }): ExecutionTicket & ExecutionHandle {
    const { target, input, context, targetPackageId, targetActionId, designatedRunId, effectiveClock } = args;
    const runId = designatedRunId || context.runId || crypto.randomUUID();
    const now = (effectiveClock?.now() ?? this.clock.now()).toISOString();
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
      packageInstanceId: context.package?.instanceId || this.packageInstanceId,
      actionId: targetActionId,
      generationId: context.package?.generation || this.generationId,
      ownerId: this.ownerId,
      hostSessionId: context.hostSessionId || this.hostSessionId,
      hostPid: this.hostPid,
      status: "failed",
      input: input as JsonValue,
      error,
      startedAt: now,
      finishedAt: now,
    };
    try {
      this.storage.createRun(initialRun);
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
      cancel: () => false,
    };
  }

  private buildPersistenceInput(args: {
    runId: string;
    rootRunId: string;
    context: InvocationContext;
    targetPackageId: string;
    targetActionId: string;
    input: unknown;
    effectiveClock?: Clock;
  }): InitialRunRecordInput {
    const { runId, rootRunId, context, targetPackageId, targetActionId, input, effectiveClock } = args;
    const startedAt =
      effectiveClock?.now().toISOString() ||
      (typeof (this.storage as any).clock?.now === "function"
        ? (this.storage as any).clock.now().toISOString()
        : this.clock.now().toISOString());

    return {
      runId,
      rootRunId,
      parentRunId: context.parentRunId,
      ownerId: context.principalId || context.tenantId || this.ownerId,
      hostSessionId: context.hostSessionId || this.hostSessionId,
      hostPid: this.hostPid,
      packageInstanceId: context.package?.instanceId || this.packageInstanceId,
      generationId: context.package?.generation || this.generationId,
      targetPackageId,
      targetActionId,
      startedAt,
      input,
      runnerPackageId: this.packageId,
      runnerPackageInstanceId: this.packageInstanceId,
      runnerGenerationId: this.generationId,
      runnerHostSessionId: this.hostSessionId,
    };
  }

  private checkActionInputSchema(
    action: ActionDefinition | undefined,
    targetActionId: string,
    input: unknown
  ): RuntimeError | undefined {
    const targetInputSchema =
      (action as any)?.inputSchema !== undefined
        ? (action as any).inputSchema
        : this.projectConfig?.actions?.[targetActionId]?.inputSchema;
    if (targetInputSchema !== undefined) {
      const val = validateSchemaOnly(targetInputSchema, input);
      if (!val.valid) {
        return {
          code: INPUT_VALIDATION_FAILED,
          message: `Input schema validation failed for action '${targetActionId}'`,
          details: val.errors,
        };
      }
    }
    return undefined;
  }

  private checkActionOutputSchema(
    action: ActionDefinition | undefined,
    targetActionId: string,
    rawOutput: unknown
  ): RuntimeError | undefined {
    const targetOutputSchema =
      (action as any)?.outputSchema !== undefined
        ? (action as any).outputSchema
        : this.projectConfig?.actions?.[targetActionId]?.outputSchema;
    if (targetOutputSchema !== undefined) {
      const outVal = validateSchemaOnly(targetOutputSchema, rawOutput);
      if (!outVal.valid) {
        return {
          code: OUTPUT_VALIDATION_FAILED,
          message: `Output schema validation failed for action '${targetActionId}'`,
          details: outVal.errors,
        };
      }
    }
    return undefined;
  }

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
        timestamp: (effectiveClock?.now() ?? this.clock.now()).toISOString(),
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

  public async get(runId: string): Promise<RunRecord | undefined> {
    return this.storage.getRun(runId) ?? undefined;
  }

  public async cancel(runId: string, reason?: string): Promise<CancelResult> {
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
    return { outcome: "requested", runId };
  }

  public events(
    runId: string,
    options: { after?: number | string; signal?: AbortSignal; maxQueueSize?: number } = {}
  ): AsyncIterable<ExecutionEvent> {
    return this.eventSink.subscribe(runId, options);
  }

  /**
   * 确保在途运行心跳定时器存在。
   *
   * 存活判定的第一依据是进程探测（运行记录已落库宿主进程标识），
   * 心跳是对遗留记录（无进程标识）与其他协作场景的兜底信号：
   * 持有进程周期性刷新在途记录的心跳时间戳，收割方仅对心跳过期的
   * 遗留记录做宽限期判定，正常运行中的记录绝不会被误判过期。
   * 定时器不阻塞进程退出（unref），无在途运行时不产生任何调度。
   */
  private ensureHeartbeatTimer(): void {
    if (this.heartbeatTimer) return;
    const touch = () => {
      if (this.isClosing || this.activeRuns.size === 0) return;
      if (typeof this.storage.touchRunHeartbeat !== "function") return;
      try {
        this.storage.touchRunHeartbeat(Array.from(this.activeRuns.keys()));
      } catch (err: any) {
        // 心跳失败不影响执行主链路，存活判定仍可依赖进程探测，但必须通过 logger.warn 记录告警
        const errDetail = err instanceof Error ? `${err.message}${err.stack ? `\n${err.stack}` : ""}` : String(err);
        const warnMsg = `[ExecutionService] Failed to touch run heartbeat: ${errDetail}`;
        if (this.logger) {
          this.logger.warn(warnMsg, {
            error: err instanceof Error ? err.message : String(err),
            stack: err instanceof Error ? err.stack : undefined,
          });
        } else {
          console.warn(warnMsg);
        }
      }
    };
    this.heartbeatTimer = setInterval(touch, RUN_HEARTBEAT_INTERVAL_MS);
    if (this.heartbeatTimer.unref) {
      this.heartbeatTimer.unref();
    }
  }

  public async close(options: { graceMs?: number } = {}): Promise<void> {
    this.isClosing = true;
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = undefined;
    }
    this.reservedSlots = 0;
    const graceMs = options.graceMs ?? 5000;

    for (const [_, active] of this.activeRuns) {
      active.controller.abort(new Error("Service shutting down"));
    }

    if (this.activeRuns.size > 0) {
      const waitPromise = Promise.all(
        Array.from(this.activeRuns.values()).map((a) => a.ticket.result?.catch(() => {}))
      );
      // 此处优雅关闭竞速保留原生 setTimeout 与 clearTimeout 的取舍说明：
      // Clock 接口仅提供 sleep 异步等待能力，未提供注销或取消计划中休眠的句柄；
      // 若直接使用 clock.sleep 与 waitPromise 竞速，在任务提早完成时未触发的休眠 Promise 将在后台悬挂直至超时；
      // 保留原生定时器并在 finally 中即时清理，可确保优雅关闭在任何分支下均不产生定时器泄漏；
      // 且此处仅为服务终结阶段的兜底防护，对确定性测试执行链路无负面干扰。
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
  }

  public async dispose(): Promise<void> {
    await this.close();
  }
}

export { DefaultExecutionService as ExecutionService };
export { DefaultExecutionService as ActionRunner };
