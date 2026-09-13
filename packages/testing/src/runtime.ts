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
  SystemClock,
  normalizeActionCollection,
} from "@actiondock/core";
import type { Clock } from "@actiondock/core";
import type {
  ActionDefinition,
  Config,
  ExecutionEvent,
  ExecutionResult,
  JsonValue,
  Logger,
  RuntimeError,
  StateStore,
} from "@actiondock/sdk";
import { FakeClock } from "./clock";
import { MockProcessExecutor } from "./process";
import { MemoryStorage } from "./storage";

/**
 * 基于内存 Map 的只读/可写配置实现，专供单元测试使用。
 */
export class MemoryConfig implements Config {
  private store: Map<string, unknown>;

  constructor(initial: Record<string, unknown> = {}) {
    this.store = new Map(Object.entries(initial));
  }

  get<T = unknown>(key: string): T | undefined;
  get<T = unknown>(key: string, defaultValue: T): T;
  get<T = unknown>(key: string, defaultValue?: T): T | undefined {
    if (this.store.has(key)) {
      return this.store.get(key) as T;
    }
    return defaultValue;
  }

  has(key: string): boolean {
    return this.store.has(key);
  }

  /**
   * 在测试期间动态更新或插入配置值。
   * @param key 配置键名
   * @param value 配置值
   */
  set(key: string, value: unknown): void {
    this.store.set(key, value);
  }

  /**
   * 删除指定配置项。
   * @param key 配置键名
   */
  delete(key: string): boolean {
    return this.store.delete(key);
  }

  /**
   * 列出所有已存储配置项。
   */
  list(): Record<string, unknown> {
    return Object.fromEntries(this.store.entries());
  }
}

/**
 * 内存状态条目结构体，包含数据值与可选的过期时间戳。
 */
export interface MemoryStateEntry {
  value: unknown;
  expiresAt?: number;
}

// 状态键编解码能力单一事实源位于 @actiondock/sdk，此处 re-export 维持既有导入路径兼容并供本模块内部复用
import {
  decodeStateKey,
  encodeStateKey,
  escapeStateSegment,
  unescapeStateSegment,
} from "@actiondock/sdk";
export { decodeStateKey, encodeStateKey, escapeStateSegment, unescapeStateSegment };

/**
 * 基于内存 Map 的状态存储实现，支持命名空间隔离与 TTL 自动失效，专供单元测试使用。
 *
 * 根命名空间读取未命中时，会按 core 生产 RuntimeStateStore 的回扫语义，
 * 以裸 key 反查全部命名空间中的同 key 条目（多条命中时抛歧义异常，与 core 的
 * findState 契约一致），确保测试与生产行为不分叉。
 */
export class MemoryStateStore implements StateStore {
  private store: Map<string, any>;
  private namespace: string;
  private clock: Clock;

  constructor(
    store?: Map<string, any>,
    namespace = "",
    clock?: Clock
  ) {
    this.store = store || new Map();
    this.namespace = namespace;
    this.clock = clock ?? new SystemClock();
  }

  /** 获取注入时钟的当前时间戳（毫秒），TTL 过期判定单一事实入口 */
  private nowMs(): number {
    return this.clock.now().getTime();
  }

  private qualify(key: string): string {
    return encodeStateKey(this.namespace, key);
  }

  private extractEntry(raw: unknown): MemoryStateEntry {
    if (
      raw !== null &&
      typeof raw === "object" &&
      ("__actiondock_entry__" in (raw as Record<string, unknown>) ||
        "expiresAt" in (raw as Record<string, unknown>))
    ) {
      return raw as MemoryStateEntry;
    }
    return { value: raw };
  }

  /** 提取并结算条目：命中且未过期返回条目本身，已过期删除并返回 undefined */
  private settleEntry(raw: unknown): MemoryStateEntry | undefined {
    const entry = this.extractEntry(raw);
    if (entry.expiresAt !== undefined && entry.expiresAt <= this.nowMs()) {
      return undefined;
    }
    return entry;
  }

  /**
   * 以裸 key 回扫全部命名空间，对齐 core 生产存储的 findState 契约：
   * 多条命中抛歧义异常，零命中返回 undefined，唯一命中返回该条目。
   */
  private findAcrossNamespaces<T>(key: string): T | undefined {
    const now = this.nowMs();
    const hits: Array<{ storeKey: string; entry: MemoryStateEntry }> = [];

    for (const [storeKey, raw] of this.store.entries()) {
      let decoded: { namespace: string; key: string };
      try {
        decoded = decodeStateKey(storeKey);
      } catch {
        // 无法解码的复合键直接跳过，不影响其他条目回扫
        continue;
      }
      if (decoded.key !== key) {
        continue;
      }
      const entry = this.extractEntry(raw);
      if (entry.expiresAt !== undefined && entry.expiresAt <= now) {
        this.store.delete(storeKey);
        continue;
      }
      hits.push({ storeKey, entry });
    }

    if (hits.length > 1) {
      throw new Error(
        `Ambiguous state key '${key}': matches ${hits.length} entries (${hits
          .map((h) => decodeStateKey(h.storeKey).namespace + ":" + key)
          .join(", ")})`
      );
    }
    if (hits.length === 0) {
      return undefined;
    }
    const value = hits[0].entry.value;
    return (value !== undefined ? structuredClone(value) : undefined) as T;
  }

  async get<T = unknown>(key: string): Promise<T | undefined> {
    const qKey = this.qualify(key);
    const raw = this.store.get(qKey);
    if (raw !== undefined) {
      const entry = this.settleEntry(raw);
      if (entry === undefined) {
        this.store.delete(qKey);
        return undefined;
      }
      return (entry.value !== undefined ? structuredClone(entry.value) : undefined) as T;
    }

    // 根命名空间精确未命中时回扫全部命名空间，与 core RuntimeStateStore 语义对齐
    if (!this.namespace) {
      return this.findAcrossNamespaces<T>(key);
    }
    return undefined;
  }

  async set<T = unknown>(
    key: string,
    value: T,
    ttl?: number
  ): Promise<void> {
    const qKey = this.qualify(key);
    const expiresAt =
      typeof ttl === "number" && ttl > 0 ? this.nowMs() + ttl * 1000 : undefined;

    const entry: MemoryStateEntry = {
      value: structuredClone(value),
      expiresAt,
    };
    (entry as any).__actiondock_entry__ = true;
    this.store.set(qKey, entry);
  }

  async delete(key: string): Promise<boolean> {
    const qKey = this.qualify(key);
    return this.store.delete(qKey);
  }

  async clear(prefix = ""): Promise<number> {
    const keysToDelete = await this.keys(prefix);
    let count = 0;
    for (const k of keysToDelete) {
      if (this.store.delete(this.qualify(k))) {
        count++;
      }
    }
    return count;
  }

  async keys(prefix = ""): Promise<string[]> {
    const now = this.nowMs();
    const result: string[] = [];
    for (const [k, raw] of this.store.entries()) {
      let decoded: { namespace: string; key: string };
      try {
        decoded = decodeStateKey(k);
      } catch {
        continue;
      }
      if (decoded.namespace === this.namespace) {
        if (prefix && !decoded.key.startsWith(prefix)) {
          continue;
        }
        const entry = this.extractEntry(raw);
        if (entry.expiresAt !== undefined && entry.expiresAt <= now) {
          this.store.delete(k);
          continue;
        }
        result.push(decoded.key);
      }
    }
    return result;
  }

  scope(namespace: string): StateStore {
    const nextNs = this.namespace
      ? `${this.namespace}:${namespace}`
      : namespace;
    return new MemoryStateStore(this.store, nextNs, this.clock);
  }
}

/**
 * 内存日志记录器实现，将所有日志记录在数组中以便在测试断言中检索。
 */
export class MemoryLogger implements Logger {
  public logs: Array<{ level: string; message: string; data?: unknown }> = [];

  debug(message: string, data?: unknown): void {
    this.logs.push({ level: "debug", message, data });
  }

  info(message: string, data?: unknown): void {
    this.logs.push({ level: "info", message, data });
  }

  warn(message: string, data?: unknown): void {
    this.logs.push({ level: "warn", message, data });
  }

  error(message: string, data?: unknown): void {
    this.logs.push({ level: "error", message, data });
  }
}

// 规范化运行时错误类单一事实源位于 @actiondock/sdk，此处 re-export 维持既有导入路径兼容并供本模块内部复用
import { ActionRuntimeError } from "@actiondock/sdk";
export { ActionRuntimeError };

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
    const res = this.storage.deleteConfig(key);
    return typeof res === "boolean" ? res : true;
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
  /**
   * 可选注入的日志记录器，仅接受 MemoryLogger 实例（默认新建）。
   * 测试运行时需捕获日志供断言检索，不支持自定义 Logger 实现；
   * 如需自定义日志行为，请直接使用 DefaultExecutionService 组装。
   */
  logger?: MemoryLogger;
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

/** 测试运行时内部持有的匿名 Action 下一次可用序号 */
function nextAnonymousTestActionId(): string {
  anonymousTestActionCounter++;
  return `test-action-${anonymousTestActionCounter}`;
}

/**
 * 将任意形态的 actions 输入归一化为统一映射表。
 *
 * 直接复用 core 的 normalizeActionCollection 作为归一化单一事实源，
 * 避免在 testing 包内重新实现三形态分支造成逻辑拷贝；
 * 此处无需 actionSpecs 产物，仅取 actionsMap，并额外为不含包前缀的标识补充限定别名。
 *
 * @param rawActions 三形态之一的 Action 集合输入
 * @param packageId 当前 Package 标识，用于补充限定别名
 */
function normalizeTestActions(
  rawActions: TestRuntimeOptions["actions"],
  packageId: string
): Map<string, ActionDefinition> {
  const { actionsMap } = normalizeActionCollection(rawActions as Parameters<typeof normalizeActionCollection>[0]);
  for (const [id, act] of [...actionsMap]) {
    if (!id.includes("/")) {
      actionsMap.set(`${packageId}/${id}`, act);
    }
  }
  return actionsMap;
}

/**
 * 测试运行时 Action 注册表。
 * 统一持有本地 actionsMap 与 executionService 双份注册状态，收敛注册、检索与列举入口。
 */
class TestActionRegistry {
  readonly actionsMap: Map<string, ActionDefinition>;
  readonly executionService: ExecutionService;
  private readonly packageId: string;

  constructor(
    actionsMap: Map<string, ActionDefinition>,
    executionService: ExecutionService,
    packageId: string
  ) {
    this.actionsMap = actionsMap;
    this.executionService = executionService;
    this.packageId = packageId;
  }

  /** 双签名注册：字符串标识与定义，或携带 id 的定义对象 */
  register(
    idOrAction:
      | string
      | (({ id: string; action?: ActionDefinition } & Partial<ActionDefinition>) | ActionDefinition),
    maybeAction?: ActionDefinition
  ): void {
    if (typeof idOrAction === "string") {
      if (!maybeAction) {
        throw new Error(
          `registerAction(id, action) 调用缺少 action 定义：id=${idOrAction}`
        );
      }
      this.executionService.registerAction(idOrAction, maybeAction);
      this.actionsMap.set(idOrAction, maybeAction);
      if (!idOrAction.includes("/")) {
        this.actionsMap.set(`${this.packageId}/${idOrAction}`, maybeAction);
      }
      return;
    }

    const actObj = idOrAction as { id?: string; action?: ActionDefinition; run?: unknown };
    const id = actObj.id;
    const act = actObj.action ?? (typeof actObj.run === "function" ? (idOrAction as ActionDefinition) : undefined);
    if (id && act) {
      this.actionsMap.set(id, act);
      if (!id.includes("/")) {
        this.actionsMap.set(`${this.packageId}/${id}`, act);
      }
    }
    this.executionService.registerAction(idOrAction as Parameters<ExecutionService["registerAction"]>[0] as never);
  }

  /** 按标识检索已注册定义 */
  get(id: string): ActionDefinition | undefined {
    return this.executionService.getAction(id);
  }

  /** 列出已注册的全部定义 */
  list(): ActionDefinition[] {
    return this.executionService.listActions();
  }
}

/**
 * 解析 execute 入参的 Action 引用。
 *
 * 字符串直接作为引用；对象则依次尝试自身 id、注册表反查、匿名 WeakMap 映射，
 * 并在首次出现时完成注册。全程不修改调用方传入的对象。
 *
 * @param action Action 定义或已注册标识
 * @param registry 测试运行时 Action 注册表
 * @returns 可用于 executionService 启动执行的引用标识
 */
function resolveActionRef(
  action: ActionDefinition<any, any> | string,
  registry: TestActionRegistry
): string {
  if (typeof action === "string") {
    return action;
  }

  const candidateId = (action as { id?: string }).id;
  if (candidateId) {
    registry.executionService.registerAction(candidateId, action);
    registry.actionsMap.set(candidateId, action);
    return candidateId;
  }

  // 反查注册表：同一对象已注册时复用既有标识
  for (const [registeredId, registeredAct] of registry.actionsMap) {
    if (registeredAct === action) {
      return registeredId;
    }
  }

  // 匿名对象首次出现：仅记录 WeakMap 映射，不写入调用方对象
  let anonId = anonymousTestActions.get(action);
  if (!anonId) {
    anonId = nextAnonymousTestActionId();
    anonymousTestActions.set(action, anonId);
  }
  registry.executionService.registerAction(anonId, action);
  registry.actionsMap.set(anonId, action);
  return anonId;
}

/**
 * 创建全功能测试运行时实例。
 * 基于统一 ExecutionService 协调执行全生命周期，并暴露配置、状态、时钟、进程与事件等调试接口。
 *
 * @param options 测试运行时选项
 */
export function createTestRuntime(options: TestRuntimeOptions = {}): TestRuntime {
  const packageId = options.packageId || "my-pkg";
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
  // 类型已收窄为 MemoryLogger，直接使用注入实例或默认新建，不再做静默替换
  const memoryLogger = options.logger ?? new MemoryLogger();

  const actionsMap = normalizeTestActions(options.actions, packageId);

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

  const registry = new TestActionRegistry(actionsMap, executionService, packageId);

  const testConfig = new TestConfigStore(
    storage,
    options.projectConfig,
    options.configOverrides
  );

  const testState = new RuntimeStateStore(storage);

  const registerAction = (
    idOrAction:
      | string
      | (({ id: string; action?: ActionDefinition } & Partial<ActionDefinition>) | ActionDefinition),
    maybeAction?: ActionDefinition
  ): void => {
    registry.register(idOrAction, maybeAction);
  };

  const execute = async <I = unknown, O = unknown>(
    action: ActionDefinition<I, O> | string,
    input: I = {} as I,
    execOptions: ExecutionStartOptions = {}
  ): Promise<ExecutionResult<O>> => {
    const actionRef = resolveActionRef(action, registry);

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
    runner: executionService.runner,
    registerAction,
    getAction: (id) => registry.get(id),
    listActions: () => registry.list(),
    run,
    execute,
  };
}
