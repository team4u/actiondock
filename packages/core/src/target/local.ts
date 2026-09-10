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
import { resolveEnvValue } from "../runtime/env";
import { createGlobalStorage, decodeStateKey, isSecretConfigKey } from "../storage";
import type { RuntimeStorage, StateEntry } from "../storage/types";
import {
  ACTIONDOCK_PROTOCOL_VERSION,
  type ActionDockTarget,
  type ConfigValueView,
  type ListRunsOptions,
  type StateScopeOptions,
  type TargetInfo,
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
    const itemDef = (app as any).projectConfig?.config?.[key];
    const isSecret = isSecretConfigKey(key, itemDef);

    let source: "package" | "global" | "env" | "default" = "default";
    let resolvedVal: unknown = undefined;
    let configured = false;

    const overrides = (app as any).runtimeConfig?.overrides || (app as any).options?.configOverrides;
    if (overrides && (overrides.has ? overrides.has(key) : key in overrides)) {
      source = "package";
      resolvedVal = overrides.get ? overrides.get(key) : overrides[key];
      configured = true;
    } else {
      const storedVal = app.storage.getConfig(key);
      if (storedVal !== undefined) {
        source = "package";
        resolvedVal = storedVal;
        configured = true;
      } else {
        const globalStorage = this.getGlobalStorage();
        let globalVal: unknown = undefined;
        try {
          globalVal = globalStorage?.getConfig(key);
        } catch {
          // 忽略全局存储读取异常
        }
        if (globalVal !== undefined) {
          source = "global";
          resolvedVal = globalVal;
          configured = true;
        } else {
          const envResolved = resolveEnvValue(key, itemDef, app.packageId);
          if (envResolved !== undefined) {
            source = "env";
            resolvedVal = envResolved.value;
            configured = true;
          } else if (itemDef?.default !== undefined) {
            source = "default";
            resolvedVal = itemDef.default;
            configured = false;
          }
        }
      }
    }

    return {
      key,
      configured,
      secret: isSecret,
      source,
      value: isSecret ? undefined : (resolvedVal as JsonValue),
    };
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
    const declared = (app as any).projectConfig?.config || {};
    const stored = app.storage.listConfig();
    const allKeys = Array.from(new Set([...Object.keys(declared), ...Object.keys(stored)]));
    const views: ConfigValueView[] = [];
    for (const key of allKeys) {
      const item = await this.getConfig(packageId, key);
      if (item) {
        views.push(item);
      }
    }
    return views;
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
    const ns = actionId
      ? (options?.namespace ? `${actionId}:${options.namespace}` : actionId)
      : (options?.namespace ?? "");

    if (options?.detail) {
      const entry = await app.storage.findState(key, ns || undefined);
      return entry as unknown as T;
    }
    if (ns) {
      return app.storage.getState<T>(ns, key);
    }
    const entry = await app.storage.findState<T>(key);
    return entry?.value as T | undefined;
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
    const ns = actionId
      ? (options?.namespace ? `${actionId}:${options.namespace}` : actionId)
      : (options?.namespace ?? "");

    if (ns) {
      await app.storage.setState<T>(ns, key, value, options?.ttl);
      return;
    }

    let targetKey = key;
    let targetNs = "";
    try {
      const decoded = decodeStateKey(key);
      targetNs = decoded.namespace;
      targetKey = decoded.key;
    } catch {
      targetNs = "";
    }
    await app.storage.setState<T>(targetNs, targetKey, value, options?.ttl);
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
    const ns = actionId
      ? (options?.namespace ? `${actionId}:${options.namespace}` : actionId)
      : (options?.namespace ?? "");

    if (ns) {
      return app.storage.deleteState(ns, key);
    }
    return app.storage.deleteStateSmart(key);
  }

  async listStateKeys(
    packageId: string,
    actionId: string,
    options?: StateScopeOptions
  ): Promise<string[]> {
    if (!packageId && "listApps" in this.target) {
      const apps = this.target.listApps();
      if (apps.length === 1) {
        const ns = actionId
          ? (options?.namespace ? `${actionId}:${options.namespace}` : actionId)
          : (options?.namespace ?? null);
        return apps[0].storage.listStateKeys(ns, options?.prefix);
      }
      const aggregated: string[] = [];
      for (const app of apps) {
        const ns = actionId
          ? (options?.namespace ? `${actionId}:${options.namespace}` : actionId)
          : (options?.namespace ?? null);
        const keys = await app.storage.listStateKeys(ns, options?.prefix);
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
    const ns = actionId
      ? (options?.namespace ? `${actionId}:${options.namespace}` : actionId)
      : (options?.namespace ?? null);
    return app.storage.listStateKeys(ns, options?.prefix);
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
    const ns = actionId
      ? (options?.namespace ? `${actionId}:${options.namespace}` : actionId)
      : options?.namespace;
    return app.storage.clearState({
      namespace: ns,
      prefix: options?.prefix,
      all: options?.all,
    });
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
