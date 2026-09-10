import {
  ActionRunner,
  DefaultExecutionService,
  type ExecutionService,
  type ExecutionStartOptions,
  InMemoryEventSink,
  type ProjectConfig,
  RuntimeConfig,
  RuntimeStateStore,
  type RuntimePlatform,
} from "@actiondock/core";
import {
  type ActionDefinition,
  type Config,
  type ExecutionEvent,
  type ExecutionResult,
  type JsonValue,
  type Logger,
  MemoryLogger,
  type ProgressReporter,
  type RuntimeError,
  type StateStore,
} from "@actiondock/sdk";
import { FakeClock } from "./clock";
import { MockProcessExecutor } from "./process";
import { MemoryStorage } from "./storage";

/**
 * 规范化运行时错误异常类。
 * 当 run 方法执行失败时抛出，完整实现 RuntimeError 契约。
 */
export class ActionRuntimeError extends Error implements RuntimeError {
  public code: string;
  public details?: unknown;

  constructor(error: RuntimeError) {
    super(error.message);
    this.name = "ActionRuntimeError";
    this.code = error.code;
    this.details = error.details;
    Object.setPrototypeOf(this, ActionRuntimeError.prototype);
  }
}

/**
 * 带有写入和调试能力的配置接口。
 */
export interface TestConfig extends Config {
  /** 写入配置键值 */
  set(key: string, value: unknown): void;
  /** 删除指定配置键 */
  delete(key: string): boolean;
  /** 列出所有已存储配置项 */
  list(): Record<string, unknown>;
}

/**
 * 测试配置管理器实现。
 */
export class TestConfigStore implements TestConfig {
  private runtimeConfig: RuntimeConfig;
  private storage: MemoryStorage;

  constructor(
    storage: MemoryStorage,
    projectConfig?: ProjectConfig,
    overrides?: Record<string, unknown>
  ) {
    this.storage = storage;
    this.runtimeConfig = new RuntimeConfig(
      storage,
      overrides,
      projectConfig,
      undefined
    );
  }

  get<T = unknown>(key: string): T | undefined;
  get<T = unknown>(key: string, defaultValue: T): T;
  get<T = unknown>(key: string, defaultValue?: T): T | undefined {
    return this.runtimeConfig.get(key, defaultValue as T);
  }

  has(key: string): boolean {
    return this.runtimeConfig.has(key);
  }

  set(key: string, value: unknown): void {
    this.storage.setConfig(key, value);
  }

  delete(key: string): boolean {
    return this.storage.deleteConfig(key);
  }

  list(): Record<string, unknown> {
    return this.storage.listConfig();
  }
}

/**
 * 测试事件接收器实现。
 * 记录执行期间产生的所有事件并支持历史检索。
 */
export class TestEventSink extends InMemoryEventSink {
  private allEvents: ExecutionEvent[] = [];
  private sequenceCounter = 0;

  /** 获取下一个单调自增序号 */
  nextSequence(): number {
    return this.sequenceCounter++;
  }

  override emit(event: ExecutionEvent): void {
    this.allEvents.push(event);
    super.emit(event);
  }

  /**
   * 检索历史事件列表。
   *
   * @param runId 可选运行标识筛选
   */
  getEvents(runId?: string): ExecutionEvent[] {
    if (runId) {
      return this.allEvents.filter((e) => e.runId === runId);
    }
    return [...this.allEvents];
  }

  /**
   * 清理所有捕获的事件记录。
   */
  clearAll(): void {
    this.allEvents = [];
    this.sequenceCounter = 0;
  }
}

/**
 * 测试运行时初始化选项。
 */
export interface TestRuntimeOptions {
  /** 绑定的 Package 标识 */
  packageId?: string;
  /** 初始注入的配置键值映射 */
  config?: Record<string, unknown>;
  /** 运行级别临时配置覆写字典 */
  configOverrides?: Record<string, unknown>;
  /** 初始注入的状态键值映射 */
  state?: Record<string, unknown>;
  /** 可选注入的模拟时钟实例 */
  clock?: FakeClock;
  /** 可选注入的模拟进程执行器 */
  process?: MockProcessExecutor;
  /** 可选注入的日志记录器（默认使用 MemoryLogger） */
  logger?: Logger;
  /** 可选注入的底层存储实例 */
  storage?: MemoryStorage;
  /** 项目静态配置元数据 */
  projectConfig?: ProjectConfig;
  /** 预注册的 Action 动作列表 */
  actions?:
    | Array<{ id: string; action: ActionDefinition } | (ActionDefinition & { id: string })>
    | Record<string, ActionDefinition>
    | Map<string, ActionDefinition>;
  /** 可选注入的标准运行时平台实例 */
  platform?: RuntimePlatform;
}

/**
 * 测试运行时接口。
 */
export interface TestRuntime {
  /** 调试配置接口 */
  config: TestConfig;
  /** 调试状态持久化接口 */
  state: StateStore;
  /** 调试模拟时钟接口 */
  clock: FakeClock;
  /** 调试模拟进程执行接口 */
  process: MockProcessExecutor;
  /** 调试执行事件捕获接口 */
  events: TestEventSink;
  /** 调试日志记录捕获接口 */
  logger: MemoryLogger;
  /** 底层存储引擎 */
  storage: MemoryStorage;
  /** 统一执行服务 */
  executionService: ExecutionService;
  /** 核心执行器引擎（向后兼容保留） */
  runner: ActionRunner;
  /** 注册 Action 动作定义 */
  registerAction(id: string, action: ActionDefinition): void;
  registerAction(action: ({ id: string; action?: ActionDefinition } & Partial<ActionDefinition>) | ActionDefinition): void;
  /** 获取已注册的 Action 动作定义 */
  getAction(id: string): ActionDefinition | undefined;
  /** 列出已注册的所有 Action 动作定义 */
  listActions(): ActionDefinition[];
  /**
   * 执行 Action 并直接返回业务结果数据，失败时抛出 ActionRuntimeError 规范化异常。
   *
   * @param action Action 动作定义或已注册标识
   * @param input 输入参数数据
   */
  run<I = unknown, O = unknown>(
    action: ActionDefinition<I, O> | string,
    input?: I
  ): Promise<O>;
  /**
   * 执行 Action 并返回完整的 ExecutionResult 信封结构。
   *
   * @param action Action 动作定义或已注册标识
   * @param input 输入参数数据
   * @param options 可选执行控制参数
   */
  execute<I = unknown, O = unknown>(
    action: ActionDefinition<I, O> | string,
    input?: I,
    options?: ExecutionStartOptions
  ): Promise<ExecutionResult<O>>;
}

const anonymousTestActions = new WeakMap<object, string>();
let anonymousTestActionCounter = 0;

/**
 * 创建全功能测试运行时实例。
 * 基于统一 ExecutionService 协调执行全生命周期，并暴露配置、状态、时钟、进程与事件等调试接口。
 *
 * @param options 测试运行时选项
 */
export function createTestRuntime(options: TestRuntimeOptions = {}): TestRuntime {
  const packageId = options.packageId || "test-pkg";
  const clock =
    options.clock ??
    (options.platform?.clock instanceof FakeClock ? options.platform.clock : new FakeClock());
  const process =
    options.process ??
    (options.platform?.process instanceof MockProcessExecutor
      ? options.platform.process
      : new MockProcessExecutor());
  const storage =
    options.storage ??
    (options.platform?.storage
      ? (options.platform.storage.createStorage(packageId) as MemoryStorage)
      : new MemoryStorage({
          packageId,
          clock,
        }));

  // 初始化配置数据
  if (options.config) {
    for (const [key, val] of Object.entries(options.config)) {
      storage.setConfig(key, val);
    }
  }

  // 初始化状态数据
  if (options.state) {
    for (const [key, val] of Object.entries(options.state)) {
      storage.setState("", key, val);
    }
  }

  const events = new TestEventSink();
  const memoryLogger =
    options.logger instanceof MemoryLogger ? options.logger : new MemoryLogger();

  const actionsMap = new Map<string, ActionDefinition>();
  if (options.actions) {
    if (Array.isArray(options.actions)) {
      for (const item of options.actions as any[]) {
        const id = item.id;
        const act = item.action ?? item;
        if (id) {
          actionsMap.set(id, act);
        }
      }
    } else if (options.actions instanceof Map) {
      for (const [k, v] of options.actions) {
        actionsMap.set(k, v);
      }
    } else if (typeof options.actions === "object") {
      for (const [k, v] of Object.entries(options.actions)) {
        actionsMap.set(k, v as ActionDefinition);
      }
    }
  }

  const executionService = new DefaultExecutionService({
    packageId,
    storage,
    projectConfig: options.projectConfig,
    configOverrides: options.configOverrides,
    actions: actionsMap,
    process,
    clock,
    logger: memoryLogger,
    eventSink: events,
    platform: options.platform,
  });

  const testConfig = new TestConfigStore(
    storage,
    options.projectConfig,
    options.configOverrides
  );

  const testState = new RuntimeStateStore(storage);

  const registerAction = (
    idOrAction: string | (({ id: string; action?: ActionDefinition } & Partial<ActionDefinition>) | ActionDefinition),
    maybeAction?: ActionDefinition
  ): void => {
    if (typeof idOrAction === "string") {
      executionService.registerAction(idOrAction, maybeAction!);
      if (maybeAction) {
        actionsMap.set(idOrAction, maybeAction);
      }
    } else {
      const actObj = idOrAction as any;
      const id = actObj.id;
      const act = actObj.action || (actObj.run ? actObj : undefined);
      if (id && act) {
        actionsMap.set(id, act);
      }
      executionService.registerAction(idOrAction);
    }
  };

  const getAction = (id: string): ActionDefinition | undefined => {
    return executionService.getAction(id);
  };

  const listActions = (): ActionDefinition[] => {
    return executionService.listActions();
  };

  const execute = async <I = unknown, O = unknown>(
    action: ActionDefinition<I, O> | string,
    input: I = {} as I,
    execOptions: ExecutionStartOptions = {}
  ): Promise<ExecutionResult<O>> => {
    let actionRef: string;
    if (typeof action !== "string") {
      const act = action as ActionDefinition;
      const actObj = act as any;
      let targetId = actObj.id;
      if (!targetId) {
        for (const [registeredId, registeredAct] of actionsMap) {
          if (registeredAct === act) {
            targetId = registeredId;
            break;
          }
        }
      }
      if (!targetId) {
        let anonId = anonymousTestActions.get(act);
        if (!anonId) {
          anonymousTestActionCounter++;
          anonId = `test-action-${anonymousTestActionCounter}`;
          anonymousTestActions.set(act, anonId);
        }
        targetId = anonId;
        try {
          actObj.id = targetId;
        } catch {}
      }
      executionService.registerAction(targetId, act);
      actionsMap.set(targetId, act);
      actionRef = targetId;
    } else {
      actionRef = action;
    }

    const ticket = await executionService.start(
      actionRef,
      input as JsonValue,
      {
        signal: execOptions.signal,
        timeoutMs: execOptions.timeoutMs,
        config: execOptions.configOverrides as Record<string, JsonValue> | undefined,
        parentRunId: execOptions.parentRunId,
        rootRunId: execOptions.rootRunId,
        maxCallDepth: execOptions.maxCallDepth,
        logger: execOptions.logger,
        progress: execOptions.progress,
        process: execOptions.process || process,
      }
    );

    const result = (await ticket.result) as ExecutionResult<O>;
    return result;
  };

  const run = async <I = unknown, O = unknown>(
    action: ActionDefinition<I, O> | string,
    input: I = {} as I
  ): Promise<O> => {
    const result = await execute<I, O>(action, input);
    if (!result.ok) {
      throw new ActionRuntimeError(result.error);
    }
    return result.data;
  };

  return {
    config: testConfig,
    state: testState,
    clock,
    process,
    events,
    logger: memoryLogger,
    storage,
    executionService,
    runner: (executionService as any).runner,
    registerAction,
    getAction,
    listActions,
    run,
    execute,
  };
}
