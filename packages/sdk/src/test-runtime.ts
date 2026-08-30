import type {
  ActionContext,
  ActionDefinition,
  ActionInvoker,
  Config,
  Logger,
  StateStore,
} from "./types";

/**
 * 创建内存测试运行时所需的初始化选项。
 */
export interface TestRuntimeOptions {
  /** 初始注入的配置键值对映射 */
  config?: Record<string, unknown>;
  /** 初始注入的状态键值对映射 */
  state?: Record<string, unknown>;
  /** 自定义日志记录器（可选，默认创建 MemoryLogger） */
  logger?: Logger;
  /** 自定义取消信号（可选，默认使用未中断的 AbortSignal） */
  signal?: AbortSignal;
}

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
 */
export class MemoryStateStore implements StateStore {
  private store: Map<string, any>;
  private namespace: string;

  constructor(
    store?: Map<string, any>,
    namespace = ""
  ) {
    this.store = store || new Map();
    this.namespace = namespace;
  }

  private qualify(key: string): string {
    return this.namespace ? `${this.namespace}:${key}` : key;
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

  async get<T = unknown>(key: string): Promise<T | undefined> {
    const qKey = this.qualify(key);
    const raw = this.store.get(qKey);
    if (raw === undefined) return undefined;
    const entry = this.extractEntry(raw);
    if (entry.expiresAt !== undefined && entry.expiresAt <= Date.now()) {
      this.store.delete(qKey);
      return undefined;
    }
    return (entry.value !== undefined ? structuredClone(entry.value) : undefined) as T;
  }

  async set<T = unknown>(
    key: string,
    value: T,
    ttl?: number
  ): Promise<void> {
    const qKey = this.qualify(key);
    const expiresAt =
      typeof ttl === "number" && ttl > 0 ? Date.now() + ttl * 1000 : undefined;

    const entry: MemoryStateEntry = {
      value: structuredClone(value),
      expiresAt,
    };
    (entry as any).__actiondock_entry__ = true;
    this.store.set(qKey, entry);
  }

  async delete(key: string): Promise<void> {
    this.store.delete(this.qualify(key));
  }

  async keys(prefix = ""): Promise<string[]> {
    const fullPrefix = this.qualify(prefix);
    const now = Date.now();
    const result: string[] = [];
    for (const [k, raw] of this.store.entries()) {
      if (k.startsWith(fullPrefix)) {
        const entry = this.extractEntry(raw);
        if (entry.expiresAt !== undefined && entry.expiresAt <= now) {
          this.store.delete(k);
          continue;
        }
        if (this.namespace) {
          result.push(k.slice(this.namespace.length + 1));
        } else {
          result.push(k);
        }
      }
    }
    return result;
  }

  scope(namespace: string): StateStore {
    const nextNs = this.namespace
      ? `${this.namespace}:${namespace}`
      : namespace;
    return new MemoryStateStore(this.store, nextNs);
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
 * 测试运行时接口，提供对内存配置、状态和日志的直接访问及便捷的 Action 执行方法。
 */
export interface TestRuntime {
  /** 内存配置实例 */
  config: MemoryConfig;
  /** 内存状态存储实例 */
  state: MemoryStateStore;
  /** 内存日志记录器 */
  logger: MemoryLogger;
  /**
   * 执行指定的 Action 并返回最终输出结果
   * @param action 目标 Action
   * @param input 输入参数
   */
  run<I, O>(action: ActionDefinition<I, O>, input: I): Promise<O>;
}

/**
 * 创建用于单元测试的轻量级内存测试运行时（TestRuntime）。
 * 
 * 特点：
 * 1. 零外部依赖：无需依赖 SQLite 或本地文件系统，即开即用。
 * 2. 真实语义：完整支持状态持久化、TTL 过期、命名空间隔离、Action 相互调用与环路死锁检测。
 * 
 * @param options 初始化选项（可选初始 config, state, logger, signal）
 * @returns TestRuntime 实例
 * 
 * @example
 * ```ts
 * const runtime = createTestRuntime({
 *   config: { API_KEY: "test_key" }
 * });
 * const result = await runtime.run(myAction, { foo: "bar" });
 * expect(result.success).toBe(true);
 * expect(await runtime.state.get("some_key")).toBe(1);
 * ```
 */
export function createTestRuntime(options: TestRuntimeOptions = {}): TestRuntime {
  const config = new MemoryConfig(options.config || {});
  const memoryMap = new Map<string, unknown>(
    Object.entries(options.state || {})
  );
  const state = new MemoryStateStore(memoryMap);
  const logger = (options.logger as MemoryLogger) || new MemoryLogger();
  const signal = options.signal ?? new AbortController().signal;

  const callStack: string[] = [];

  const invoker: ActionInvoker = {
    async invoke<I, O>(action: ActionDefinition<I, O>, input: I): Promise<O> {
      if (callStack.includes(action.id)) {
        throw new Error(
          `Cycle detected in action invocation: ${callStack.join(" -> ")} -> ${action.id}`
        );
      }
      callStack.push(action.id);
      try {
        const ctx: ActionContext = {
          config,
          state,
          actions: invoker,
          log: logger,
          signal,
        };
        return await action.run(input, ctx);
      } finally {
        callStack.pop();
      }
    },
  };

  return {
    config,
    state,
    logger,
    async run<I, O>(action: ActionDefinition<I, O>, input: I): Promise<O> {
      return invoker.invoke(action, input);
    },
  };
}
