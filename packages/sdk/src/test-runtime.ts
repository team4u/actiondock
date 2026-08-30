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

export class MemoryStateStore implements StateStore {
  private store: Map<string, unknown>;
  private namespace: string;

  constructor(
    store?: Map<string, unknown>,
    namespace = ""
  ) {
    this.store = store || new Map();
    this.namespace = namespace;
  }

  private qualify(key: string): string {
    return this.namespace ? `${this.namespace}:${key}` : key;
  }

  async get<T = unknown>(key: string): Promise<T | undefined> {
    const raw = this.store.get(this.qualify(key));
    if (raw === undefined) return undefined;
    return structuredClone(raw) as T;
  }

  async set<T = unknown>(key: string, value: T): Promise<void> {
    this.store.set(this.qualify(key), structuredClone(value));
  }

  async delete(key: string): Promise<void> {
    this.store.delete(this.qualify(key));
  }

  async keys(prefix = ""): Promise<string[]> {
    const fullPrefix = this.qualify(prefix);
    const result: string[] = [];
    for (const k of this.store.keys()) {
      if (k.startsWith(fullPrefix)) {
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
