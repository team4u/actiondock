import {
  ActionRunner,
  type ExecutionStartOptions,
  InMemoryEventSink,
  type ProjectConfig,
  RuntimeConfig,
  RuntimeStateStore,
  setDefaultEventSink,
  setProcessExecutor,
  setSystemClock,
} from "@actiondock/core";
import type {
  ActionDefinition,
  Config,
  ExecutionEvent,
  ExecutionResult,
  JsonValue,
  ProgressReporter,
  RuntimeError,
  StateStore,
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
  public cause?: unknown;

  constructor(error: RuntimeError) {
    super(error.message);
    this.name = "ActionRuntimeError";
    this.code = error.code;
    this.details = error.details;
    this.cause = error.cause;
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
  /** 可选注入的底层存储实例 */
  storage?: MemoryStorage;
  /** 项目静态配置元数据 */
  projectConfig?: ProjectConfig;
  /** 预注册的 Action 动作列表 */
  actions?: ActionDefinition[];
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
  /** 底层存储引擎 */
  storage: MemoryStorage;
  /** 核心执行器引擎 */
  runner: ActionRunner;
  /** 注册 Action 动作定义 */
  registerAction(action: ActionDefinition): void;
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

/**
 * 创建全功能测试运行时实例。
 * 复用真实的 ActionRunner 执行全生命周期，并暴露配置、状态、时钟、进程与事件等调试接口。
 *
 * @param options 测试运行时选项
 */
export function createTestRuntime(options: TestRuntimeOptions = {}): TestRuntime {
  const packageId = options.packageId || "test-pkg";
  const clock = options.clock ?? new FakeClock();
  const process = options.process ?? new MockProcessExecutor();
  const storage =
    options.storage ??
    new MemoryStorage({
      packageId,
      clock,
    });

  // 全局注入测试时钟与进程执行器
  setSystemClock(clock);
  setProcessExecutor(process);

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
  setDefaultEventSink(events);

  const actionsMap = new Map<string, ActionDefinition>();
  if (options.actions) {
    for (const act of options.actions) {
      actionsMap.set(act.id, act);
    }
  }

  const runner = new ActionRunner({
    packageId,
    storage,
    projectConfig: options.projectConfig,
    configOverrides: options.configOverrides,
    actions: actionsMap,
    process,
  });

  const testConfig = new TestConfigStore(
    storage,
    options.projectConfig,
    options.configOverrides
  );

  const testState = new RuntimeStateStore(storage);

  const registerAction = (action: ActionDefinition): void => {
    runner.registerAction(action);
  };

  const getAction = (id: string): ActionDefinition | undefined => {
    return runner.getAction(id);
  };

  const listActions = (): ActionDefinition[] => {
    return runner.listActions();
  };

  const execute = async <I = unknown, O = unknown>(
    action: ActionDefinition<I, O> | string,
    input: I = {} as I,
    execOptions: ExecutionStartOptions = {}
  ): Promise<ExecutionResult<O>> => {
    if (typeof action !== "string") {
      runner.registerAction(action as ActionDefinition);
    }

    const actionId = typeof action === "string" ? action : action.id;

    // 组合进度报告器以发射执行事件
    const originalProgress = execOptions.progress;
    const progressReporter: ProgressReporter = {
      report(current: number, total?: number, message?: string) {
        if (originalProgress) {
          originalProgress.report(current, total, message);
        }
        events.emit({
          runId: handle.runId,
          rootRunId: execOptions.rootRunId || handle.runId,
          sequence: events.nextSequence(),
          timestamp: clock.now().toISOString(),
          type: "progress",
          current,
          total,
          message,
        });
      },
    };

    const startOptions: ExecutionStartOptions = {
      ...execOptions,
      process: execOptions.process || process,
      progress: progressReporter,
    };

    const handle = runner.start(action, input, startOptions);

    events.emit({
      runId: handle.runId,
      rootRunId: execOptions.rootRunId || handle.runId,
      sequence: events.nextSequence(),
      timestamp: clock.now().toISOString(),
      type: "status",
      status: "running",
    });

    const result = (await handle.result) as ExecutionResult<O>;

    events.emit({
      runId: handle.runId,
      rootRunId: execOptions.rootRunId || handle.runId,
      sequence: events.nextSequence(),
      timestamp: clock.now().toISOString(),
      type: "finish",
      result: result as ExecutionResult<JsonValue>,
    });

    events.emit({
      runId: handle.runId,
      rootRunId: execOptions.rootRunId || handle.runId,
      sequence: events.nextSequence(),
      timestamp: clock.now().toISOString(),
      type: "status",
      status: result.ok ? "success" : "failed",
    });

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
    storage,
    runner,
    registerAction,
    getAction,
    listActions,
    run,
    execute,
  };
}
