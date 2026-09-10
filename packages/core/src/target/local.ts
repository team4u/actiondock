import type {
  ActionRef,
  ExecutionEvent,
  ExecutionResult,
  JsonValue,
  RunRecord,
} from "@actiondock/sdk";
import type {
  ActionDockApp,
  ActionSpec,
  ActionSummary,
  ListActionsOptions,
  PackageInfo,
  PlaybookSpec,
  PlaybookSummary,
} from "../app/types";
import type {
  CancelResult,
  ExecuteOptions,
  ExecutionTicket,
} from "../execution/types";
import type { ActionDockHost } from "../host/types";
import type { ActionDockTarget } from "./types";

/**
 * 本地 ActionDockTarget 门面实现。
 * 内部包装 ActionDockHost 或 ActionDockApp，将统一调用直接转交给 Host 或 App。
 */
export class LocalActionDockTarget implements ActionDockTarget {
  public readonly target: ActionDockHost | ActionDockApp;

  constructor(target: ActionDockHost | ActionDockApp) {
    this.target = target;
  }

  async info(): Promise<PackageInfo | PackageInfo[]> {
    return this.target.info();
  }

  async listActions(options?: ListActionsOptions): Promise<ActionSummary[]> {
    return this.target.listActions(options);
  }

  async describeAction(ref: ActionRef | string): Promise<ActionSpec> {
    if ("getApp" in this.target) {
      return this.target.describeAction(ref);
    } else {
      const actionId = typeof ref === "string" ? ref : ref.actionId;
      return this.target.describeAction(actionId);
    }
  }

  async listPlaybooks(): Promise<PlaybookSummary[]> {
    return this.target.listPlaybooks();
  }

  async describePlaybook(id: string): Promise<PlaybookSpec> {
    return this.target.describePlaybook(id);
  }

  async runAction(
    ref: ActionRef | string,
    input: JsonValue,
    options?: ExecuteOptions
  ): Promise<ExecutionResult> {
    return this.target.runAction(ref, input, options);
  }

  async startAction(
    ref: ActionRef | string,
    input: JsonValue,
    options?: ExecuteOptions
  ): Promise<ExecutionTicket> {
    return this.target.startAction(ref, input, options);
  }

  async getRun(runId: string): Promise<RunRecord | undefined> {
    return this.target.getRun(runId);
  }

  async cancelRun(runId: string, reason?: string): Promise<CancelResult> {
    return this.target.cancelRun(runId, reason);
  }

  events(
    runId: string,
    options?: { after?: number; signal?: AbortSignal }
  ): AsyncIterable<ExecutionEvent> {
    return this.target.events(runId, options);
  }

  async close(): Promise<void> {
    return this.target.close();
  }
}
