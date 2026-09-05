import { randomUUID } from "node:crypto";
import type {
  ActionDefinition,
  ActionRef,
  ExecutionEvent,
  ExecutionResult,
  JsonValue,
  ProgressReporter,
  RunRecord,
  RunStatus,
} from "@actiondock/sdk";
import type { ProjectConfig } from "../project/types";
import { type EventSink, getDefaultEventSink } from "../runtime/events";
import { ActionRunner, type ExecutionHandle } from "../runtime/runner";
import type { RuntimeStorage } from "../storage/types";
import type {
  CancelResult,
  ExecuteOptions,
  ExecutionService,
  ExecutionTicket,
} from "./types";

export interface ExecutionServiceOptions {
  packageId: string;
  storage: RuntimeStorage;
  projectConfig?: ProjectConfig;
  eventSink?: EventSink;
  maxActiveRuns?: number;
  ownerId?: string;
  actionResolver?: (ref: ActionRef) => ActionDefinition | undefined | Promise<ActionDefinition | undefined>;
}

interface ActiveRun {
  runId: string;
  handle: ExecutionHandle;
  controller: AbortController;
  status: RunStatus;
  startedAt: string;
}

/**
 * 统一执行协调服务实现。
 */
export class DefaultExecutionService implements ExecutionService {
  private packageId: string;
  private storage: RuntimeStorage;
  private projectConfig?: ProjectConfig;
  private eventSink: EventSink;
  private maxActiveRuns: number;
  private ownerId: string;
  private runner: ActionRunner;
  private actionResolver?: (ref: ActionRef) => ActionDefinition | undefined | Promise<ActionDefinition | undefined>;
  private activeRuns = new Map<string, ActiveRun>();
  private isClosing = false;

  constructor(options: ExecutionServiceOptions) {
    this.packageId = options.packageId;
    this.storage = options.storage;
    this.projectConfig = options.projectConfig;
    this.eventSink = options.eventSink || getDefaultEventSink();
    this.maxActiveRuns = options.maxActiveRuns || 32;
    this.ownerId = options.ownerId || `host-${randomUUID().slice(0, 8)}`;
    this.actionResolver = options.actionResolver;

    this.runner = new ActionRunner({
      packageId: this.packageId,
      storage: this.storage,
      projectConfig: this.projectConfig,
    });
  }

  public registerAction(action: ActionDefinition): void {
    this.runner.registerAction(action);
  }

  private async resolveTargetAction(ref: ActionRef): Promise<ActionDefinition | undefined> {
    const fromRunner = this.runner.getAction(ref.actionId);
    if (fromRunner) return fromRunner;
    if (this.actionResolver) {
      return this.actionResolver(ref);
    }
    return undefined;
  }

  async execute(
    ref: ActionRef,
    input: JsonValue,
    options: ExecuteOptions = {}
  ): Promise<ExecutionResult> {
    const ticket = await this.start(ref, input, options);
    const active = this.activeRuns.get(ticket.runId);
    if (!active) {
      const record = await this.get(ticket.runId);
      if (record && record.status === "success") {
        return { ok: true, runId: ticket.runId, data: record.output ?? null };
      }
      return {
        ok: false,
        runId: ticket.runId,
        error: record?.error || {
          code: "RUN_TERMINATED_EARLY",
          message: `Run ${ticket.runId} terminated without result`,
        },
      };
    }
    return active.handle.result;
  }

  async start(
    ref: ActionRef,
    input: JsonValue,
    options: ExecuteOptions = {}
  ): Promise<ExecutionTicket> {
    if (this.isClosing) {
      throw new Error("ExecutionService is closing: new tasks rejected");
    }

    if (this.activeRuns.size >= this.maxActiveRuns) {
      throw new Error(
        `Concurrency limit reached: ${this.activeRuns.size}/${this.maxActiveRuns} active runs`
      );
    }

    const action = await this.resolveTargetAction(ref);
    if (!action) {
      const runId = randomUUID();
      const errEvt: ExecutionEvent = {
        runId,
        rootRunId: runId,
        sequence: 0,
        timestamp: new Date().toISOString(),
        type: "finish",
        result: {
          ok: false,
          runId,
          error: {
            code: "ACTION_NOT_FOUND",
            message: `Action '${ref.actionId}' not found in package '${ref.packageId || this.packageId}'`,
          },
        },
      };
      this.eventSink.emit(errEvt);
      return {
        runId,
        status: "failed",
      };
    }

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

    let sequence = 0;
    type EventPayload =
      | { type: "log"; level: "debug" | "info" | "warn" | "error"; message: string; data?: JsonValue }
      | { type: "progress"; current?: number; total?: number; message?: string }
      | { type: "status"; status: RunStatus }
      | { type: "finish"; result: ExecutionResult };

    const handle = this.runner.start(action, input, {
      signal: controller.signal,
      timeoutMs: options.timeoutMs,
    });

    const emitEvent = (payload: EventPayload) => {
      const evt: ExecutionEvent = {
        ...payload,
        runId: handle.runId,
        rootRunId: handle.runId,
        sequence: sequence++,
        timestamp: new Date().toISOString(),
      };
      this.eventSink.emit(evt);
    };

    const progressReporter: ProgressReporter = {
      report(current: number, total?: number, message?: string) {
        emitEvent({
          type: "progress",
          current,
          total,
          message,
        });
      },
    };

    const activeItem: ActiveRun = {
      runId: handle.runId,
      handle,
      controller,
      status: "running",
      startedAt: new Date().toISOString(),
    };

    this.activeRuns.set(handle.runId, activeItem);
    emitEvent({ type: "status", status: "running" });

    handle.result
      .then((result: ExecutionResult) => {
        activeItem.status = result.ok ? "success" : "failed";
        emitEvent({ type: "finish", result });
      })
      .catch((err: any) => {
        activeItem.status = "failed";
        emitEvent({
          type: "finish",
          result: {
            ok: false,
            runId: handle.runId,
            error: {
              code: "UNHANDLED_EXECUTION_ERROR",
              message: err?.message || String(err),
            },
          },
        });
      })
      .finally(() => {
        this.activeRuns.delete(handle.runId);
      });

    return {
      runId: handle.runId,
      status: "running",
    };
  }

  async get(runId: string): Promise<RunRecord | undefined> {
    const record = this.storage.getRun(runId);
    return record || undefined;
  }

  async cancel(runId: string, reason?: string): Promise<CancelResult> {
    const active = this.activeRuns.get(runId);
    if (!active) {
      const record = await this.get(runId);
      if (record) {
        return { outcome: "already_terminal", runId, status: record.status };
      }
      return { outcome: "not_found", runId };
    }

    active.controller.abort(new Error(reason || "Execution cancelled"));
    active.handle.cancel(reason);
    return { outcome: "requested", runId };
  }

  events(
    runId: string,
    options: { after?: number; signal?: AbortSignal } = {}
  ): AsyncIterable<ExecutionEvent> {
    return this.eventSink.subscribe(runId, options);
  }

  async close(options: { graceMs?: number } = {}): Promise<void> {
    this.isClosing = true;
    const graceMs = options.graceMs ?? 5000;

    for (const [_, active] of this.activeRuns) {
      active.controller.abort(new Error("Service shutting down"));
      active.handle.cancel("Service shutting down");
    }

    if (this.activeRuns.size > 0) {
      const waitPromise = Promise.all(
        Array.from(this.activeRuns.values()).map((a) => a.handle.result.catch(() => {}))
      );
      const timeoutPromise = new Promise((resolve) => setTimeout(resolve, graceMs));
      await Promise.race([waitPromise, timeoutPromise]);
    }

    this.activeRuns.clear();
  }
}
