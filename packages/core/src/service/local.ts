import type {
  ActionRef,
  ExecutionEvent,
  ExecutionResult,
  JsonValue,
  RunRecord,
} from "@actiondock/sdk";
import type {
  ActionSpec,
  ActionSummary,
  ListActionsOptions,
  PackageInfo,
  PlaybookSpec,
  PlaybookSummary,
} from "../package/types";
import type {
  CancelResult,
  ExecutionTicket,
} from "../execution/types";
import type { RunOptions } from "../invocation/types";
import { parseActionRef } from "../catalog/resolve-action";
import type { ActionDockHost } from "../host/types";
import type { StateEntry } from "../storage/types";
import {
  CloseTimeoutError,
  type ConfigValueView,
  type ListRunsOptions,
  type StateScopeOptions,
} from "./types";
import type {
  ActionDockService,
  ConfigPort,
  DiscoveryPort,
  EventsPort,
  ExecutionPort,
  RunEventSubscriptionOptions,
  RunsPort,
  StatePort,
} from "./types";

/**
 * 本地 ActionDockService 实现。
 * 遵循标准 Service Ports 体系，面向 ActionDockHost 协调中枢提供结构化服务端口，
 * 严禁暴露 unwrap 穿透到内部领域对象。
 */
export class LocalActionDockService implements ActionDockService {
  protected readonly host: ActionDockHost;

  public readonly discovery: DiscoveryPort;
  public readonly execution: ExecutionPort;
  public readonly runs: RunsPort;
  public readonly events: EventsPort;
  public readonly management?: {
    config: ConfigPort;
    state: StatePort;
  };

  constructor(
    host: ActionDockHost,
    options?: { enableManagement?: boolean }
  ) {
    this.host = host;

    const self = this;

    this.discovery = {
      async listPackages(): Promise<PackageInfo[]> {
        return self.host.info();
      },

      async listActions(opts?: ListActionsOptions): Promise<ActionSummary[]> {
        return self.host.listActions(opts);
      },

      async describeAction(ref: ActionRef | string): Promise<ActionSpec> {
        return self.host.describeAction(ref);
      },

      async listPlaybooks(opts?: { intent?: string; package?: string }): Promise<PlaybookSummary[]> {
        return self.host.listPlaybooks(opts);
      },

      async describePlaybook(id: string): Promise<PlaybookSpec> {
        return self.host.describePlaybook(id);
      },
    };

    this.execution = {
      async run(
        ref: ActionRef | string,
        input?: unknown,
        opts?: RunOptions
      ): Promise<ExecutionResult> {
        const actionRef: ActionRef = typeof ref === "string" ? parseActionRef(ref) : ref;
        return self.host.runAction(actionRef, (input ?? {}) as JsonValue, opts);
      },

      async start(
        ref: ActionRef | string,
        input?: unknown,
        opts?: RunOptions
      ): Promise<ExecutionTicket> {
        const actionRef: ActionRef = typeof ref === "string" ? parseActionRef(ref) : ref;
        return self.host.startAction(actionRef, (input ?? {}) as JsonValue, opts);
      },
    };

    this.runs = {
      async list(query?: ListRunsOptions): Promise<RunRecord[]> {
        return self.host.listRuns(query);
      },

      async get(runId: string): Promise<RunRecord | undefined> {
        return self.host.getRun(runId);
      },

      async cancel(runId: string, reason?: string): Promise<CancelResult> {
        return self.host.cancelRun(runId, reason);
      },

      async clear(opts?: { packageId?: string; actionId?: string; status?: string; olderThanMs?: number }): Promise<number> {
        return self.host.clearRuns(opts);
      },
    };

    this.events = {
      events(
        runId: string,
        opts?: RunEventSubscriptionOptions
      ): AsyncIterable<ExecutionEvent> {
        return self.host.events(runId, opts);
      },
    };

    if (options?.enableManagement !== false) {
      this.management = {
        config: {
          async get(packageId: string, key: string): Promise<ConfigValueView> {
            return self.host.getConfig(packageId, key);
          },

          async set(packageId: string, key: string, value: JsonValue): Promise<void> {
            return self.host.setConfig(packageId, key, value);
          },

          async delete(packageId: string, key: string): Promise<boolean> {
            return self.host.deleteConfig(packageId, key);
          },

          async list(packageId: string): Promise<ConfigValueView[]> {
            return self.host.listConfig(packageId);
          },
        },

        state: {
          async get<T extends JsonValue = JsonValue>(
            packageId: string,
            actionId: string,
            key: string,
            opts?: StateScopeOptions
          ): Promise<T | undefined> {
            return self.host.getState<T>(packageId, actionId, key, opts);
          },

          async set<T extends JsonValue = JsonValue>(
            packageId: string,
            actionId: string,
            key: string,
            value: T,
            opts?: StateScopeOptions
          ): Promise<void> {
            return self.host.setState<T>(packageId, actionId, key, value, opts);
          },

          async delete(
            packageId: string,
            actionId: string,
            key: string,
            opts?: StateScopeOptions
          ): Promise<boolean> {
            return self.host.deleteState(packageId, actionId, key, opts);
          },

          async list(
            packageId: string,
            actionId: string,
            opts?: StateScopeOptions
          ): Promise<string[]> {
            return self.host.listStateKeys(packageId, actionId, opts);
          },

          async clear(
            packageId: string,
            actionId: string,
            opts?: StateScopeOptions
          ): Promise<number> {
            return self.host.clearState(packageId, actionId, opts);
          },

          async listEntries(
            packageId: string,
            opts?: any
          ): Promise<StateEntry[]> {
            return self.host.listStateEntries(packageId, opts);
          },
        },
      };
    }
  }

  async info(): Promise<PackageInfo[]> {
    return this.discovery.listPackages();
  }

  async close(options?: { timeoutMs?: number; graceMs?: number }): Promise<void> {
    const timeout = options?.timeoutMs ?? options?.graceMs;
    if (timeout && timeout > 0) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const timeoutPromise = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          reject(new CloseTimeoutError(`Service close operation timed out after ${timeout}ms`));
        }, timeout);
      });
      try {
        await Promise.race([this.host.close(options), timeoutPromise]);
      } finally {
        if (timer) clearTimeout(timer);
      }
      return;
    }
    return this.host.close(options);
  }
}
