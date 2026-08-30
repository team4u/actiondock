import type {
  ActionContext,
  ActionDefinition,
  ActionInvoker,
  Config,
  Logger,
  StateStore,
} from "@actiondock/sdk";
import type { ProjectConfig } from "../project/types";
import { createGlobalStorage } from "../storage";
import type { RuntimeStorage } from "../storage/types";
import { resolveEnvValue } from "./env";

export class RuntimeConfig implements Config {
  private overrides: Map<string, unknown>;
  private storage: RuntimeStorage;
  private projectConfig?: ProjectConfig;
  private globalStorage?: RuntimeStorage;

  constructor(
    storage: RuntimeStorage,
    overrides: Record<string, unknown> = {},
    projectConfig?: ProjectConfig,
    globalStorage?: RuntimeStorage
  ) {
    this.storage = storage;
    this.overrides = new Map(Object.entries(overrides));
    this.projectConfig = projectConfig;
    this.globalStorage = globalStorage !== undefined ? globalStorage : createGlobalStorage();
  }

  get<T = unknown>(key: string): T | undefined;
  get<T = unknown>(key: string, defaultValue: T): T;
  get<T = unknown>(key: string, defaultValue?: T): T | undefined {
    // 1. CLI / Temporary Override
    if (this.overrides.has(key)) {
      return this.overrides.get(key) as T;
    }

    // 2. Local Project Storage (SQLite)
    const stored = this.storage.getConfig<T>(key);
    if (stored !== undefined) {
      return stored;
    }

    // 3. Global Storage (~/.actiondock/global.db)
    if (this.globalStorage) {
      try {
        const globalStored = this.globalStorage.getConfig<T>(key);
        if (globalStored !== undefined) {
          return globalStored;
        }
      } catch {
        // Ignore global storage read error
      }
    }

    // 4. Environment Variables (process.env with explicit binding, prefix & type coercion)
    const itemDef = this.projectConfig?.config?.[key];
    const envResolved = resolveEnvValue(key, itemDef, this.projectConfig?.id);
    if (envResolved !== undefined) {
      return envResolved.value as T;
    }

    // 5. Project Default (actiondock.json)
    if (itemDef?.default !== undefined) {
      return itemDef.default as T;
    }

    return defaultValue;
  }

  has(key: string): boolean {
    if (this.overrides.has(key)) return true;
    if (this.storage.getConfig(key) !== undefined) return true;
    if (this.globalStorage?.getConfig(key) !== undefined) return true;
    const itemDef = this.projectConfig?.config?.[key];
    if (resolveEnvValue(key, itemDef, this.projectConfig?.id) !== undefined) return true;
    if (itemDef?.default !== undefined) return true;
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
