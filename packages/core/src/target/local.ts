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
import { LocalActionDockService } from "../service/local";
import type { ActionDockService } from "../service/types";
import type { StateEntry } from "../storage/types";
import {
  ACTIONDOCK_PROTOCOL_VERSION,
  type ActionDockTarget,
  type ConfigValueView,
  type ListRunsOptions,
  type StateScopeOptions,
  type TargetInfo,
  TargetError,
  TARGET_CAPABILITY_UNAVAILABLE,
} from "./types";

/**
 * 基于 ActionDockService 的 Target 门面适配层。
 * 为 CLI 与旧版调用方提供统一调用契约，绝不暴露 unwrap 穿透能力。
 */
export class ServiceActionDockTarget implements ActionDockTarget {
  public readonly service: ActionDockService;

  constructor(service: ActionDockService) {
    this.service = service;
  }

  async info(): Promise<TargetInfo> {
    const packages = await this.listPackages();
    const id = packages[0]?.id || "local-host";
    const name = packages[0]?.name || "Local Host";
    return {
      id,
      name,
      protocolVersion: ACTIONDOCK_PROTOCOL_VERSION,
      packages,
      capabilities: [
        "actions",
        "playbooks",
        "runs",
        "events",
        "management.config",
        "management.state",
      ],
      idempotencyPolicy: {
        retentionMs: 86400000,
        header: "x-request-id",
      },
    };
  }

  async listPackages(): Promise<PackageInfo[]> {
    return this.service.discovery.listPackages();
  }

  async listActions(options?: ListActionsOptions): Promise<ActionSummary[]> {
    return this.service.discovery.listActions(options);
  }

  async describeAction(ref: ActionRef | string): Promise<ActionSpec> {
    return this.service.discovery.describeAction(ref);
  }

  async listPlaybooks(options?: { intent?: string; package?: string }): Promise<PlaybookSummary[]> {
    return this.service.discovery.listPlaybooks(options);
  }

  async describePlaybook(id: string): Promise<PlaybookSpec> {
    return this.service.discovery.describePlaybook(id);
  }

  async runAction(
    ref: ActionRef | string,
    input: JsonValue,
    options?: ExecuteOptions
  ): Promise<ExecutionResult> {
    return this.service.execution.run(ref, input, options);
  }

  async startAction(
    ref: ActionRef | string,
    input: JsonValue,
    options?: ExecuteOptions
  ): Promise<ExecutionTicket> {
    return this.service.execution.start(ref, input, options);
  }

  async listRuns(options?: ListRunsOptions): Promise<RunRecord[]> {
    return this.service.runs.list(options);
  }

  async getRun(runId: string): Promise<RunRecord | undefined> {
    return this.service.runs.get(runId);
  }

  async cancelRun(runId: string, reason?: string): Promise<CancelResult> {
    return this.service.runs.cancel(runId, reason);
  }

  async clearRuns(options?: { packageId?: string; actionId?: string; status?: string }): Promise<number> {
    if (this.service.runs.clear) {
      return this.service.runs.clear(options);
    }
    return 0;
  }

  events(
    runId: string,
    options?: { after?: number | string; signal?: AbortSignal; maxQueueSize?: number }
  ): AsyncIterable<ExecutionEvent> {
    return this.service.runs.events(runId, options);
  }

  async getConfig(packageId: string, key: string): Promise<ConfigValueView> {
    if (!this.service.management?.config) {
      throw new TargetError(TARGET_CAPABILITY_UNAVAILABLE, "Management config port is not available");
    }
    return this.service.management.config.get(packageId, key);
  }

  async setConfig(packageId: string, key: string, value: JsonValue): Promise<void> {
    if (!this.service.management?.config) {
      throw new TargetError(TARGET_CAPABILITY_UNAVAILABLE, "Management config port is not available");
    }
    await this.service.management.config.set(packageId, key, value);
  }

  async deleteConfig(packageId: string, key: string): Promise<boolean> {
    if (!this.service.management?.config) {
      throw new TargetError(TARGET_CAPABILITY_UNAVAILABLE, "Management config port is not available");
    }
    return this.service.management.config.delete(packageId, key);
  }

  async listConfig(packageId: string): Promise<ConfigValueView[]> {
    if (!this.service.management?.config) {
      throw new TargetError(TARGET_CAPABILITY_UNAVAILABLE, "Management config port is not available");
    }
    return this.service.management.config.list(packageId);
  }

  async getState<T extends JsonValue = JsonValue>(
    packageId: string,
    actionId: string,
    key: string,
    options?: StateScopeOptions
  ): Promise<T | undefined> {
    if (!this.service.management?.state) {
      throw new TargetError(TARGET_CAPABILITY_UNAVAILABLE, "Management state port is not available");
    }
    return this.service.management.state.get<T>(packageId, actionId, key, options);
  }

  async setState<T extends JsonValue = JsonValue>(
    packageId: string,
    actionId: string,
    key: string,
    value: T,
    options?: StateScopeOptions
  ): Promise<void> {
    if (!this.service.management?.state) {
      throw new TargetError(TARGET_CAPABILITY_UNAVAILABLE, "Management state port is not available");
    }
    await this.service.management.state.set<T>(packageId, actionId, key, value, options);
  }

  async deleteState(
    packageId: string,
    actionId: string,
    key: string,
    options?: StateScopeOptions
  ): Promise<boolean> {
    if (!this.service.management?.state) {
      throw new TargetError(TARGET_CAPABILITY_UNAVAILABLE, "Management state port is not available");
    }
    return this.service.management.state.delete(packageId, actionId, key, options);
  }

  async listStateKeys(
    packageId: string,
    actionId: string,
    options?: StateScopeOptions
  ): Promise<string[]> {
    if (!this.service.management?.state) {
      throw new TargetError(TARGET_CAPABILITY_UNAVAILABLE, "Management state port is not available");
    }
    return this.service.management.state.list(packageId, actionId, options);
  }

  async clearState(
    packageId: string,
    actionId: string,
    options?: StateScopeOptions
  ): Promise<number> {
    if (!this.service.management?.state) {
      throw new TargetError(TARGET_CAPABILITY_UNAVAILABLE, "Management state port is not available");
    }
    return this.service.management.state.clear(packageId, actionId, options);
  }

  async listStateEntries(
    packageId: string,
    options?: any
  ): Promise<StateEntry[]> {
    if (!this.service.management?.state?.listEntries) {
      throw new TargetError(TARGET_CAPABILITY_UNAVAILABLE, "listStateEntries is not supported");
    }
    return this.service.management.state.listEntries(packageId, options);
  }

  async close(options?: { timeoutMs?: number }): Promise<void> {
    return this.service.close(options);
  }
}

/**
 * 本地 ActionDockTarget 门面兼容类。
 * 基于 ServiceActionDockTarget 包装 LocalActionDockService，
 * 绝不暴露 unwrap 穿透到底层实例。
 */
export class LocalActionDockTarget extends ServiceActionDockTarget {
  constructor(target: ActionDockHost | ActionDockApp | ActionDockService) {
    if (
      target &&
      typeof target === "object" &&
      "discovery" in target &&
      "execution" in target &&
      "runs" in target
    ) {
      super(target as ActionDockService);
    } else {
      super(new LocalActionDockService(target as ActionDockHost | ActionDockApp));
    }
  }
}
