/**
 * Standard JSON Schema definition.
 */
export type JsonSchema = Record<string, unknown> | boolean;

/**
 * Standard Runtime Error returned by ActionDock.
 */
export interface RuntimeError {
  code: string;
  message: string;
  details?: unknown;
  cause?: unknown;
}

/**
 * Standard execution result envelope.
 */
export type ExecutionResult<T = unknown> =
  | {
      ok: true;
      runId: string;
      data: T;
    }
  | {
      ok: false;
      runId: string;
      error: RuntimeError;
    };

/**
 * Config provider interface.
 */
export interface Config {
  get<T = unknown>(key: string): T | undefined;
  get<T = unknown>(key: string, defaultValue: T): T;
  has(key: string): boolean;
}

/**
 * Shared State store interface.
 */
export interface StateStore {
  get<T = unknown>(key: string): Promise<T | undefined>;
  set<T = unknown>(key: string, value: T): Promise<void>;
  delete(key: string): Promise<void>;
  keys(prefix?: string): Promise<string[]>;
  scope(namespace: string): StateStore;
}

/**
 * Structured Logger interface.
 */
export interface Logger {
  debug(message: string, data?: unknown): void;
  info(message: string, data?: unknown): void;
  warn(message: string, data?: unknown): void;
  error(message: string, data?: unknown): void;
}

/**
 * Action-to-Action invoker interface.
 */
export interface ActionInvoker {
  invoke<I, O>(
    action: ActionDefinition<I, O>,
    input: I
  ): Promise<O>;
}

/**
 * Runtime context passed to Action `run` handler.
 */
export interface ActionContext {
  config: Config;
  state: StateStore;
  actions: ActionInvoker;
  log: Logger;
}

/**
 * Action definition contract.
 */
export interface ActionDefinition<I = unknown, O = unknown> {
  id: string;
  description?: string;
  inputSchema?: JsonSchema;
  outputSchema?: JsonSchema;
  run(input: I, ctx: ActionContext): Promise<O> | O;
}

/**
 * Record of an Action execution.
 */
export interface RunRecord {
  id: string;
  packageId: string;
  actionId: string;
  parentRunId?: string;
  status: "running" | "success" | "failed";
  input: unknown;
  output?: unknown;
  error?: RuntimeError;
  startedAt: string;
  finishedAt?: string;
}
