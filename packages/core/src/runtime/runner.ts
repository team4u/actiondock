import { existsSync } from "node:fs";
import { randomUUID } from "node:crypto";
import type {
  ActionContext,
  ActionDefinition,
  ActionRef,
  ExecutionResult,
  JsonValue,
  Logger,
  ProcessAPI,
  ProgressReporter,
  RuntimeError,
  RunRecord,
} from "@actiondock/sdk";
import { ActionResolver } from "../catalog/action-resolver";
import { loadActions, loadProjectConfig } from "../project/loader";
import type { ProjectConfig } from "../project/types";
import { resolveActionProject } from "../registry/registry";
import { validateSchema } from "../schema/validator";
import type { RuntimeStorage, TerminalRunStatus } from "../storage/types";
import type { Clock } from "./clock";
import { createActionContext, StderrLogger } from "./context";

/**
 * ActionRunner 初始化配置选项。
 */
export interface RunnerOptions {
  /** 运行所属的 Package ID */
  packageId: string;
  /** 持久化运行时存储实例（SQLite） */
  storage: RuntimeStorage;
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
  /** 动态解析跨包或未注册 Action 的委托函数 */
  actionResolver?: (
    ref: ActionRef | string,
    currentPackageId?: string
  ) => ActionDefinition | undefined | Promise<ActionDefinition | undefined>;
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
  /** 调用栈数组（用于检测 A -> B -> A 环路死锁） */
  callStack?: string[];
  /** 外部传入的 AbortSignal 取消信号 */
  signal?: AbortSignal;
  /** 最大超时时间（毫秒），超时将自动中止执行并标记为 ACTION_TIMEOUT */
  timeoutMs?: number;
  /** 外部注入的进程执行器 */
  process?: ProcessAPI;
  /** 外部注入的进度报告器 */
  progress?: ProgressReporter;
  /** 外部注入的日志记录器 */
  logger?: Logger;
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
 * ActionDock 核心执行引擎（ActionRunner）。
 * 
 * 职责：
 * 1. 负责 Action 执行的全生命周期管理（校验、隔离、跟踪、落库）。
 * 2. 入参 (inputSchema) 与出参 (outputSchema) 的 JSON Schema 严格校验。
 * 3. 嵌套 Action 相互调用的环路检测（Cycle Detection）。
 * 4. 超时 (Timeout) 与中断信号 (AbortSignal) 竞态控制。
 * 5. 自动记录并持久化 RunRecord 运行记录至 SQLite 存储。
 */
export class ActionRunner {
  private packageId: string;
  private storage: RuntimeStorage;
  private projectRoot?: string;
  private projectConfig?: ProjectConfig;
  private configOverrides: Record<string, unknown>;
  private actions: Map<string, ActionDefinition>;
  private clock?: Clock;
  private actionResolver?: (
    ref: ActionRef | string,
    currentPackageId?: string
  ) => ActionDefinition | undefined | Promise<ActionDefinition | undefined>;

  constructor(options: RunnerOptions) {
    this.packageId = options.packageId;
    this.storage = options.storage;
    this.projectRoot = options.projectRoot;
    this.projectConfig = options.projectConfig;
    this.configOverrides = options.configOverrides || {};
    this.actions = options.actions || new Map();
    this.clock = options.clock;
    this.actionResolver = options.actionResolver;
  }

  /**
   * 注册单个 Action 到当前 Runner。
   */
  public registerAction(action: ActionDefinition): void {
    this.actions.set(action.id, action);
  }

  /**
   * 根据 ID 检索注册的 Action。
   */
  public getAction(id: string): ActionDefinition | undefined {
    return this.actions.get(id);
  }

  /**
   * 动态解析 Action（支持本地注册表、自定义解析器委托与已链接包目录索引检索）。
   * 
   * @param actionOrRef Action 定义对象、引用或标识符
   * @returns 解析出的 ActionDefinition，若未找到则返回 undefined
   */
  public async resolveAction(
    actionOrRef: ActionDefinition | ActionRef | string
  ): Promise<ActionDefinition | undefined> {
    if (
      typeof actionOrRef === "object" &&
      "run" in actionOrRef &&
      typeof (actionOrRef as any).run === "function"
    ) {
      return actionOrRef as ActionDefinition;
    }

    const ref = actionOrRef as ActionRef | string;
    const parsed = ActionResolver.parseRef(ref);
    const targetActionId = parsed.actionId;
    const targetPackageId = parsed.packageId;

    // 1. 本地 actions 映射表优先检索
    if (targetPackageId && targetPackageId !== this.packageId) {
      if (this.actions.has(`${targetPackageId}/${targetActionId}`)) {
        return this.actions.get(`${targetPackageId}/${targetActionId}`);
      }
    } else {
      if (this.actions.has(targetActionId)) {
        return this.actions.get(targetActionId);
      }
      if (this.packageId && this.actions.has(`${this.packageId}/${targetActionId}`)) {
        return this.actions.get(`${this.packageId}/${targetActionId}`);
      }
    }

    // 2. 外部注入的自定义 actionResolver 调度
    if (this.actionResolver) {
      const customResolved = await this.actionResolver(ref, this.packageId);
      if (customResolved) {
        if (targetPackageId && targetPackageId !== this.packageId) {
          this.actions.set(`${targetPackageId}/${targetActionId}`, customResolved);
        } else {
          this.actions.set(targetActionId, customResolved);
          if (this.packageId) {
            this.actions.set(`${this.packageId}/${targetActionId}`, customResolved);
          }
        }
        return customResolved;
      }
    }

    // 3. 基于全局链接注册表与目录索引的动态寻址与按需加载
    try {
      const identifier = targetPackageId
        ? `${targetPackageId}/${targetActionId}`
        : targetActionId;
      const resolved = await resolveActionProject(identifier, this.projectRoot);
      if (resolved && existsSync(resolved.projectRoot)) {
        const config = loadProjectConfig(resolved.projectRoot);
        const actionsMap = await loadActions(resolved.projectRoot, config.actionsDir, {
          autoInstall: false,
        });
        const matched = actionsMap.get(resolved.actionId);
        if (matched) {
          this.actions.set(`${resolved.packageId}/${resolved.actionId}`, matched);
          // 仅当目标包就是当前项目时才注册短标识符，避免跨包动态载入污染全局短标识符
          if (!targetPackageId || resolved.packageId === this.packageId) {
            this.actions.set(resolved.actionId, matched);
          }
          return matched;
        }
      }
    } catch {
      // 忽略寻址异常并返回 undefined
    }

    return undefined;
  }

  /**
   * 获取当前 Runner 已注册的所有 Action 列表。
   */
  public listActions(): ActionDefinition[] {
    return Array.from(this.actions.values());
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
    const runId = options.runId || randomUUID();
    const startedAt =
      this.clock?.now().toISOString() ||
      (typeof (this.storage as any).clock?.now === "function"
        ? (this.storage as any).clock.now().toISOString()
        : new Date().toISOString());
    const callStack = [...(options.callStack || [])];

    let action: ActionDefinition | undefined;
    let targetActionId: string;
    let targetPackageId: string = this.packageId;

    if (
      typeof actionOrId === "object" &&
      "run" in actionOrId &&
      typeof (actionOrId as any).run === "function"
    ) {
      action = actionOrId as ActionDefinition;
      targetActionId = action.id;
    } else {
      const parsed = ActionResolver.parseRef(actionOrId as ActionRef | string);
      targetActionId = parsed.actionId;
      if (parsed.packageId) {
        targetPackageId = parsed.packageId;
      }

      if (parsed.packageId && parsed.packageId !== this.packageId) {
        action = this.actions.get(`${parsed.packageId}/${targetActionId}`);
      } else {
        action =
          this.actions.get(targetActionId) ||
          (this.packageId ? this.actions.get(`${this.packageId}/${targetActionId}`) : undefined);
      }
    }

    // 1. 环路死锁检测 (Cycle Detection)
    const isExternal = Boolean(targetPackageId && targetPackageId !== this.packageId);
    const callKey = isExternal
      ? `${targetPackageId}/${targetActionId}`
      : targetActionId;

    const hasCycle = isExternal
      ? callStack.includes(callKey)
      : (callStack.includes(callKey) || (this.packageId ? callStack.includes(`${this.packageId}/${targetActionId}`) : false));

    if (hasCycle) {
      const error: RuntimeError = {
        code: "ACTION_CYCLE_DETECTED",
        message: `Cycle detected in action invocation: ${callStack.join(" -> ")} -> ${callKey}`,
      };
      return {
        runId,
        result: Promise.resolve({ ok: false, runId, error }),
        cancel: () => false,
      };
    }
    callStack.push(callKey);

    // 2. 输入参数 JSON Schema 校验（若 action 已就绪）
    if (action?.inputSchema) {
      const val = validateSchema(action.inputSchema, input);
      if (!val.valid) {
        const error: RuntimeError = {
          code: "INPUT_VALIDATION_FAILED",
          message: `Input schema validation failed for action '${action.id}'`,
          details: val.errors,
        };
        return {
          runId,
          result: Promise.resolve({ ok: false, runId, error }),
          cancel: () => false,
        };
      }
    }

    // 3. 插入初始运行记录 (状态: running)
    const initialRun: RunRecord = {
      id: runId,
      rootRunId: options.rootRunId || options.parentRunId || runId,
      parentRunId: options.parentRunId,
      packageId: targetPackageId,
      packageInstanceId: options.packageInstanceId || targetPackageId,
      actionId: targetActionId,
      generationId: options.generationId || "1",
      ownerId: options.ownerId || "local",
      status: "running",
      input: input as JsonValue | undefined,
      startedAt,
    };
    this.storage.createRun(initialRun);

    // 4. 初始化 AbortController 与超时定时器
    const controller = new AbortController();
    if (options.signal) {
      if (options.signal.aborted) {
        controller.abort(options.signal.reason);
      } else {
        options.signal.addEventListener(
          "abort",
          () => controller.abort(options.signal?.reason),
          { once: true }
        );
      }
    }

    let isTimeout = false;
    let timeoutTimer: ReturnType<typeof setTimeout> | undefined;
    if (typeof options.timeoutMs === "number" && options.timeoutMs > 0) {
      timeoutTimer = setTimeout(() => {
        isTimeout = true;
        controller.abort(new Error(`Action exceeded timeout of ${options.timeoutMs}ms`));
      }, options.timeoutMs);
    }

    let finalized = false;
    const finalizeRun = (
      status: TerminalRunStatus,
      output?: unknown,
      error?: RuntimeError
    ) => {
      if (timeoutTimer) {
        clearTimeout(timeoutTimer);
        timeoutTimer = undefined;
      }
      if (finalized) return;
      finalized = true;
      this.storage.updateRun(runId, status, output, error);
    };

    // 5. 构建 ActionContext 运行时上下文
    const ctx = createActionContext({
      storage: this.storage,
      overrides: this.configOverrides,
      projectConfig: this.projectConfig,
      runId,
      rootRunId: initialRun.rootRunId,
      parentRunId: options.parentRunId,
      signal: controller.signal,
      process: options.process,
      progress: options.progress,
      logger: options.logger || new StderrLogger(action?.id || targetActionId),
      onActionInvoke: async (childAction, childInput, parentRunId) => {
        const childResult = await this.execute(childAction, childInput, {
          rootRunId: initialRun.rootRunId,
          parentRunId,
          callStack,
          signal: controller.signal,
          process: options.process,
          progress: options.progress,
          logger: options.logger,
        });
        if (!childResult.ok) {
          const err = new Error(childResult.error.message);
          (err as any).code = childResult.error.code;
          (err as any).details = childResult.error.details;
          throw err;
        }
        return childResult.data;
      },
    });

    // 6. 执行 Action 业务逻辑并与取消/超时信号进行竞态
    const abortPromise = new Promise<never>((_, reject) => {
      if (controller.signal.aborted) {
        reject(controller.signal.reason || new Error("Action execution was cancelled"));
      } else {
        controller.signal.addEventListener(
          "abort",
          () => reject(controller.signal.reason || new Error("Action execution was cancelled")),
          { once: true }
        );
      }
    });

    const executionPromise = (async (): Promise<ExecutionResult> => {
      try {
        let currentAction = action;
        if (!currentAction) {
          currentAction = await this.resolveAction(actionOrId);
          if (!currentAction) {
            const error: RuntimeError = {
              code: "ACTION_NOT_FOUND",
              message: `Action '${targetActionId}' not found in registry or linked packages`,
            };
            finalizeRun("failed", undefined, error);
            return { ok: false, runId, error };
          }

          if (currentAction.inputSchema) {
            const val = validateSchema(currentAction.inputSchema, input);
            if (!val.valid) {
              const error: RuntimeError = {
                code: "INPUT_VALIDATION_FAILED",
                message: `Input schema validation failed for action '${currentAction.id}'`,
                details: val.errors,
              };
              finalizeRun("failed", undefined, error);
              return { ok: false, runId, error };
            }
          }
        }

        const rawOutput = await Promise.race([
          Promise.resolve().then(() => currentAction!.run(input, ctx)),
          abortPromise,
        ]);

        // 输出结果 Schema 校验
        if (currentAction.outputSchema) {
          const outVal = validateSchema(currentAction.outputSchema, rawOutput);
          if (!outVal.valid) {
            const error: RuntimeError = {
              code: "OUTPUT_VALIDATION_FAILED",
              message: `Output schema validation failed for action '${currentAction.id}'`,
              details: outVal.errors,
            };
            finalizeRun("failed", undefined, error);
            return { ok: false, runId, error };
          }
        }

        finalizeRun("success", rawOutput);
        return {
          ok: true,
          runId,
          data: rawOutput as JsonValue,
        };
      } catch (err: any) {
        if (isTimeout) {
          const error: RuntimeError = {
            code: "ACTION_TIMEOUT",
            message: `Action exceeded timeout of ${options.timeoutMs}ms`,
          };
          finalizeRun("failed", undefined, error);
          return { ok: false, runId, error };
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
            code: "ACTION_CANCELLED",
            message: "Action execution was cancelled",
            details: reasonMsg ? { reason: reasonMsg } : undefined,
          };
          finalizeRun("cancelled", undefined, error);
          return { ok: false, runId, error };
        }

        const error: RuntimeError = {
          code: err?.code || "ACTION_FAILED",
          message: err?.message || String(err),
          details: err?.details,
        };
        finalizeRun("failed", undefined, error);
        return {
          ok: false,
          runId,
          error,
        };
      }
    })();

    return {
      runId,
      result: executionPromise,
      cancel: (reason?: string): boolean => {
        if (finalized || controller.signal.aborted) {
          return false;
        }
        controller.abort(new Error(reason || "Action execution was cancelled"));
        return true;
      },
    };
  }

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
