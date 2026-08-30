import type {
  ActionContext,
  ActionDefinition,
  ActionInvoker,
  Config,
  Logger,
  StateStore,
} from "./types";

export interface TestRuntimeOptions {
  config?: Record<string, unknown>;
  state?: Record<string, unknown>;
  logger?: Logger;
  signal?: AbortSignal;
}

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

  set(key: string, value: unknown): void {
    this.store.set(key, value);
  }
}

export interface MemoryStateEntry {
  value: unknown;
  expiresAt?: number;
}

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

export interface TestRuntime {
  config: MemoryConfig;
  state: MemoryStateStore;
  logger: MemoryLogger;
  run<I, O>(action: ActionDefinition<I, O>, input: I): Promise<O>;
}

/**
 * Creates an in-memory TestRuntime for unit testing Actions without dependencies.
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
