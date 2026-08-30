import { randomUUID } from "node:crypto";
import type {
  ActionContext,
  ActionDefinition,
  ExecutionResult,
  RuntimeError,
  RunRecord,
} from "@actiondock/sdk";
import type { ProjectConfig } from "../project/types";
import { validateSchema } from "../schema/validator";
import type { RuntimeStorage, TerminalRunStatus } from "../storage/types";
import { RuntimeConfig, RuntimeStateStore, StderrLogger } from "./context";

export interface RunnerOptions {
  packageId: string;
  storage: RuntimeStorage;
  projectConfig?: ProjectConfig;
  configOverrides?: Record<string, unknown>;
  actions?: Map<string, ActionDefinition>;
}

export interface ExecutionStartOptions {
  parentRunId?: string;
  callStack?: string[];
  signal?: AbortSignal;
  timeoutMs?: number;
}

export interface ExecutionHandle {
  runId: string;
  result: Promise<ExecutionResult>;
  cancel(reason?: string): boolean;
}

export class ActionRunner {
  private packageId: string;
  private storage: RuntimeStorage;
  private projectConfig?: ProjectConfig;
  private configOverrides: Record<string, unknown>;
  private actions: Map<string, ActionDefinition>;

  constructor(options: RunnerOptions) {
    this.packageId = options.packageId;
    this.storage = options.storage;
    this.projectConfig = options.projectConfig;
    this.configOverrides = options.configOverrides || {};
    this.actions = options.actions || new Map();
  }

  public registerAction(action: ActionDefinition): void {
    this.actions.set(action.id, action);
  }

  public getAction(id: string): ActionDefinition | undefined {
    return this.actions.get(id);
  }

  public listActions(): ActionDefinition[] {
    return Array.from(this.actions.values());
  }

  /**
   * Starts an Action execution asynchronously and returns an ExecutionHandle.
   */
  start(
    actionOrId: ActionDefinition | string,
    input: unknown = {},
    options: ExecutionStartOptions = {}
  ): ExecutionHandle {
    const runId = randomUUID();
    const startedAt = new Date().toISOString();
    const callStack = [...(options.callStack || [])];

    let action: ActionDefinition;
    if (typeof actionOrId === "string") {
      const found = this.actions.get(actionOrId);
      if (!found) {
        const error: RuntimeError = {
          code: "ACTION_NOT_FOUND",
          message: `Action '${actionOrId}' not found in registry`,
        };
        return {
          runId,
          result: Promise.resolve({ ok: false, runId, error }),
          cancel: () => false,
        };
      }
      action = found;
    } else {
      action = actionOrId;
    }

    // 1. Cycle detection
    if (callStack.includes(action.id)) {
      const error: RuntimeError = {
        code: "ACTION_CYCLE_DETECTED",
        message: `Cycle detected in action invocation: ${callStack.join(" -> ")} -> ${action.id}`,
      };
      return {
        runId,
        result: Promise.resolve({ ok: false, runId, error }),
        cancel: () => false,
      };
    }
    callStack.push(action.id);

    // 2. Validate input schema
    if (action.inputSchema) {
      const val = validateSchema(action.inputSchema, input);
      if (!val.valid) {
        const error: RuntimeError = {
          code: "INPUT_VALIDATION_FAILED",
          message: `Input schema validation failed for action '${action.id}'`,
          details: val.errors,
        };
        return {
          runId,
          result: Promise.resolve({ ok: false, runId, error }),
          cancel: () => false,
        };
      }
    }

    // 3. Create initial RunRecord
    const initialRun: RunRecord = {
      id: runId,
      packageId: this.packageId,
      actionId: action.id,
      parentRunId: options.parentRunId,
      status: "running",
      input,
      startedAt,
    };
    this.storage.createRun(initialRun);

    // 4. Abort Controller & Timeout Setup
    const controller = new AbortController();
    if (options.signal) {
      if (options.signal.aborted) {
        controller.abort(options.signal.reason);
      } else {
        options.signal.addEventListener(
          "abort",
          () => controller.abort(options.signal?.reason),
          { once: true }
        );
      }
    }

    let isTimeout = false;
    let timeoutTimer: ReturnType<typeof setTimeout> | undefined;
    if (typeof options.timeoutMs === "number" && options.timeoutMs > 0) {
      timeoutTimer = setTimeout(() => {
        isTimeout = true;
        controller.abort(new Error(`Action exceeded timeout of ${options.timeoutMs}ms`));
      }, options.timeoutMs);
    }

    let finalized = false;
    const finalizeRun = (
      status: TerminalRunStatus,
      output?: unknown,
      error?: RuntimeError
    ) => {
      if (timeoutTimer) {
        clearTimeout(timeoutTimer);
        timeoutTimer = undefined;
      }
      if (finalized) return;
      finalized = true;
      this.storage.updateRun(runId, status, output, error);
    };

    // 5. Build ActionContext
    const config = new RuntimeConfig(
      this.storage,
      this.configOverrides,
      this.projectConfig
    );
    const state = new RuntimeStateStore(this.storage);
    const log = new StderrLogger(action.id);

    const invoker = {
      invoke: async <I, O>(
        childAction: ActionDefinition<I, O>,
        childInput: I
      ): Promise<O> => {
        const childResult = await this.execute(childAction, childInput, {
          parentRunId: runId,
          callStack,
          signal: controller.signal,
        });
        if (!childResult.ok) {
          const err = new Error(childResult.error.message);
          (err as any).code = childResult.error.code;
          (err as any).details = childResult.error.details;
          throw err;
        }
        return childResult.data as O;
      },
    };

    const ctx: ActionContext = {
      config,
      state,
      actions: invoker,
      log,
      signal: controller.signal,
    };

    // 6. Execute action with cancellation / timeout race
    const abortPromise = new Promise<never>((_, reject) => {
      if (controller.signal.aborted) {
        reject(controller.signal.reason || new Error("Action execution was cancelled"));
      } else {
        controller.signal.addEventListener(
          "abort",
          () => reject(controller.signal.reason || new Error("Action execution was cancelled")),
          { once: true }
        );
      }
    });

    const executionPromise = (async (): Promise<ExecutionResult> => {
      try {
        const rawOutput = await Promise.race([
          Promise.resolve().then(() => action.run(input, ctx)),
          abortPromise,
        ]);

        // Validate output schema if defined
        if (action.outputSchema) {
          const outVal = validateSchema(action.outputSchema, rawOutput);
          if (!outVal.valid) {
            const error: RuntimeError = {
              code: "OUTPUT_VALIDATION_FAILED",
              message: `Output schema validation failed for action '${action.id}'`,
              details: outVal.errors,
            };
            finalizeRun("failed", undefined, error);
            return { ok: false, runId, error };
          }
        }

        finalizeRun("success", rawOutput);
        return {
          ok: true,
          runId,
          data: rawOutput,
        };
      } catch (err: any) {
        if (isTimeout) {
          const error: RuntimeError = {
            code: "ACTION_TIMEOUT",
            message: `Action exceeded timeout of ${options.timeoutMs}ms`,
          };
          finalizeRun("failed", undefined, error);
          return { ok: false, runId, error };
        }

        if (controller.signal.aborted) {
          const reason = controller.signal.reason;
          const reasonMsg =
            reason instanceof Error
              ? reason.message
              : typeof reason === "string"
              ? reason
              : undefined;
          const error: RuntimeError = {
            code: "ACTION_CANCELLED",
            message: "Action execution was cancelled",
            details: reasonMsg ? { reason: reasonMsg } : undefined,
          };
          finalizeRun("cancelled", undefined, error);
          return { ok: false, runId, error };
        }

        const error: RuntimeError = {
          code: err?.code || "ACTION_FAILED",
          message: err?.message || String(err),
          details: err?.details,
        };
        finalizeRun("failed", undefined, error);
        return {
          ok: false,
          runId,
          error,
        };
      }
    })();

    return {
      runId,
      result: executionPromise,
      cancel: (reason?: string): boolean => {
        if (finalized || controller.signal.aborted) {
          return false;
        }
        controller.abort(new Error(reason || "Action execution was cancelled"));
        return true;
      },
    };
  }

  /**
   * Execute an Action by definition or ID with input, producing standard ExecutionResult.
   */
  async execute(
    actionOrId: ActionDefinition | string,
    input: unknown = {},
    options: ExecutionStartOptions = {}
  ): Promise<ExecutionResult> {
    return this.start(actionOrId, input, options).result;
  }
}
