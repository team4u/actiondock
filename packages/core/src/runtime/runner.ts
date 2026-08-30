import { randomUUID } from "node:crypto";
import type {
  ActionContext,
  ActionDefinition,
  ExecutionResult,
  RuntimeError,
  RunRecord,
} from "@actiondock/sdk";
import type { ProjectConfig } from "../project/types";
import { validateSchema } from "../schema/validator";
import type { RuntimeStorage, TerminalRunStatus } from "../storage/types";
import { RuntimeConfig, RuntimeStateStore, StderrLogger } from "./context";

/**
 * ActionRunner 初始化配置选项。
 */
export interface RunnerOptions {
  /** 运行所属的 Package ID */
  packageId: string;
  /** 持久化运行时存储实例（SQLite） */
  storage: RuntimeStorage;
  /** 项目元数据配置 */
  projectConfig?: ProjectConfig;
  /** CLI 或上层注入的临时配置覆盖项 */
  configOverrides?: Record<string, unknown>;
  /** 预加载的 Action 映射表 */
  actions?: Map<string, ActionDefinition>;
}

/**
 * 启动 Action 执行时的可选控制参数。
 */
export interface ExecutionStartOptions {
  /** 父级运行 ID（嵌套调用场景下建立调用链树） */
  parentRunId?: string;
  /** 调用栈数组（用于检测 A -> B -> A 环路死锁） */
  callStack?: string[];
  /** 外部传入的 AbortSignal 取消信号 */
  signal?: AbortSignal;
  /** 最大超时时间（毫秒），超时将自动中止执行并标记为 ACTION_TIMEOUT */
  timeoutMs?: number;
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
  private projectConfig?: ProjectConfig;
  private configOverrides: Record<string, unknown>;
  private actions: Map<string, ActionDefinition>;

  constructor(options: RunnerOptions) {
    this.packageId = options.packageId;
    this.storage = options.storage;
    this.projectConfig = options.projectConfig;
    this.configOverrides = options.configOverrides || {};
    this.actions = options.actions || new Map();
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
   * 获取当前 Runner 已注册的所有 Action 列表。
   */
  public listActions(): ActionDefinition[] {
    return Array.from(this.actions.values());
  }

  /**
   * 异步启动 Action 的执行并立即返回 ExecutionHandle 句柄。
   * 
   * @param actionOrId Action 定义对象或已注册的 Action ID
   * @param input 传递给 Action 的输入数据
   * @param options 执行控制选项（超时、取消信号、父运行 ID 等）
   * @returns 包含 runId、result Promise 和 cancel 方法的执行句柄
   */
  start(
    actionOrId: ActionDefinition | string,
    input: unknown = {},
    options: ExecutionStartOptions = {}
  ): ExecutionHandle {
    const runId = randomUUID();
    const startedAt = new Date().toISOString();
    const callStack = [...(options.callStack || [])];

    let action: ActionDefinition;
    if (typeof actionOrId === "string") {
      const found = this.actions.get(actionOrId);
      if (!found) {
        const error: RuntimeError = {
          code: "ACTION_NOT_FOUND",
          message: `Action '${actionOrId}' not found in registry`,
        };
        return {
          runId,
          result: Promise.resolve({ ok: false, runId, error }),
          cancel: () => false,
        };
      }
      action = found;
    } else {
      action = actionOrId;
    }

    // 1. 环路死锁检测 (Cycle Detection)
    if (callStack.includes(action.id)) {
      const error: RuntimeError = {
        code: "ACTION_CYCLE_DETECTED",
        message: `Cycle detected in action invocation: ${callStack.join(" -> ")} -> ${action.id}`,
      };
      return {
        runId,
        result: Promise.resolve({ ok: false, runId, error }),
        cancel: () => false,
      };
    }
    callStack.push(action.id);

    // 2. 输入参数 JSON Schema 校验
    if (action.inputSchema) {
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
      packageId: this.packageId,
      actionId: action.id,
      parentRunId: options.parentRunId,
      status: "running",
      input,
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
    const config = new RuntimeConfig(
      this.storage,
      this.configOverrides,
      this.projectConfig
    );
    const state = new RuntimeStateStore(this.storage);
    const log = new StderrLogger(action.id);

    const invoker = {
      invoke: async <I, O>(
        childAction: ActionDefinition<I, O>,
        childInput: I
      ): Promise<O> => {
        const childResult = await this.execute(childAction, childInput, {
          parentRunId: runId,
          callStack,
          signal: controller.signal,
        });
        if (!childResult.ok) {
          const err = new Error(childResult.error.message);
          (err as any).code = childResult.error.code;
          (err as any).details = childResult.error.details;
          throw err;
        }
        return childResult.data as O;
      },
    };

    const ctx: ActionContext = {
      config,
      state,
      actions: invoker,
      log,
      signal: controller.signal,
    };

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
        const rawOutput = await Promise.race([
          Promise.resolve().then(() => action.run(input, ctx)),
          abortPromise,
        ]);

        // 输出结果 Schema 校验
        if (action.outputSchema) {
          const outVal = validateSchema(action.outputSchema, rawOutput);
          if (!outVal.valid) {
            const error: RuntimeError = {
              code: "OUTPUT_VALIDATION_FAILED",
              message: `Output schema validation failed for action '${action.id}'`,
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
          data: rawOutput,
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
   * @param actionOrId Action 定义对象或 ID
   * @param input 输入参数
   * @param options 执行控制选项
   */
  async execute(
    actionOrId: ActionDefinition | string,
    input: unknown = {},
    options: ExecutionStartOptions = {}
  ): Promise<ExecutionResult> {
    return this.start(actionOrId, input, options).result;
  }
}
