import { existsSync } from "node:fs";
import { randomUUID } from "node:crypto";
import type {
  ActionDefinition,
  ActionRef,
  ExecutionResult,
  JsonValue,
  Logger,
  ProcessAPI,
  ProgressReporter,
  RuntimeError,
} from "@actiondock/sdk";
import { ActionResolver } from "../catalog/action-resolver";
import { parseActionRef } from "../catalog/resolve-action";
import { loadActions, loadProjectConfig } from "../project/loader";
import type { ProjectConfig } from "../project/types";
import {
  ACTION_CALL_CYCLE,
  ACTION_CYCLE_DETECTED,
  ACTION_FAILED,
  ACTION_MAX_DEPTH_EXCEEDED,
  ACTION_NOT_FOUND,
  ACTION_SUBRUN_LIMIT,
  ACTION_TIMEOUT,
  describeActionLoadFailure,
  INPUT_NOT_JSON,
  MAX_SUBRUNS_REACHED,
  OUTPUT_NOT_JSON,
  RUN_PERSISTENCE_FAILED,
  RUN_REPOSITORY_UNAVAILABLE,
  ACTION_CANCELLED,
  PACKAGE_NOT_FOUND,
  INPUT_VALIDATION_FAILED,
  OUTPUT_VALIDATION_FAILED,
  UNDECLARED_ACTION_DEPENDENCY,
  INVOCATION_UNSUPPORTED,
  ActionDockError,
} from "../errors";
import { validateSchemaOnly } from "../schema/validator";
import { validateActionInputValue } from "../json/value-validator";
import type { RuntimeStorage } from "../storage/types";
import type { Clock } from "./clock";
import type { RuntimePlatform } from "../platform/types";
import { createActionContext, StderrLogger } from "./context";
import type { ProcessOwner } from "../process";
import type { PackageIdentity } from "./identity";
import type { ActionInvoker } from "../execution/types";
import type { InvocationCaller, InvocationContext } from "../invocation/types";
import {
  ActionRegistry,
  findLocalAction,
  isActionDefinitionObject,
  resolveAnonymousActionId,
} from "./action-registry";
import {
  buildInitialRunRecord,
  createRunFinalizer,
  createRunOrThrow,
  tryCreateRun,
  type InitialRunRecordInput,
  type RunFinalizer,
} from "./run-persistence";

import { validateJsonValue } from "../json/value-validator";

/**
 * 局部动作解析器委托函数契约（仅限当前包内部动作）。
 */
export type LocalActionResolver = (
  actionId: string
) => ActionDefinition | undefined | Promise<ActionDefinition | undefined>;

/**
 * ActionRunner 初始化配置选项。
 */
export interface RunnerOptions {
  /** 显式注入的包物理与快照身份标识值对象（必填单一事实源） */
  identity: PackageIdentity;
  /** 持久化运行时存储实例（SQLite） */
  storage: RuntimeStorage;
  /** 全局共享持久化存储实例（SQLite，用于单例池化避免泄漏） */
  globalStorage?: RuntimeStorage;
  /** 项目根目录绝对路径 */
  projectRoot?: string;
  /** 项目元数据配置 */
  projectConfig?: ProjectConfig;
  /** CLI 或上层注入的临时配置覆盖项 */
  configOverrides?: Record<string, unknown>;
  /** 预加载的 Action 映射表 */
  actions?: Map<string, ActionDefinition>;
  /** 外部注入的进程执行器 */
  process?: ProcessAPI;
  /** 可选的时间与时钟源（默认使用存储内嵌时钟或系统时间） */
  clock?: Clock;
  /** 可选的底层运行时平台契约 */
  platform?: RuntimePlatform;
  /** 仅支持当前包局部 Action 的动态解析委托函数 */
  actionResolver?: LocalActionResolver;
  /** 自定义 ActionDock 用户家目录（用于测试隔离与多租户环境） */
  customHome?: string;
  /** 执行宿主会话标识 */
  hostSessionId?: string;
  /** 子任务调用委托函数 */
  actionInvoker?: ActionInvoker;
}

/**
 * 启动 Action 执行时的可选控制参数。
 */
export interface ExecutionStartOptions {
  /** 显式指定的运行 ID */
  runId?: string;
  /** 根运行 ID */
  rootRunId?: string;
  /** 父级运行 ID（嵌套调用场景下建立调用链树） */
  parentRunId?: string;
  /** 包物理实例标识 */
  packageInstanceId?: string;
  /** 快照代次标识 */
  generationId?: string;
  /** 执行所有者标识 */
  ownerId?: string;
  /** 租户标识 */
  tenantId?: string;
  /** 主体标识 */
  principalId?: string;
  /** 显式执行归属所有者契约 */
  owner?: ProcessOwner;
  /** 执行宿主会话标识 */
  hostSessionId?: string;
  /** 调用栈数组（用于检测 A -> B -> A 环路死锁） */
  callStack?: string[];
  /** 外部传入的 AbortSignal 取消信号 */
  signal?: AbortSignal;
  /** 最大超时时间（毫秒），超时将自动中止执行并标记为 ACTION_TIMEOUT */
  timeoutMs?: number;
  /** 最大调用深度覆盖 */
  maxCallDepth?: number;
  /** 外部注入的进程执行器 */
  process?: ProcessAPI;
  /** 可选的底层运行时平台契约 */
  platform?: RuntimePlatform;
  /** 外部注入的进度报告器 */
  progress?: ProgressReporter;
  /** 外部注入的日志记录器 */
  logger?: Logger;
  /** 执行级临时配置覆盖项 */
  configOverrides?: Record<string, unknown>;
  /** 子任务调用委托函数 */
  actionInvoker?: ActionInvoker;
}

/**
 * 异步执行句柄，支持获取执行结果 Promise 与主动取消操作。
 */
export interface ExecutionHandle {
  /** 本次执行生成的全局唯一运行 ID */
  runId: string;
  /** 最终执行结果信封 Promise */
  result: Promise<ExecutionResult>;
  /**
   * 取消当前正在执行的任务
   * @param reason 取消原因
   * @returns 是否成功触发取消
   */
  cancel(reason?: string): boolean;
}

/**
 * Action 解析结果判别联合类型。
 */
export type ActionResolution =
  | { status: "found"; action: ActionDefinition }
  | { status: "not_found"; reason?: string }
  | { status: "load_failed"; error: Error; packageId: string; projectRoot: string };

/**
 * 单次 start 调用的运行期共享上下文对象（收敛原闭包散落状态）。
 */
interface RunExecutionContext {
  /** 本次执行生成的全局唯一运行 ID */
  runId: string;
  /** 原始执行控制选项 */
  options: ExecutionStartOptions;
  /** 原始输入数据 */
  input: unknown;
  /** 原始传入的 Action 对象、引用或标识符 */
  actionOrId: ActionDefinition | ActionRef | string;
  /** 预解析出的目标 Action 定义（可能延迟解析） */
  action: ActionDefinition | undefined;
  /** 目标 Action 标识 */
  targetActionId: string;
  /** 目标 Package 标识 */
  targetPackageId: string;
  /** 生效的进程执行器 */
  effectiveProcess: ProcessAPI | undefined;
  /** 执行开始时间戳 */
  startedAt: string;
  /** 调用栈快照（用于深度与环路检测） */
  callStack: string[];
}

/**
 * ActionDock 核心执行引擎（ActionRunner）。
 *
 * 本类为执行编排壳：负责 Action 执行的全生命周期编排（校验、深度与环路检测、
 * 超时与取消竞态、子调用 uses 授权与错误分类），并将单一职责域委托至独立模块：
 * - Action 注册与检索委托 ActionRegistry（action-registry.ts）
 * - RunRecord 构造与落库委托 run-persistence.ts
 * - 跨包动作调用委托注入的 ActionInvoker 并重返目标包执行服务
 *
 * 入参 (inputSchema) 与出参 (outputSchema) 的 JSON Schema 严格校验、嵌套 Action
 * 相互调用的环路检测（Cycle Detection）、超时 (Timeout) 与中断信号 (AbortSignal)
 * 竞态控制与运行记录持久化编排仍由本类承担。
 */
export class ActionRunner {
  public readonly identity: PackageIdentity;
  public readonly packageId: string;
  public readonly packageInstanceId: string;
  public readonly generationId: string;
  private storage: RuntimeStorage;
  private globalStorage?: RuntimeStorage;
  private projectRoot?: string;
  private projectConfig?: ProjectConfig;
  private configOverrides: Record<string, unknown>;
  private registry: ActionRegistry;
  private clock?: Clock;
  private process?: ProcessAPI;
  private platform?: RuntimePlatform;
  private customHome?: string;
  private actionResolver?: LocalActionResolver;
  private hostSessionId?: string;
  private actionInvoker?: ActionInvoker;

  constructor(options: RunnerOptions) {
    if (!options.identity) {
      throw new Error("ActionRunner requires 'identity' PackageIdentity option");
    }
    this.identity = options.identity;
    this.packageId = this.identity.id;
    this.packageInstanceId = this.identity.instanceId;
    this.generationId = this.identity.generation;
    this.hostSessionId = options.hostSessionId;
    this.projectRoot = options.projectRoot;
    this.projectConfig = options.projectConfig;
    this.configOverrides = options.configOverrides || {};
    this.registry = new ActionRegistry(options.actions);
    this.customHome = options.customHome;
    this.platform = options.platform;
    this.actionInvoker = options.actionInvoker;
    this.actionResolver = options.actionResolver;

    if (!options.storage) {
      throw new Error("ActionRunner requires 'storage' option");
    }
    this.storage = options.storage;
    this.globalStorage = options.globalStorage;
    this.clock = options.clock ?? options.platform?.clock;
    this.process = options.process ?? options.platform?.process;
  }

  /** 本地 Action 注册表底层映射 */
  private get actions(): Map<string, ActionDefinition> {
    return this.registry.map;
  }

  public getStorage(): RuntimeStorage {
    return this.storage;
  }

  /**
   * 注册单个 Action 到当前 Runner。
   */
  public registerAction(id: string, action: ActionDefinition): void;
  public registerAction(action: ({ id: string; action?: ActionDefinition } & Partial<ActionDefinition>) | ActionDefinition): void;
  public registerAction(
    idOrAction: string | (({ id: string; action?: ActionDefinition } & Partial<ActionDefinition>) | ActionDefinition),
    actionDef?: ActionDefinition
  ): void {
    this.registry.registerAction(idOrAction as never, actionDef as ActionDefinition);
  }

  /**
   * 根据 ID 检索注册的 Action。
   */
  public getAction(id: string): ActionDefinition | undefined {
    return this.registry.getAction(id);
  }

  /**
   * 设置子任务动作调用委托器。
   */
  public setActionInvoker(invoker?: ActionInvoker): void {
    this.actionInvoker = invoker;
  }

  /**
   * 动态解析 Action（支持本地注册表、自定义解析器委托与已链接包目录索引检索）。
   *
   * @param actionOrRef Action 定义对象、引用或标识符
   * @returns 解析判别联合结果（found | not_found | load_failed）
   */
  public async resolveAction(
    actionOrRef: ActionDefinition | ActionRef | string
  ): Promise<ActionResolution> {
    if (isActionDefinitionObject(actionOrRef)) {
      return { status: "found", action: actionOrRef };
    }

    const ref = actionOrRef as ActionRef | string;
    let parsed: ActionRef;
    try {
      parsed = parseActionRef(ref);
    } catch (err: any) {
      return { status: "not_found", reason: err.message };
    }
    const targetActionId = parsed.actionId;
    const targetPackageId = parsed.packageId;

    // 铁律：ActionRunner 仅限执行当前包局部 Action，任何跨包请求直接拒绝，禁止跨包解析和执行
    if (targetPackageId && targetPackageId !== this.packageId) {
      return {
        status: "not_found",
        reason: `Cross-package action '${targetPackageId}/${targetActionId}' cannot be resolved by ActionRunner of package '${this.packageId}'`,
      };
    }

    // 本地 actions 映射表优先检索
    const localMatched = findLocalAction(this.actions, parsed, this.packageId);
    if (localMatched) {
      return { status: "found", action: localMatched };
    }

    // 外部注入的局部 actionResolver 调度
    if (this.actionResolver) {
      try {
        const customResolved = await this.actionResolver(targetActionId);
        if (customResolved) {
          this.actions.set(targetActionId, customResolved);
          if (this.packageId) {
            this.actions.set(`${this.packageId}/${targetActionId}`, customResolved);
          }
          return { status: "found", action: customResolved };
        }
      } catch (err: any) {
        return { status: "not_found", reason: err.message };
      }
    }

    // 铁律 4：Runner 仅执行自己所属 Package 的 Action，在本包 projectRoot 下按需加载本地 Action
    if ((!targetPackageId || targetPackageId === this.packageId) && this.projectRoot && existsSync(this.projectRoot)) {
      let config: ProjectConfig;
      try {
        config = this.projectConfig || loadProjectConfig(this.projectRoot);
      } catch (err: any) {
        return {
          status: "load_failed",
          error: err instanceof Error ? err : new Error(String(err)),
          packageId: this.packageId,
          projectRoot: this.projectRoot,
        };
      }

      let actionsMap: Map<string, ActionDefinition>;
      try {
        actionsMap = await loadActions(this.projectRoot, config.actionsDir, {
          loader: this.platform?.modules,
        });
      } catch (err: any) {
        return {
          status: "load_failed",
          error: err instanceof Error ? err : new Error(String(err)),
          packageId: this.packageId,
          projectRoot: this.projectRoot,
        };
      }

      const matched = actionsMap.get(targetActionId);
      if (matched) {
        this.actions.set(targetActionId, matched);
        if (this.packageId) {
          this.actions.set(`${this.packageId}/${targetActionId}`, matched);
        }
        return { status: "found", action: matched };
      }
    }

    // 铁律 4：Runner 不找 Package：只能执行自己所属 Package 的 Action
    if (targetPackageId && targetPackageId !== this.packageId) {
      return {
        status: "not_found",
        reason: `Runner for package '${this.packageId}' cannot resolve external package '${targetPackageId}'`,
      };
    }

    return {
      status: "not_found",
      reason: `Action '${targetActionId}' not found in package '${this.packageId}'`,
    };
  }

  /**
   * 获取当前 Runner 已注册的所有 Action 列表。
   */
  public listActions(): ActionDefinition[] {
    return this.registry.listActions();
  }

  /**
   * 异步启动 Action 的执行并立即返回 ExecutionHandle 句柄。
   *
   * @param actionOrId Action 定义对象、引用或标识符
   * @param input 传递给 Action 的输入数据
   * @param options 执行控制选项（超时、取消信号、父运行 ID 等）
   * @returns 包含 runId、result Promise 和 cancel 方法的执行句柄
   */
  start(
    actionOrId: ActionDefinition | ActionRef | string,
    input: unknown = {},
    options: ExecutionStartOptions = {}
  ): ExecutionHandle {
    const runCtx = this.prepareRunContext(actionOrId, input, options);
    const { runId, targetActionId, targetPackageId } = runCtx;

    // 输入参数 JSON 格式与合法性防御校验（拦截 NaN/Infinity/循环引用等非 JSON 类型及非法原型键策略违规）
    const inputCheck = validateActionInputValue(input);
    if (!inputCheck.valid) {
      const error: RuntimeError =
        inputCheck.kind === "json-value"
          ? {
              code: INPUT_NOT_JSON,
              message: `Input validation failed for action '${targetActionId}': ${inputCheck.reason}`,
            }
          : {
              code: INPUT_VALIDATION_FAILED,
              message: `Input validation failed for action '${targetActionId}': ${inputCheck.reason}`,
              details: [inputCheck.reason],
            };
      // 安全记录 failed 状态（不可序列化或策略违规的非法 input 严禁直接写入持久化存储）
      tryCreateRun(this.storage, buildInitialRunRecord(this.buildRunPersistenceInput(runCtx), "failed", error));
      return {
        runId,
        result: Promise.resolve({ ok: false, runId, error }),
        cancel: () => false,
      };
    }

    // 始终优先将执行尝试持久化到存储中（确保任意异常与终态都可追溯）
    createRunOrThrow(this.storage, buildInitialRunRecord(this.buildRunPersistenceInput(runCtx), "running"));
    const finalizer = createRunFinalizer(this.storage, runCtx.runId);

    // 记录调用栈快照（供子任务追溯）
    const callKey = targetPackageId ? `${targetPackageId}/${targetActionId}` : targetActionId;
    runCtx.callStack.push(callKey);

    // 输入参数 JSON Schema 校验（若 action 已就绪）
    const schemaError = this.checkActionInputSchema(runCtx.action, targetActionId, input);
    if (schemaError) {
      finalizer.finalize("failed", undefined, schemaError);
      return {
        runId,
        result: Promise.resolve({ ok: false, runId, error: schemaError }),
        cancel: () => false,
      };
    }

    // 初始化 AbortController 与超时定时器
    const controller = new AbortController();
    let onAbort: (() => void) | undefined;
    if (options.signal) {
      if (options.signal.aborted) {
        controller.abort(options.signal.reason);
      } else {
        onAbort = () => controller.abort(options.signal?.reason);
        options.signal.addEventListener(
          "abort",
          onAbort,
          { once: true }
        );
        finalizer.signal = options.signal;
        finalizer.onAbort = onAbort;
      }
    }

    if (typeof options.timeoutMs === "number" && options.timeoutMs > 0) {
      finalizer.startTimeout(controller, options.timeoutMs);
    }

    // 构建 ActionContext 运行时上下文
    const ctx = this.buildActionContext({
      runCtx,
      controller,
      rootRunId: this.computeRootRunId(runCtx),
    });

    // 执行 Action 业务逻辑并与取消/超时信号进行竞态
    const executionPromise = this.raceExecutionAndAbort({
      runCtx,
      actionOrId,
      input,
      options,
      controller,
      finalizer,
      ctx,
    });

    return {
      runId,
      result: executionPromise,
      cancel: (reason?: string): boolean => {
        if (finalizer.finalized || controller.signal.aborted) {
          return false;
        }
        if (options.signal && onAbort) {
          options.signal.removeEventListener("abort", onAbort);
          finalizer.onAbort = undefined;
        }
        controller.abort(new Error(reason || "Action execution was cancelled"));
        return true;
      },
    };
  }

  /**
   * 计算根运行标识（优先显式 rootRunId，其次 parentRunId，最后自身 runId）。
   */
  private computeRootRunId(runCtx: RunExecutionContext): string {
    return runCtx.options.rootRunId || runCtx.options.parentRunId || runCtx.runId;
  }

  /**
   * 预解析执行目标并装配运行期共享上下文对象（runId、目标标识、时钟源与调用栈快照）。
   */
  private prepareRunContext(
    actionOrId: ActionDefinition | ActionRef | string,
    input: unknown,
    options: ExecutionStartOptions
  ): RunExecutionContext {
    const runId = options.runId || randomUUID();
    const effectiveClock = options.platform?.clock ?? this.clock;
    const effectiveProcess = options.process || options.platform?.process || this.process;
    const startedAt =
      effectiveClock?.now().toISOString() ||
      (typeof (this.storage as any).clock?.now === "function"
        ? (this.storage as any).clock.now().toISOString()
        : new Date().toISOString());
    const callStack = [...(options.callStack || [])];

    let action: ActionDefinition | undefined;
    let targetActionId: string;
    let targetPackageId: string = this.packageId;

    if (isActionDefinitionObject(actionOrId)) {
      action = actionOrId;
      const actObj = action as any;
      if (actObj.id) {
        targetActionId = actObj.id;
      } else {
        targetActionId = resolveAnonymousActionId(this.actions, action);
      }
      this.actions.set(targetActionId, action);
    } else {
      const parsed = parseActionRef(actionOrId as ActionRef | string);
      targetActionId = parsed.actionId;
      if (parsed.packageId) {
        targetPackageId = parsed.packageId;
      }

      action = findLocalAction(this.actions, parsed, this.packageId);
    }

    return {
      runId,
      options,
      input,
      action,
      actionOrId,
      targetActionId,
      targetPackageId,
      effectiveProcess,
      startedAt,
      callStack,
    };
  }

  /**
   * 依据运行期上下文装配落库模块入参（RunRecord 构造领域契约）。
   */
  private buildRunPersistenceInput(runCtx: RunExecutionContext): InitialRunRecordInput {
    const { options, targetPackageId, targetActionId, startedAt, input } = runCtx;
    return {
      runId: runCtx.runId,
      rootRunId: this.computeRootRunId(runCtx),
      parentRunId: options.parentRunId,
      ownerId: options.ownerId,
      hostSessionId: options.hostSessionId,
      packageInstanceId: options.packageInstanceId,
      generationId: options.generationId,
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


  /**
   * 输入参数 JSON Schema 校验（若 action 已就绪，返回校验错误或 undefined）。
   */
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

  /**
   * 构建 ActionContext 运行时上下文（内嵌子 Action 调用委托提为私有方法）。
   */
  private buildActionContext(args: {
    runCtx: RunExecutionContext;
    controller: AbortController;
    rootRunId: string;
  }) {
    const { runCtx, controller, rootRunId } = args;
    const { options, targetPackageId, targetActionId, effectiveProcess } = runCtx;
    const effectiveOwner: ProcessOwner = options.owner || {
      tenantId: options.tenantId || "default",
      principalId: options.principalId || options.ownerId || "default",
      packageInstanceId: options.packageInstanceId || this.packageInstanceId,
      generationId: options.generationId || this.generationId,
    };
    return createActionContext({
      actionId: targetActionId,
      storage: this.storage,
      globalStorage: this.globalStorage,
      overrides: { ...this.configOverrides, ...(options.configOverrides || {}) },
      projectConfig: this.projectConfig,
      runId: runCtx.runId,
      rootRunId,
      parentRunId: options.parentRunId,
      signal: controller.signal,
      process: effectiveProcess,
      owner: effectiveOwner,
      progress: options.progress,
      logger: options.logger || new StderrLogger(targetActionId),
      onActionInvoke: (childAction, childInput, parentRunId) =>
        this.invokeChildAction({
          runCtx,
          controller,
          rootRunId,
          childAction,
          childInput,
          parentRunId,
        }),
    });
  }

  /**
   * 子 Action 调用委托：
   * 必须委托 Host 动作调用器（走 Host 执行主链与 InvocationPolicy 鉴权）；
   * 缺少 actionInvoker 时直接抛出 INVOCATION_UNSUPPORTED，严禁跨包或同包无约束执行逃逸。
   */
  private async invokeChildAction(args: {
    runCtx: RunExecutionContext;
    controller: AbortController;
    rootRunId: string;
    childAction: ActionRef | string;
    childInput: unknown;
    parentRunId?: string;
  }): Promise<unknown> {
    const { runCtx, controller, rootRunId, childAction, childInput, parentRunId } = args;
    const { options, effectiveProcess, callStack } = runCtx;

    const invoker = options.actionInvoker || this.actionInvoker;
    if (!invoker) {
      throw new ActionDockError(
        INVOCATION_UNSUPPORTED,
        "Nested action invocation requires a Host ActionInvoker"
      );
    }

    const effectiveParentOwner: ProcessOwner = options.owner || {
      tenantId: options.tenantId || "default",
      principalId: options.principalId || options.ownerId || "default",
      packageInstanceId: this.packageInstanceId,
      generationId: this.generationId,
    };

    const childRunId = randomUUID();
    const invocationContext: InvocationContext = {
      runId: childRunId,
      rootRunId,
      parentRunId: parentRunId || runCtx.runId,
      caller: {
        packageId: this.packageId,
        actionId: runCtx.targetActionId,
        runId: runCtx.runId,
        declaredUses:
          (runCtx.action as any)?.uses ||
          this.projectConfig?.actions?.[runCtx.targetActionId]?.uses,
      },
      callStack: [...callStack],
      package: this.identity,
      signal: controller.signal,
      timeoutMs: options.timeoutMs,
      maxCallDepth: options.maxCallDepth,
      config: options.configOverrides,
      tenantId: effectiveParentOwner.tenantId,
      principalId: effectiveParentOwner.principalId,
      hostSessionId: options.hostSessionId || this.hostSessionId,
      logger: options.logger,
      progress: options.progress,
      process: effectiveProcess,
      platform: options.platform || this.platform,
      owner: effectiveParentOwner,
    };
    return await invoker(childAction, childInput, invocationContext);
  }

  /**
   * 执行 Action 业务逻辑并与取消/超时信号进行竞态，返回执行结果信封 Promise。
   */
  private raceExecutionAndAbort(args: {
    runCtx: RunExecutionContext;
    actionOrId: ActionDefinition | ActionRef | string;
    input: unknown;
    options: ExecutionStartOptions;
    controller: AbortController;
    finalizer: RunFinalizer;
    ctx: ReturnType<ActionRunner["buildActionContext"]>;
  }): Promise<ExecutionResult> {
    const { runCtx, actionOrId, input, options, controller, finalizer, ctx } = args;
    const { runId, targetActionId } = runCtx;

    const abortPromise = new Promise<never>((_, reject) => {
      const rejectWithReason = () =>
        reject(controller.signal.reason || new Error("Action execution was cancelled"));
      if (controller.signal.aborted) {
        rejectWithReason();
      } else {
        controller.signal.addEventListener("abort", rejectWithReason, { once: true });
        // 成功与失败路径统一注销：finalize 时回收监听句柄，避免信号对象残留引用
        finalizer.raceListenerRemovers.push(() => {
          controller.signal.removeEventListener("abort", rejectWithReason);
        });
      }
    });

    return (async (): Promise<ExecutionResult> => {
      try {
        let currentAction = runCtx.action;
        if (!currentAction) {
          const resolution = await this.resolveAction(actionOrId);
          if (resolution.status === "found") {
            currentAction = resolution.action;
            runCtx.action = currentAction;
          } else if (resolution.status === "load_failed") {
            const cause = resolution.error;
            const error: RuntimeError = describeActionLoadFailure(cause, {
              actionId: targetActionId,
              packageId: resolution.packageId,
              projectRoot: resolution.projectRoot,
            });
            finalizer.finalize("failed", undefined, error);
            return { ok: false, runId, error };
          } else {
            const error: RuntimeError = {
              code: ACTION_NOT_FOUND,
              message: `Action '${targetActionId}' not found in registry or linked packages`,
              details: resolution.reason ? { reason: resolution.reason } : undefined,
            };
            finalizer.finalize("failed", undefined, error);
            return { ok: false, runId, error };
          }

          const inputCheck = validateActionInputValue(input);
          if (!inputCheck.valid) {
            const error: RuntimeError =
              inputCheck.kind === "json-value"
                ? {
                    code: INPUT_NOT_JSON,
                    message: `Input validation failed for action '${targetActionId}': ${inputCheck.reason}`,
                  }
                : {
                    code: INPUT_VALIDATION_FAILED,
                    message: `Input validation failed for action '${targetActionId}': ${inputCheck.reason}`,
                    details: [inputCheck.reason],
                  };
            finalizer.finalize("failed", undefined, error);
            return { ok: false, runId, error };
          }

          // 复用统一校验入口：优先 action 声明 schema，缺失时回退 projectConfig 清单声明
          const schemaError = this.checkActionInputSchema(currentAction, targetActionId, input);
          if (schemaError) {
            finalizer.finalize("failed", undefined, schemaError);
            return { ok: false, runId, error: schemaError };
          }
        }

        const rawOutput = await Promise.race([
          Promise.resolve().then(() => currentAction!.run(input, ctx)),
          abortPromise,
        ]);

        // 输出结果非 JSON 格式与合法性校验（拦截 NaN/Infinity/循环引用等）
        const outputCheck = validateJsonValue(rawOutput);
        if (!outputCheck.valid) {
          const error: RuntimeError = {
            code: OUTPUT_NOT_JSON,
            message: `Output validation failed for action '${targetActionId}': ${outputCheck.reason}`,
          };
          finalizer.finalize("failed", undefined, error);
          return { ok: false, runId, error };
        }

        // 输出结果 Schema 校验
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
        return this.classifyExecutionError(err, runCtx, controller, finalizer);
      } finally {
        // 仅释放 run 级隔离实例；平台级共享 ContextProcessAPI 生命周期归平台所有，严禁在此误 dispose
        if (
          ctx &&
          (ctx as any).process?.runScoped === true &&
          typeof (ctx as any).process.dispose === "function"
        ) {
          try {
            await (ctx as any).process.dispose();
          } catch {}
        }
      }
    })();
  }

  /**
   * 输出结果 Schema 校验（返回校验错误或 undefined）。
   */
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

  /**
   * 异常分类收敛：超时、取消与业务失败分别映射为对应终态与错误码。
   */
  private classifyExecutionError(
    err: any,
    runCtx: RunExecutionContext,
    controller: AbortController,
    finalizer: RunFinalizer
  ): ExecutionResult {
    const { runId, options } = runCtx;

    if (finalizer.isTimeout) {
      const error: RuntimeError = {
        code: ACTION_TIMEOUT,
        message: `Action exceeded timeout of ${options.timeoutMs}ms`,
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

  /**
   * 释放 Runner 持有的资源。
   * 铁律 4：Runner 仅执行自己所属 Package 的 Action，不管理外部包生命周期。
   */
  public async dispose(): Promise<void> {}

  /**
   * 同步等待方式执行指定 Action，直接返回 ExecutionResult 信封结果。
   *
   * @param actionOrId Action 定义对象、引用或标识符
   * @param input 输入参数
   * @param options 执行控制选项
   */
  async execute(
    actionOrId: ActionDefinition | ActionRef | string,
    input: unknown = {},
    options: ExecutionStartOptions = {}
  ): Promise<ExecutionResult> {
    return this.start(actionOrId, input, options).result;
  }
}
