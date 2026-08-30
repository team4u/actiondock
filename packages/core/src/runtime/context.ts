import type {
  ActionContext,
  ActionDefinition,
  ActionInvoker,
  Config,
  Logger,
  StateStore,
} from "@actiondock/sdk";
import type { ProjectConfig } from "../project/types";
import type { RuntimeStorage } from "../storage/types";

export class RuntimeConfig implements Config {
  private overrides: Map<string, unknown>;
  private storage: RuntimeStorage;
  private projectConfig?: ProjectConfig;

  constructor(
    storage: RuntimeStorage,
    overrides: Record<string, unknown> = {},
    projectConfig?: ProjectConfig
  ) {
    this.storage = storage;
    this.overrides = new Map(Object.entries(overrides));
    this.projectConfig = projectConfig;
  }

  get<T = unknown>(key: string): T | undefined;
  get<T = unknown>(key: string, defaultValue: T): T;
  get<T = unknown>(key: string, defaultValue?: T): T | undefined {
    // 1. CLI / Temporary Override
    if (this.overrides.has(key)) {
      return this.overrides.get(key) as T;
    }

    // 2. Storage (SQLite)
    const stored = this.storage.getConfig<T>(key);
    if (stored !== undefined) {
      return stored;
    }

    // 3. Project Default (actiondock.json)
    if (this.projectConfig?.config?.[key]?.default !== undefined) {
      return this.projectConfig.config[key].default as T;
    }

    return defaultValue;
  }

  has(key: string): boolean {
    if (this.overrides.has(key)) return true;
    if (this.storage.getConfig(key) !== undefined) return true;
    if (this.projectConfig?.config?.[key]?.default !== undefined) return true;
    return false;
  }
}

export class RuntimeStateStore implements StateStore {
  private storage: RuntimeStorage;
  private namespace: string;

  constructor(storage: RuntimeStorage, namespace = "") {
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

  async delete(key: string): Promise<void> {
    return this.storage.deleteState(this.namespace, key);
  }

  async keys(prefix = ""): Promise<string[]> {
    return this.storage.listStateKeys(this.namespace, prefix);
  }

  scope(namespace: string): StateStore {
    const nextNs = this.namespace
      ? `${this.namespace}:${namespace}`
      : namespace;
    return new RuntimeStateStore(this.storage, nextNs);
  }
}

export class StderrLogger implements Logger {
  private prefix: string;

  constructor(prefix = "") {
    this.prefix = prefix ? `[${prefix}] ` : "";
  }

  private format(level: string, message: string, data?: unknown): string {
    const time = new Date().toISOString().slice(11, 19);
    const base = `[${time}] [${level.toUpperCase()}] ${this.prefix}${message}`;
    if (data !== undefined) {
      return `${base} ${typeof data === "object" ? JSON.stringify(data) : data}`;
    }
    return base;
  }

  debug(message: string, data?: unknown): void {
    process.stderr.write(this.format("debug", message, data) + "\n");
  }

  info(message: string, data?: unknown): void {
    process.stderr.write(this.format("info", message, data) + "\n");
  }

  warn(message: string, data?: unknown): void {
    process.stderr.write(this.format("warn", message, data) + "\n");
  }

  error(message: string, data?: unknown): void {
    process.stderr.write(this.format("error", message, data) + "\n");
  }
}

export interface ContextOptions {
  storage: RuntimeStorage;
  overrides?: Record<string, unknown>;
  projectConfig?: ProjectConfig;
  parentRunId?: string;
  callStack?: string[];
  onActionInvoke?: (
    action: ActionDefinition,
    input: unknown,
    parentRunId?: string
  ) => Promise<unknown>;
}

export function createActionContext(options: ContextOptions): ActionContext {
  const config = new RuntimeConfig(
    options.storage,
    options.overrides,
    options.projectConfig
  );
  const state = new RuntimeStateStore(options.storage);
  const log = new StderrLogger();

  const invoker: ActionInvoker = {
    async invoke<I, O>(action: ActionDefinition<I, O>, input: I): Promise<O> {
      if (options.onActionInvoke) {
        return (await options.onActionInvoke(
          action as any,
          input,
          options.parentRunId
        )) as O;
      }
      throw new Error("ActionInvoker not configured with an invocation delegate");
    },
  };

  return {
    config,
    state,
    actions: invoker,
    log,
  };
}
