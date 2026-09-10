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
import { createGlobalStorage } from "../storage";
import type { RuntimeStorage, StateEntry } from "../storage/types";
import type { ActionDockTarget, ListRunsOptions } from "./types";

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
    options?: { after?: number; signal?: AbortSignal }
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

  async getConfig(packageId: string, key: string): Promise<any> {
    if (packageId === "global") {
      return this.getGlobalStorage().getConfig(key);
    }
    const app = this.resolveApp(packageId);
    if (!app) {
      throw new Error(`Package '${packageId}' not found in target`);
    }
    return app.getConfig(key);
  }

  async setConfig(packageId: string, key: string, value: JsonValue): Promise<void> {
    if (packageId === "global") {
      this.getGlobalStorage().setConfig(key, value);
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
      return this.getGlobalStorage().deleteConfig(key);
    }
    const app = this.resolveApp(packageId);
    if (!app) {
      throw new Error(`Package '${packageId}' not found in target`);
    }
    return app.storage.deleteConfig(key);
  }

  async listConfig(packageId: string): Promise<Record<string, any>> {
    if (packageId === "global") {
      return this.getGlobalStorage().listConfig();
    }
    const app = this.resolveApp(packageId);
    if (!app) {
      throw new Error(`Package '${packageId}' not found in target`);
    }
    return app.storage.listConfig();
  }

  async getState<T = JsonValue>(
    packageId: string,
    key: string,
    options?: any
  ): Promise<T | undefined> {
    const app = this.resolveApp(packageId);
    if (!app) {
      throw new Error(`Package '${packageId}' not found in target`);
    }
    if (options?.detail) {
      const entry = await app.storage.findState(key, options?.namespace);
      return entry as unknown as T;
    }
    return app.getState<T>(key, options);
  }

  async setState<T = JsonValue>(
    packageId: string,
    key: string,
    value: T,
    options?: any
  ): Promise<void> {
    const app = this.resolveApp(packageId);
    if (!app) {
      throw new Error(`Package '${packageId}' not found in target`);
    }
    await app.setState<T>(key, value, options);
  }

  async deleteState(
    packageId: string,
    key: string,
    options?: any
  ): Promise<boolean> {
    const app = this.resolveApp(packageId);
    if (!app) {
      throw new Error(`Package '${packageId}' not found in target`);
    }
    return app.deleteState(key, options);
  }

  async listStateKeys(
    packageId: string,
    options?: any
  ): Promise<string[]> {
    if (!packageId && "listApps" in this.target) {
      const apps = this.target.listApps();
      if (apps.length === 1) {
        return apps[0].storage.listStateKeys(
          options?.namespace !== undefined ? options.namespace : null,
          options?.prefix
        );
      }
      const aggregated: string[] = [];
      for (const app of apps) {
        const keys = await app.storage.listStateKeys(
          options?.namespace !== undefined ? options.namespace : null,
          options?.prefix
        );
        for (const k of keys) {
          aggregated.push(`${app.packageId}/${k}`);
        }
      }
      return aggregated;
    }
    const app = this.resolveApp(packageId);
    if (!app) {
      throw new Error(`Package '${packageId}' not found in target`);
    }
    return app.storage.listStateKeys(
      options?.namespace !== undefined ? options.namespace : null,
      options?.prefix
    );
  }

  async clearState(
    packageId: string,
    options?: any
  ): Promise<number> {
    const app = this.resolveApp(packageId);
    if (!app) {
      throw new Error(`Package '${packageId}' not found in target`);
    }
    return app.storage.clearState(options);
  }

  async listStateEntries(
    packageId: string,
    options?: any
  ): Promise<StateEntry[]> {
    const app = this.resolveApp(packageId);
    if (!app) {
      throw new Error(`Package '${packageId}' not found in target`);
    }
    return app.storage.listStateEntries(options);
  }

  async close(): Promise<void> {
    return this.target.close();
  }
}
