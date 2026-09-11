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
import { createGlobalStorage, isSecretConfigKey } from "../storage";
import type { RuntimeStorage, StateEntry } from "../storage/types";
import {
  ACTIONDOCK_PROTOCOL_VERSION,
  type ActionDockTarget,
  type ConfigValueView,
  type ListRunsOptions,
  type StateScopeOptions,
  type TargetInfo,
  TargetError,
  CloseTimeoutError,
  TARGET_CAPABILITY_UNAVAILABLE,
} from "./types";

/**
 * 本地 ActionDockTarget 门面实现。
 * 内部包装 ActionDockHost 或 ActionDockApp，将统一调用直接转交给 Host 或 App。
 */
export class LocalActionDockTarget implements ActionDockTarget {
  public readonly target: ActionDockHost | ActionDockApp;

  constructor(target: ActionDockHost | ActionDockApp) {
    this.target = target;
  }

  unwrap(): ActionDockHost | ActionDockApp {
    return this.target;
  }

  async info(): Promise<TargetInfo> {
    const packages = await this.listPackages();
    let id = "local-host";
    let name = "Local Host";
    if ("listApps" in this.target) {
      id = (this.target as any).id || "local-host";
      name = (this.target as any).name || "Local Host";
    } else {
      id = this.target.packageId;
      name = packages[0]?.name || this.target.packageId;
    }
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
    if ("listApps" in this.target) {
      const apps = this.target.listApps();
      return Promise.all(apps.map((app) => app.info()));
    } else {
      return [await this.target.info()];
    }
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
    if ("listApps" in this.target) {
      return (this.target as ActionDockHost).runAction(ref, input, options);
    }
    const actionId = typeof ref === "string" ? (ref.includes(":") ? ref.split(":").pop()! : ref) : ref.actionId;
    return (this.target as ActionDockApp).runAction(actionId, input, options);
  }

  async startAction(
    ref: ActionRef | string,
    input: JsonValue,
    options?: ExecuteOptions
  ): Promise<ExecutionTicket> {
    if ("listApps" in this.target) {
      return (this.target as ActionDockHost).startAction(ref, input, options);
    }
    const actionId = typeof ref === "string" ? (ref.includes(":") ? ref.split(":").pop()! : ref) : ref.actionId;
    return (this.target as ActionDockApp).startAction(actionId, input, options);
  }

  async listRuns(options?: ListRunsOptions): Promise<RunRecord[]> {
    if ("listApps" in this.target) {
      const apps = options?.packageId
        ? [this.target.getApp(options.packageId)].filter(Boolean) as ActionDockApp[]
        : this.target.listApps();
      let records: RunRecord[] = [];
      for (const app of apps) {
        const recs = app.storage.listRuns({
          actionId: options?.actionId,
          limit: options?.limit,
        });
        for (const r of recs) {
          records.push({
            ...r,
            packageId: (r as any).packageId || app.packageId,
          });
        }
      }
      records.sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime());
      if (options?.status) {
        records = records.filter((r) => r.status === options.status);
      }
      if (options?.limit && records.length > options.limit) {
        records = records.slice(0, options.limit);
      }
      return records;
    } else {
      if (options?.packageId && options.packageId !== this.target.packageId) {
        return [];
      }
      let records = this.target.storage.listRuns({
        actionId: options?.actionId,
        limit: options?.limit,
      });
      if (options?.status) {
        records = records.filter((r) => r.status === options.status);
      }
      if (options?.limit && records.length > options.limit) {
        records = records.slice(0, options.limit);
      }
      return records;
    }
  }

  async clearRuns(options?: { packageId?: string; actionId?: string; status?: string }): Promise<number> {
    if ("listApps" in this.target) {
      const apps = options?.packageId
        ? [this.target.getApp(options.packageId)].filter(Boolean) as ActionDockApp[]
        : this.target.listApps();
      let total = 0;
      for (const app of apps) {
        total += app.storage.clearRuns({
          actionId: options?.actionId,
          status: options?.status,
        });
      }
      return total;
    } else {
      if (options?.packageId && options.packageId !== this.target.packageId) {
        return 0;
      }
      return this.target.storage.clearRuns({
        actionId: options?.actionId,
        status: options?.status,
      });
    }
  }

  async getRun(runId: string): Promise<RunRecord | undefined> {
    return this.target.getRun(runId);
  }

  async cancelRun(runId: string, reason?: string): Promise<CancelResult> {
    return this.target.cancelRun(runId, reason);
  }

  events(
    runId: string,
    options?: { after?: number | string; signal?: AbortSignal; maxQueueSize?: number }
  ): AsyncIterable<ExecutionEvent> {
    return this.target.events(runId, options);
  }

  private resolveApp(packageId?: string): ActionDockApp | undefined {
    if ("listApps" in this.target) {
      if (packageId) {
        return this.target.getApp(packageId);
      }
      const apps = this.target.listApps();
      return apps.length === 1 ? apps[0] : undefined;
    } else {
      if (!packageId || packageId === this.target.packageId) {
        return this.target;
      }
      return undefined;
    }
  }

  private getGlobalStorage(): RuntimeStorage {
    if ("globalStorage" in this.target && (this.target as any).globalStorage) {
      return (this.target as any).globalStorage;
    }
    const apps = "listApps" in this.target ? (this.target as any).listApps() : [];
    for (const app of apps) {
      if (app.globalStorage) return app.globalStorage;
    }
    return createGlobalStorage({
      dataDir: (this.target as any).options?.dataDir,
      customHome: (this.target as any).options?.customHome,
    });
  }

  async getConfig(packageId: string, key: string): Promise<ConfigValueView> {
    if (packageId === "global") {
      const globalStorage = this.getGlobalStorage();
      const val = globalStorage.getConfig(key);
      const configured = val !== undefined;
      const isSecret = isSecretConfigKey(key);
      return {
        key,
        configured,
        secret: isSecret,
        source: configured ? "global" : "default",
        value: !isSecret && configured ? (val as JsonValue) : undefined,
      };
    }
    const app = this.resolveApp(packageId);
    if (!app) {
      throw new Error(`Package '${packageId}' not found in target`);
    }
    return app.getConfig(key);
  }

  async setConfig(packageId: string, key: string, value: JsonValue): Promise<void> {
    if (packageId === "global") {
      await this.getGlobalStorage().setConfig(key, value);
      return;
    }
    const app = this.resolveApp(packageId);
    if (!app) {
      throw new Error(`Package '${packageId}' not found in target`);
    }
    await app.setConfig(key, value);
  }

  async deleteConfig(packageId: string, key: string): Promise<boolean> {
    if (packageId === "global") {
      return await this.getGlobalStorage().deleteConfig(key);
    }
    const app = this.resolveApp(packageId);
    if (!app) {
      throw new Error(`Package '${packageId}' not found in target`);
    }
    return await app.deleteConfig(key);
  }

  async listConfig(packageId: string): Promise<ConfigValueView[]> {
    if (packageId === "global") {
      const globalStorage = this.getGlobalStorage();
      const all = globalStorage.listConfig();
      return Object.entries(all).map(([key, val]) => {
        const isSecret = isSecretConfigKey(key);
        return {
          key,
          configured: true,
          secret: isSecret,
          source: "global",
          value: isSecret ? undefined : (val as JsonValue),
        };
      });
    }
    const app = this.resolveApp(packageId);
    if (!app) {
      throw new Error(`Package '${packageId}' not found in target`);
    }
    return app.listConfig();
  }

  async getState<T extends JsonValue = JsonValue>(
    packageId: string,
    actionId: string,
    key: string,
    options?: StateScopeOptions
  ): Promise<T | undefined> {
    const app = this.resolveApp(packageId);
    if (!app) {
      throw new Error(`Package '${packageId}' not found in target`);
    }
    return app.getState<T>(actionId, key, options);
  }

  async setState<T extends JsonValue = JsonValue>(
    packageId: string,
    actionId: string,
    key: string,
    value: T,
    options?: StateScopeOptions
  ): Promise<void> {
    const app = this.resolveApp(packageId);
    if (!app) {
      throw new Error(`Package '${packageId}' not found in target`);
    }
    await app.setState<T>(actionId, key, value, options);
  }

  async deleteState(
    packageId: string,
    actionId: string,
    key: string,
    options?: StateScopeOptions
  ): Promise<boolean> {
    const app = this.resolveApp(packageId);
    if (!app) {
      throw new Error(`Package '${packageId}' not found in target`);
    }
    return app.deleteState(actionId, key, options);
  }

  async listStateKeys(
    packageId: string,
    actionId: string,
    options?: StateScopeOptions
  ): Promise<string[]> {
    const app = this.resolveApp(packageId);
    if (!app) {
      throw new Error(`Package '${packageId}' not found in target`);
    }
    return app.listStateKeys(actionId, options);
  }

  async clearState(
    packageId: string,
    actionId: string,
    options?: StateScopeOptions
  ): Promise<number> {
    const app = this.resolveApp(packageId);
    if (!app) {
      throw new Error(`Package '${packageId}' not found in target`);
    }
    return app.clearState(actionId, options);
  }

  async listStateEntries(
    packageId: string,
    options?: any
  ): Promise<StateEntry[]> {
    const app = this.resolveApp(packageId);
    if (!app) {
      throw new TargetError(
        TARGET_CAPABILITY_UNAVAILABLE,
        `TARGET_CAPABILITY_UNAVAILABLE: Package '${packageId}' not found in target`
      );
    }
    if (!app.storage || typeof (app.storage as any).listStateEntries !== "function") {
      throw new TargetError(
        TARGET_CAPABILITY_UNAVAILABLE,
        `TARGET_CAPABILITY_UNAVAILABLE: listStateEntries is not supported by package '${packageId}' storage`
      );
    }
    return app.storage.listStateEntries(options);
  }

  async close(options?: { timeoutMs?: number }): Promise<void> {
    if (options?.timeoutMs && options.timeoutMs > 0) {
      let timer: any;
      const timeoutPromise = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          reject(new CloseTimeoutError(`Target close operation timed out after ${options.timeoutMs}ms`));
        }, options.timeoutMs);
      });
      try {
        await Promise.race([this.target.close(), timeoutPromise]);
      } finally {
        clearTimeout(timer);
      }
      return;
    }
    return this.target.close();
  }
}
