import {
  createActionDock,
  type ActionDockService,
  type RunOptions,
  type ProjectConfig,
  type RuntimePlatform,
  SystemClock,
  type Clock,
  type EventSink,
} from "@actiondock/core";
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
import { ActionRuntimeError } from "@actiondock/sdk";
import {
  decodeStateKey,
  encodeStateKey,
  escapeStateSegment,
  unescapeStateSegment,
} from "@actiondock/sdk";
import { FakeClock } from "./clock";
import { MockProcessExecutor } from "./process";
import { MemoryStorage } from "./storage";
import { createTestPlatform } from "./platform";

export { decodeStateKey, encodeStateKey, escapeStateSegment, unescapeStateSegment };
export { ActionRuntimeError };

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

/**
 * 基于内存 Map 的状态存储实现，支持命名空间隔离与 TTL 自动失效，专供单元测试使用。
 *
 * 读取严格限定当前命名空间（根作用域即空命名空间），不做跨命名空间隐式回扫。
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

  async get<T = unknown>(key: string): Promise<T | undefined> {
    const fullKey = this.qualify(key);
    const raw = this.store.get(fullKey);
    if (raw === undefined) {
      return undefined;
    }
    const settled = this.settleEntry(raw);
    if (!settled) {
      this.store.delete(fullKey);
      return undefined;
    }
    const val = settled.value;
    return (typeof val === "object" && val !== null ? structuredClone(val) : val) as T;
  }

  async set<T = unknown>(
    key: string,
    value: T,
    ttlSeconds?: number
  ): Promise<void> {
    const fullKey = this.qualify(key);
    const clonedValue = typeof value === "object" && value !== null ? structuredClone(value) : value;
    if (ttlSeconds !== undefined && ttlSeconds !== null && !isNaN(ttlSeconds)) {
      const expiresAt = this.nowMs() + ttlSeconds * 1000;
      this.store.set(fullKey, {
        __actiondock_entry__: true,
        value: clonedValue,
        expiresAt,
      });
    } else {
      this.store.set(fullKey, {
        __actiondock_entry__: true,
        value: clonedValue,
      });
    }
  }

  async delete(key: string): Promise<boolean> {
    const fullKey = this.qualify(key);
    return this.store.delete(fullKey);
  }

  async clear(): Promise<number> {
    let count = 0;
    for (const fullKey of [...this.store.keys()]) {
      try {
        const decoded = decodeStateKey(fullKey);
        if (decoded.namespace === this.namespace) {
          this.store.delete(fullKey);
          count++;
        }
      } catch {
        // 忽略无法解析的键
      }
    }
    return count;
  }

  async list(): Promise<string[]> {
    const result: string[] = [];
    for (const [fullKey, raw] of this.store.entries()) {
      try {
        const decoded = decodeStateKey(fullKey);
        if (decoded.namespace === this.namespace) {
          const entry = this.settleEntry(raw);
          if (entry) {
            result.push(decoded.key);
          } else {
            this.store.delete(fullKey);
          }
        }
      } catch {
        // 忽略无法解析的键
      }
    }
    return result;
  }

  async keys(prefix = ""): Promise<string[]> {
    const all = await this.list();
    if (!prefix) return all;
    return all.filter((k) => k.startsWith(prefix));
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
  private storage: MemoryStorage;
  private overrides: Record<string, unknown>;
  private projectConfig?: ProjectConfig;

  constructor(
    storage: MemoryStorage,
    projectConfig?: ProjectConfig,
    overrides?: Record<string, unknown>
  ) {
    this.storage = storage;
    this.projectConfig = projectConfig;
    this.overrides = overrides ? { ...overrides } : {};
  }

  get<T = unknown>(key: string): T | undefined;
  get<T = unknown>(key: string, defaultValue: T): T;
  get<T = unknown>(key: string, defaultValue?: T): T | undefined {
    if (key in this.overrides) {
      return this.overrides[key] as T;
    }
    const val = this.storage.getConfig(key);
    if (val !== undefined) {
      return val as T;
    }
    const def = this.projectConfig?.config?.[key]?.default;
    if (def !== undefined) {
      return def as T;
    }
    return defaultValue;
  }

  has(key: string): boolean {
    if (key in this.overrides) return true;
    if (this.storage.getConfig(key) !== undefined) return true;
    if (this.projectConfig?.config?.[key]?.default !== undefined) return true;
    return false;
  }

  set(key: string, value: unknown): void {
    this.storage.setConfig(key, value);
  }

  delete(key: string): boolean {
    const res = this.storage.deleteConfig(key);
    return typeof res === "boolean" ? res : true;
  }

  list(): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    if (this.projectConfig?.config) {
      for (const [k, v] of Object.entries(this.projectConfig.config)) {
        if (v?.default !== undefined) result[k] = v.default;
      }
    }
    const stored = this.storage.listConfig();
    Object.assign(result, stored);
    Object.assign(result, this.overrides);
    return result;
  }
}

/**
 * 测试状态存储实现，对接 MemoryStorage。
 */
class TestStateStore implements StateStore {
  private storage: MemoryStorage;
  private namespace: string;

  constructor(storage: MemoryStorage, namespace = "") {
    this.storage = storage;
    this.namespace = namespace;
  }

  async get<T = unknown>(key: string): Promise<T | undefined> {
    return this.storage.getState<T>(this.namespace, key);
  }

  async set<T = unknown>(
    key: string,
    value: T,
    ttl?: number
  ): Promise<void> {
    return this.storage.setState<T>(this.namespace, key, value, ttl);
  }

  async delete(key: string): Promise<boolean> {
    return this.storage.deleteState(this.namespace, key);
  }

  async clear(prefix = ""): Promise<number> {
    return this.storage.clearState({
      namespace: this.namespace,
      prefix: prefix || undefined,
    });
  }

  async keys(prefix = ""): Promise<string[]> {
    return this.storage.listStateKeys(this.namespace, prefix);
  }

  async list(prefix = ""): Promise<string[]> {
    return this.keys(prefix);
  }

  scope(namespace: string): StateStore {
    const nextNs = this.namespace
      ? `${this.namespace}:${namespace}`
      : namespace;
    return new TestStateStore(this.storage, nextNs);
  }
}

/**
 * 测试事件接收器实现。
 * 记录执行期间产生的所有事件并支持历史检索。
 */
export class TestEventSink implements EventSink {
  private allEvents: ExecutionEvent[] = [];
  private sequenceCounter = 0;

  /** 获取下一个单调自增序号 */
  nextSequence(): number {
    return this.sequenceCounter++;
  }

  emit(event: ExecutionEvent): void {
    this.allEvents.push(event);
  }

  async *subscribe(
    runId: string,
    _options?: { after?: number | string; signal?: AbortSignal; maxQueueSize?: number }
  ): AsyncIterable<ExecutionEvent> {
    for (const e of this.allEvents) {
      if (e.runId === runId) {
        yield e;
      }
    }
  }

  clear(runId: string): void {
    this.allEvents = this.allEvents.filter((e) => e.runId !== runId);
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
  executionService: any;
  /** 核心执行器引擎（向后兼容保留） */
  runner: unknown;
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
    options?: RunOptions
  ): Promise<ExecutionResult<O>>;
}

function createExternalStorageView(storage: MemoryStorage): MemoryStorage {
  return new Proxy(storage, {
    get(target, prop) {
      if (prop === "close") {
        return () => undefined;
      }
      const value = Reflect.get(target, prop, target);
      return typeof value === "function" ? (value as (...args: unknown[]) => unknown).bind(target) : value;
    },
  });
}

/**
 * 创建全功能测试运行时实例。
 * 基于统一 createActionDock 服务门面协调执行全生命周期，并暴露配置、状态、时钟、进程与事件等调试接口。
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
  const rawStorage =
    options.storage ??
    (options.platform?.storage
      ? (options.platform.storage.createStorage(packageId) as MemoryStorage)
      : new MemoryStorage({
          packageId,
          clock,
        }));
  const storage = rawStorage;
  const safeStorage = createExternalStorageView(storage);

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
  const memoryLogger = options.logger ?? new MemoryLogger();

  const actionsMap = new Map<string, ActionDefinition>();
  if (options.actions) {
    if (options.actions instanceof Map) {
      for (const [k, v] of options.actions) {
        actionsMap.set(k, v);
      }
    } else if (Array.isArray(options.actions)) {
      for (const item of options.actions) {
        const id = (item as any).id;
        const act = (item as any).action ?? item;
        if (id) actionsMap.set(id, act);
      }
    } else if (typeof options.actions === "object") {
      for (const [k, v] of Object.entries(options.actions)) {
        actionsMap.set(k, v as ActionDefinition);
      }
    }
  }
  for (const [id, act] of [...actionsMap]) {
    if (!id.includes("/")) {
      actionsMap.set(`${packageId}/${id}`, act);
    }
  }

  const testConfig = new TestConfigStore(
    storage,
    options.projectConfig,
    options.configOverrides
  );

  const testState = new TestStateStore(storage);

  const testPlatform =
    options.platform ??
    createTestPlatform({
      clock,
      process,
      storage: safeStorage,
      eventSink: events,
    });

  const registerAction = (
    idOrAction:
      | string
      | (({ id: string; action?: ActionDefinition } & Partial<ActionDefinition>) | ActionDefinition),
    maybeAction?: ActionDefinition
  ): void => {
    if (typeof idOrAction === "string") {
      if (!maybeAction) {
        throw new Error(
          `registerAction(id, action) 调用缺少 action 定义：id=${idOrAction}`
        );
      }
      actionsMap.set(idOrAction, maybeAction);
      if (!idOrAction.includes("/")) {
        actionsMap.set(`${packageId}/${idOrAction}`, maybeAction);
      }
      return;
    }

    const actObj = idOrAction as { id?: string; action?: ActionDefinition; run?: unknown };
    const id = actObj.id;
    const act = actObj.action ?? (typeof actObj.run === "function" ? (idOrAction as ActionDefinition) : undefined);
    if (id && act) {
      actionsMap.set(id, act);
      if (!id.includes("/")) {
        actionsMap.set(`${packageId}/${id}`, act);
      }
    }
  };

  const getAction = (id: string): ActionDefinition | undefined => {
    return actionsMap.get(id) || actionsMap.get(`${packageId}/${id}`);
  };

  const listActions = (): ActionDefinition[] => {
    const seen = new Set<ActionDefinition>();
    const list: ActionDefinition[] = [];
    for (const act of actionsMap.values()) {
      if (!seen.has(act)) {
        seen.add(act);
        list.push(act);
      }
    }
    return list;
  };

  let anonCounter = 0;
  const anonymousActions = new WeakMap<object, string>();

  const execute = async <I = unknown, O = unknown>(
    action: ActionDefinition<I, O> | string,
    input: I = {} as I,
    execOptions: RunOptions = {}
  ): Promise<ExecutionResult<O>> => {
    let actionRef: string;
    if (typeof action === "string") {
      actionRef = action;
    } else {
      let id = (action as any).id;
      if (!id) {
        id = anonymousActions.get(action);
      }
      if (!id) {
        for (const [k, v] of actionsMap) {
          if (v === action) {
            id = k;
            break;
          }
        }
      }
      if (!id) {
        id = `anon_test_action_${++anonCounter}`;
        anonymousActions.set(action, id);
      }
      registerAction(id, action as ActionDefinition);
      actionRef = id;
    }

    const targetRef = actionRef.includes("/") ? actionRef : `${packageId}/${actionRef}`;

    const packageActionsMap = new Map<string, Record<string, ActionDefinition>>();
    packageActionsMap.set(packageId, {});

    for (const [k, v] of actionsMap) {
      if (k.includes("/")) {
        const slashIdx = k.indexOf("/");
        const pkg = k.slice(0, slashIdx);
        const actId = k.slice(slashIdx + 1);
        if (pkg === packageId) {
          packageActionsMap.get(packageId)![actId] = v;
        } else {
          if (!packageActionsMap.has(pkg)) {
            packageActionsMap.set(pkg, {});
          }
          packageActionsMap.get(pkg)![actId] = v;
        }
      } else {
        packageActionsMap.get(packageId)![k] = v;
      }
    }

    const depPackages = Array.from(packageActionsMap.keys()).filter((p) => p !== packageId);
    const rootDeps: Record<string, string> = {};
    for (const dep of depPackages) {
      rootDeps[dep] = "*";
    }

    const packageActionSpecs: Record<string, { entry: string; uses?: string[] }> = {
      ...(options.projectConfig?.actions as any),
    };
    for (const [actId, actDef] of Object.entries(packageActionsMap.get(packageId) || {})) {
      const existing = packageActionSpecs[actId] || { entry: actId };
      const explicitUses = (actDef as any)?.uses || (actDef as any)?.contract?.uses || [];
      const uses = existing.uses ? [...existing.uses] : [...explicitUses];
      for (const dep of depPackages) {
        if (!uses.includes(`${dep}/*`)) {
          uses.push(`${dep}/*`);
        }
      }
      packageActionSpecs[actId] = {
        ...existing,
        uses,
      };
    }

    const packagesList: any[] = [
      {
        projectConfig: {
          id: packageId,
          name: options.projectConfig?.name || packageId,
          version: options.projectConfig?.version || "1.0.0",
          description: options.projectConfig?.description || "",
          actions: packageActionSpecs,
          config: options.projectConfig?.config,
          dependencies: {
            ...options.projectConfig?.dependencies,
            ...rootDeps,
          },
        },
        actions: packageActionsMap.get(packageId) || {},
        storage: safeStorage,
        inMemory: true,
        configOverrides: options.configOverrides,
        logger: memoryLogger,
      },
    ];

    for (const depPkg of depPackages) {
      packagesList.push({
        projectConfig: {
          id: depPkg,
          name: depPkg,
          version: "1.0.0",
        },
        actions: packageActionsMap.get(depPkg) || {},
        storage: safeStorage,
        inMemory: true,
        logger: memoryLogger,
      });
    }

    const service = await createActionDock({
      packages: packagesList,
      platform: testPlatform,
      inMemory: true,
      autoLoadCurrentProject: false,
      scanLinkedPackages: false,
    });

    try {
      const ticket = await service.execution.start(targetRef, input as JsonValue, execOptions);
      if (!ticket.result) {
        throw new Error(`Execution ticket for run '${ticket.runId}' has no result Promise`);
      }
      const res = (await ticket.result) as ExecutionResult<O>;
      return res;
    } finally {
      await service.close();
    }
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

  const executionServiceStub = {
    get runner() {
      return {};
    },
    registerAction,
    getAction,
    listActions,
  };

  return {
    config: testConfig,
    state: testState,
    clock,
    process,
    events,
    logger: memoryLogger,
    storage,
    executionService: executionServiceStub as any,
    runner: {},
    registerAction,
    getAction,
    listActions,
    run,
    execute,
  };
}
