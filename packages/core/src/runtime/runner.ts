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
import type { RuntimeStorage } from "../storage/types";
import { RuntimeConfig, RuntimeStateStore, StderrLogger } from "./context";

export interface RunnerOptions {
  packageId: string;
  storage: RuntimeStorage;
  projectConfig?: ProjectConfig;
  configOverrides?: Record<string, unknown>;
  actions?: Map<string, ActionDefinition>;
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
   * Execute an Action by definition or ID with input, producing standard ExecutionResult.
   */
  async execute(
    actionOrId: ActionDefinition | string,
    input: unknown = {},
    options: { parentRunId?: string; callStack?: string[] } = {}
  ): Promise<ExecutionResult> {
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
        return { ok: false, runId, error };
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
      return { ok: false, runId, error };
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
        return { ok: false, runId, error };
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

    // 4. Build ActionContext
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
    };

    // 5. Execute action
    try {
      const rawOutput = await action.run(input, ctx);

      // Validate output schema if defined
      if (action.outputSchema) {
        const outVal = validateSchema(action.outputSchema, rawOutput);
        if (!outVal.valid) {
          const error: RuntimeError = {
            code: "OUTPUT_VALIDATION_FAILED",
            message: `Output schema validation failed for action '${action.id}'`,
            details: outVal.errors,
          };
          this.storage.updateRun(runId, "failed", undefined, error);
          return { ok: false, runId, error };
        }
      }

      this.storage.updateRun(runId, "success", rawOutput);
      return {
        ok: true,
        runId,
        data: rawOutput,
      };
    } catch (err: any) {
      const error: RuntimeError = {
        code: err.code || "ACTION_FAILED",
        message: err.message || String(err),
        details: err.details,
      };
      this.storage.updateRun(runId, "failed", undefined, error);
      return {
        ok: false,
        runId,
        error,
      };
    }
  }
}
