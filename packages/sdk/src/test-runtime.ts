import { execCli, spawnDetached } from "./cli";
import type {
  ActionContext,
  ActionDefinition,
  ActionInvoker,
  ActionRef,
  Config,
  Logger,
  ProcessResult,
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
  /** 预注册的 Action 集合（供跨 Action 调用或按 ID 标识符解析） */
  actions?: ActionDefinition[] | Record<string, ActionDefinition> | Map<string, ActionDefinition>;
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
          if (!prefix.includes(":") && k.includes(":")) {
            continue;
          }
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
   * @param action 目标 Action 定义对象、引用或标识符
   * @param input 输入参数
   */
  run<I = unknown, O = unknown>(
    action: ActionDefinition<I, O> | ActionRef | string,
    input?: I
  ): Promise<O>;
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

  const actionsMap = new Map<string, ActionDefinition>();
  if (options.actions) {
    if (Array.isArray(options.actions)) {
      for (const act of options.actions) {
        actionsMap.set(act.id, act);
      }
    } else if (options.actions instanceof Map) {
      for (const [k, v] of options.actions) {
        actionsMap.set(k, v);
      }
    } else if (typeof options.actions === "object") {
      for (const [k, v] of Object.entries(options.actions)) {
        actionsMap.set(k, v);
      }
    }
  }

  function createInvoker(
    parentRunId?: string,
    rootRunId?: string,
    currentCallStack: readonly string[] = []
  ): ActionInvoker {
    const invoker: ActionInvoker = {
      async invoke<I = unknown, O = unknown>(
        action: ActionDefinition<I, O> | ActionRef | string,
        input?: I
      ): Promise<O> {
        let target: ActionDefinition<I, O>;
        let targetCallKey: string;
        if (
          typeof action === "object" &&
          "run" in action &&
          typeof (action as any).run === "function"
        ) {
          target = action as ActionDefinition<I, O>;
          targetCallKey = target.id;
        } else {
          let fullId: string;
          let pureId: string;
          if (typeof action === "string") {
            fullId = action;
            pureId = action.includes("/") ? action.slice(action.lastIndexOf("/") + 1) : action;
          } else {
            const ref = action as ActionRef;
            pureId = ref.actionId;
            fullId = ref.packageId ? `${ref.packageId}/${ref.actionId}` : ref.actionId;
          }
          const found = actionsMap.get(fullId) || actionsMap.get(pureId);
          if (!found) {
            throw new Error(`Action '${fullId}' not found in TestRuntime actions registry`);
          }
          target = found as ActionDefinition<I, O>;
          targetCallKey = actionsMap.has(fullId) ? fullId : target.id;
        }

        if (currentCallStack.includes(targetCallKey)) {
          throw new Error(
            `Cycle detected in action invocation: ${[...currentCallStack, targetCallKey].join(" -> ")}`
          );
        }

        const nextCallStack = [...currentCallStack, targetCallKey];
        const runId = "test-" + Math.random().toString(36).slice(2, 10);
        const currentRootId = rootRunId || runId;
        const ctx: ActionContext = {
          config,
          state,
          actions: createInvoker(runId, currentRootId, nextCallStack),
          process: {
            async exec(command, args, options) {
              const res = await execCli(command, args, {
                cwd: options?.cwd,
                env: options?.env,
                input: options?.input,
                timeout: options?.timeoutMs,
                throwOnError: options?.throwOnError,
                signal: options?.signal,
              });
              return {
                ok: res.ok,
                exitCode: res.exitCode,
                stdout: res.stdout,
                stderr: res.stderr,
                raw: res.raw,
                timedOut: res.timedOut ?? false,
                cancelled: Boolean(options?.signal?.aborted),
                durationMs: res.durationMs,
              };
            },
            async spawnDetached(options) {
              const probeFn = options.probe
                ? async () => {
                    const fakeRes: ProcessResult = {
                      ok: true,
                      exitCode: 0,
                      stdout: "",
                      stderr: "",
                      raw: new Uint8Array(),
                      timedOut: false,
                      cancelled: false,
                      durationMs: 0,
                    };
                    return options.probe!(fakeRes);
                  }
                : () => true;

              const ready = await spawnDetached({
                command: options.command,
                args: options.args,
                cwd: options.cwd,
                env: options.env,
                timeoutMs: options.timeoutMs ?? options.probeTimeoutMs,
                intervalMs: options.probeIntervalMs,
                signal: options.signal,
                probe: probeFn,
              });

              return {
                ok: ready,
                ready,
                durationMs: 0,
              };
            },
          },
          log: logger,
          progress: {
            report() {},
          },
          signal,
          run: {
            id: runId,
            rootId: currentRootId,
            parentId: parentRunId,
          },
        };
        return (await target.run(input as I, ctx)) as O;
      },
    };
    return invoker;
  }

  const rootInvoker = createInvoker();

  return {
    config,
    state,
    logger,
    async run<I = unknown, O = unknown>(
      action: ActionDefinition<I, O> | ActionRef | string,
      input?: I
    ): Promise<O> {
      return rootInvoker.invoke(action, input);
    },
  };
}
