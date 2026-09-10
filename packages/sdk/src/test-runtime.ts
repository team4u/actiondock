import { execCli, spawnDetached } from "./cli";
import type {
  ActionContext,
  ActionDefinition,
  ActionInvoker,
  ActionRef,
  Config,
  ExecutionResult,
  Logger,
  ProcessResult,
  RuntimeError,
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
  actions?:
    | Array<{ id: string; action: ActionDefinition } | (ActionDefinition & { id: string })>
    | Record<string, ActionDefinition>
    | Map<string, ActionDefinition>;
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
 * 转义状态键分段中的特殊字符（\ 和 :）。
 */
export function escapeStateSegment(segment: string): string {
  return segment.replace(/\\/g, "\\\\").replace(/:/g, "\\:");
}

/**
 * 反转义状态键分段。
 */
export function unescapeStateSegment(segment: string): string {
  return segment.replace(/\\(:|\\)/g, "$1");
}

/**
 * 将 namespace 与 key 编码为无歧义的复合状态键名。
 */
export function encodeStateKey(namespace: string, key: string): string {
  if (!namespace) {
    return escapeStateSegment(key);
  }
  return `${escapeStateSegment(namespace)}:${escapeStateSegment(key)}`;
}

/**
 * 解析复合状态键名。若复合键存在歧义（多个未转义冒号），抛出错误。
 */
export function decodeStateKey(fullKey: string): { namespace: string; key: string } {
  const unescapedColonIndices: number[] = [];
  for (let i = 0; i < fullKey.length; i++) {
    if (fullKey[i] === ":") {
      let backslashes = 0;
      for (let j = i - 1; j >= 0 && fullKey[j] === "\\"; j--) {
        backslashes++;
      }
      if (backslashes % 2 === 0) {
        unescapedColonIndices.push(i);
      }
    }
  }

  if (unescapedColonIndices.length === 0) {
    return { namespace: "", key: unescapeStateSegment(fullKey) };
  }
  if (unescapedColonIndices.length === 1) {
    const idx = unescapedColonIndices[0];
    return {
      namespace: unescapeStateSegment(fullKey.slice(0, idx)),
      key: unescapeStateSegment(fullKey.slice(idx + 1)),
    };
  }

  throw new Error(`Ambiguous state key '${fullKey}': contains multiple unescaped colon delimiters`);
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
    const now = Date.now();
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

export type TestRuntimeProvider = (options?: TestRuntimeOptions) => any;
let _provider: TestRuntimeProvider | null | undefined;

/**
 * 注册测试运行时提供者（由 @actiondock/testing 在加载时注册为单一事实源）。
 */
export function registerTestRuntimeProvider(provider: TestRuntimeProvider | null | undefined): void {
  _provider = provider;
}

function validateData(schema: unknown, data: unknown, isInput: boolean): void {
  if (schema === false) {
    throw new ActionRuntimeError({
      code: isInput ? "INPUT_VALIDATION_FAILED" : "OUTPUT_VALIDATION_FAILED",
      message: `${isInput ? "Input" : "Output"} schema rejects all values (schema is false)`,
    });
  }
  if (!schema || typeof schema !== "object") return;
  const s = schema as Record<string, unknown>;
  if (s.type === "object") {
    if (data === null || typeof data !== "object" || Array.isArray(data)) {
      throw new ActionRuntimeError({
        code: isInput ? "INPUT_VALIDATION_FAILED" : "OUTPUT_VALIDATION_FAILED",
        message: `${isInput ? "Input" : "Output"} must be an object`,
      });
    }
    const d = data as Record<string, unknown>;
    if (Array.isArray(s.required)) {
      for (const req of s.required) {
        if (!(req in d) || d[req] === undefined) {
          throw new ActionRuntimeError({
            code: isInput ? "INPUT_VALIDATION_FAILED" : "OUTPUT_VALIDATION_FAILED",
            message: `Missing required property: ${req}`,
          });
        }
      }
    }
    if (s.properties && typeof s.properties === "object") {
      for (const [key, propDef] of Object.entries(s.properties as Record<string, any>)) {
        if (key in d && d[key] !== undefined) {
          const val = d[key];
          if (propDef.type === "number" && typeof val !== "number") {
            throw new ActionRuntimeError({
              code: isInput ? "INPUT_VALIDATION_FAILED" : "OUTPUT_VALIDATION_FAILED",
              message: `Property '${key}' must be a number`,
            });
          }
          if (propDef.type === "string" && typeof val !== "string") {
            throw new ActionRuntimeError({
              code: isInput ? "INPUT_VALIDATION_FAILED" : "OUTPUT_VALIDATION_FAILED",
              message: `Property '${key}' must be a string`,
            });
          }
          if (propDef.type === "boolean" && typeof val !== "boolean") {
            throw new ActionRuntimeError({
              code: isInput ? "INPUT_VALIDATION_FAILED" : "OUTPUT_VALIDATION_FAILED",
              message: `Property '${key}' must be a boolean`,
            });
          }
        }
      }
    }
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
  /** 统一执行服务（由高级测试运行时提供） */
  executionService?: any;
  /**
   * 注册 Action 动作定义
   */
  registerAction(action: ActionDefinition & { id?: string }): void;
  registerAction(id: string, action: ActionDefinition): void;
  /**
   * 获取已注册的 Action 动作定义
   */
  getAction(id: string): ActionDefinition | undefined;
  /**
   * 列出已注册的所有 Action 动作定义
   */
  listActions(): ActionDefinition[];
  /**
   * 执行指定的 Action 并返回最终输出结果
   * @param action 目标 Action 定义对象、引用或标识符
   * @param input 输入参数
   */
  run<I = unknown, O = unknown>(
    action: ActionDefinition<I, O> | ActionRef | string,
    input?: I
  ): Promise<O>;
  /**
   * 执行指定的 Action 并返回 ExecutionResult 信封包装
   * @param action 目标 Action 定义对象、引用或标识符
   * @param input 输入参数
   * @param options 可选执行控制参数
   */
  execute<I = unknown, O = unknown>(
    action: ActionDefinition<I, O> | ActionRef | string,
    input?: I,
    options?: any
  ): Promise<ExecutionResult<O>>;
  [key: string]: any;
}

/**
 * @deprecated 建议优先使用 `@actiondock/testing` 中的 `createTestRuntime`，具备完整的 ExecutionService 协调、Schema 校验、FakeClock 与独立持久化语义。
 * 本 SDK 入口为无外部依赖的轻量测试运行时兼容层。
 *
 * @param options 初始化选项（可选初始 config, state, logger, signal）
 * @returns TestRuntime 实例
 */
export function createTestRuntime(options: TestRuntimeOptions = {}): TestRuntime {
  if (_provider) {
    return _provider(options);
  }

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
        action: ActionRef | string,
        input?: I
      ): Promise<O> {
        if (
          typeof action !== "string" &&
          (!action || typeof action !== "object" || typeof (action as any).run === "function" || !("actionId" in action))
        ) {
          throw new ActionRuntimeError({
            code: "INVALID_ACTION_REF",
            message: "ctx.actions.invoke strictly accepts only ActionRef or string, passing ActionDefinition or function is prohibited",
          });
        }
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
          throw new ActionRuntimeError({
            code: "ACTION_NOT_FOUND",
            message: `Action '${fullId}' not found in TestRuntime actions registry`,
          });
        }
        const target = found as ActionDefinition<I, O>;
        const targetCallKey = actionsMap.has(fullId) ? fullId : (found as any).id || pureId;

        if ((target as any).inputSchema) {
          validateData((target as any).inputSchema, input, true);
        }

        if (currentCallStack.includes(targetCallKey)) {
          throw new ActionRuntimeError({
            code: "ACTION_CYCLE_DETECTED",
            message: `Cycle detected in action invocation: ${[...currentCallStack, targetCallKey].join(" -> ")}`,
          });
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
        const output = (await target.run(input as I, ctx)) as O;
        if ((target as any).outputSchema) {
          validateData((target as any).outputSchema, output, false);
        }
        return output;
      },
    };
    return invoker;
  }

  const rootInvoker = createInvoker();

  async function executeDirectAction<I = unknown, O = unknown>(
    action: ActionDefinition<I, O> | ActionRef | string,
    input?: I
  ): Promise<O> {
    if (typeof action === "object" && action && "run" in action && typeof (action as any).run === "function") {
      const runId = "test-" + Math.random().toString(36).slice(2, 10);
      const ctx: ActionContext = {
        config,
        state,
        actions: createInvoker(runId, runId),
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
          rootId: runId,
        },
      };
      if ((action as any).inputSchema) {
        validateData((action as any).inputSchema, input, true);
      }
      const output = (await action.run(input as I, ctx)) as O;
      if ((action as any).outputSchema) {
        validateData((action as any).outputSchema, output, false);
      }
      return output;
    }
    return rootInvoker.invoke(action as ActionRef | string, input);
  }

  return {
    config,
    state,
    logger,
    registerAction(
      idOrAction: string | (ActionDefinition & { id?: string }),
      action?: ActionDefinition
    ): void {
      if (typeof idOrAction === "string" && action) {
        actionsMap.set(idOrAction, action);
      } else if (typeof idOrAction === "object" && idOrAction) {
        const id = (idOrAction as any).id || "anonymous";
        actionsMap.set(id, idOrAction as ActionDefinition);
      }
    },
    getAction(id: string): ActionDefinition | undefined {
      return actionsMap.get(id);
    },
    listActions(): ActionDefinition[] {
      return Array.from(actionsMap.values());
    },
    async run<I = unknown, O = unknown>(
      action: ActionDefinition<I, O> | ActionRef | string,
      input?: I
    ): Promise<O> {
      return executeDirectAction(action, input);
    },
    async execute<I = unknown, O = unknown>(
      action: ActionDefinition<I, O> | ActionRef | string,
      input?: I,
      options?: any
    ): Promise<ExecutionResult<O>> {
      try {
        const data = await executeDirectAction(action, input);
        return {
          ok: true,
          runId: "test-" + Math.random().toString(36).slice(2, 10),
          data,
        };
      } catch (err: any) {
        return {
          ok: false,
          runId: "test-" + Math.random().toString(36).slice(2, 10),
          error: {
            code: err.code || "ACTION_FAILED",
            message: err.message || String(err),
            details: err.details,
          },
        };
      }
    },
  };
}
