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
import { filterByIntent } from "../filter";
import type { ActionDockHost } from "../host/types";
import type { ConfigItemDefinition } from "../project/types";
import { createGlobalStorage, isSecretConfigKey } from "../storage";
import type { RuntimeStorage, StateEntry } from "../storage/types";
import {
  CloseTimeoutError,
  TARGET_CAPABILITY_UNAVAILABLE,
  TargetError,
  type ConfigValueView,
  type ListRunsOptions,
  type StateScopeOptions,
} from "../target/types";
import type {
  ActionDockService,
  ConfigPort,
  DiscoveryPort,
  ExecutionPort,
  RunsPort,
  StatePort,
} from "./types";

/**
 * 本地 ActionDockService 实现。
 * 基于本地 ActionDockHost 或 ActionDockApp 提供结构化领域服务端口，
 * 严禁暴露 unwrap 穿透到内部领域对象。
 */
export class LocalActionDockService implements ActionDockService {
  protected readonly target: ActionDockHost | ActionDockApp;
  private fallbackGlobalStorage?: RuntimeStorage;

  public readonly discovery: DiscoveryPort;
  public readonly execution: ExecutionPort;
  public readonly runs: RunsPort;
  public readonly management?: {
    config: ConfigPort;
    state: StatePort;
  };

  constructor(
    target: ActionDockHost | ActionDockApp,
    options?: { enableManagement?: boolean }
  ) {
    this.target = target;

    const self = this;

    this.discovery = {
      async listPackages(): Promise<PackageInfo[]> {
        if ("listApps" in self.target) {
          const apps = self.target.listApps();
          return Promise.all(apps.map((app) => app.info()));
        }
        return [await self.target.info()];
      },

      async listActions(opts?: ListActionsOptions): Promise<ActionSummary[]> {
        return self.target.listActions(opts);
      },

      async describeAction(ref: ActionRef | string): Promise<ActionSpec> {
        if ("getApp" in self.target) {
          return self.target.describeAction(ref);
        }
        const actionId = typeof ref === "string" ? ref : ref.actionId;
        return self.target.describeAction(actionId);
      },

      async listPlaybooks(opts?: { intent?: string; package?: string }): Promise<PlaybookSummary[]> {
        let pbs = await self.target.listPlaybooks();
        if (opts?.package) {
          pbs = pbs.filter((p) => p.packageId === opts.package);
        }
        if (opts?.intent) {
          pbs = filterByIntent(
            pbs,
            opts.intent,
            [(p) => p.id, (p) => p.description || "", (p) => p.packageId || "", (p) => (p.actions || []).join(" ")],
            false
          );
        }
        return pbs;
      },

      async describePlaybook(id: string): Promise<PlaybookSpec> {
        return self.target.describePlaybook(id);
      },
    };

    this.execution = {
      async run(
        ref: ActionRef | string,
        input: JsonValue,
        opts?: ExecuteOptions
      ): Promise<ExecutionResult> {
        if ("listApps" in self.target) {
          return (self.target as ActionDockHost).runAction(ref, input, opts);
        }
        const actionId = typeof ref === "string" ? (ref.includes(":") ? ref.split(":").pop()! : ref) : ref.actionId;
        return (self.target as ActionDockApp).runAction(actionId, input, opts);
      },

      async start(
        ref: ActionRef | string,
        input: JsonValue,
        opts?: ExecuteOptions
      ): Promise<ExecutionTicket> {
        if ("listApps" in self.target) {
          return (self.target as ActionDockHost).startAction(ref, input, opts);
        }
        const actionId = typeof ref === "string" ? (ref.includes(":") ? ref.split(":").pop()! : ref) : ref.actionId;
        return (self.target as ActionDockApp).startAction(actionId, input, opts);
      },
    };

    this.runs = {
      async list(query?: ListRunsOptions): Promise<RunRecord[]> {
        if ("listApps" in self.target) {
          const apps = query?.packageId
            ? [self.target.getApp(query.packageId)].filter(Boolean) as ActionDockApp[]
            : self.target.listApps();
          const records: RunRecord[] = [];
          for (const app of apps) {
            const recs = app.storage.listRuns({
              actionId: query?.actionId,
              status: query?.status,
              limit: query?.limit,
            });
            for (const r of recs) {
              records.push({
                ...r,
                packageId: (r as any).packageId || app.packageId,
              });
            }
          }
          records.sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime());
          let result = records;
          if (query?.intent) {
            result = filterByIntent(
              result,
              query.intent,
              [(r) => r.id, (r) => r.actionId, (r) => r.status, (r) => r.packageId],
              false
            );
          }
          if (query?.limit && result.length > query.limit) {
            result.length = query.limit;
          }
          return result;
        }

        if (query?.packageId && query.packageId !== self.target.packageId) {
          return [];
        }
        let records = self.target.storage.listRuns({
          actionId: query?.actionId,
          status: query?.status,
          limit: query?.limit,
        });
        if (query?.intent) {
          records = filterByIntent(
            records,
            query.intent,
            [(r) => r.id, (r) => r.actionId, (r) => r.status, (r) => r.packageId],
            false
          );
        }
        return records;
      },

      async get(runId: string): Promise<RunRecord | undefined> {
        return self.target.getRun(runId);
      },

      async cancel(runId: string, reason?: string): Promise<CancelResult> {
        return self.target.cancelRun(runId, reason);
      },

      events(
        runId: string,
        opts?: { after?: number | string; signal?: AbortSignal; maxQueueSize?: number }
      ): AsyncIterable<ExecutionEvent> {
        return self.target.events(runId, opts);
      },

      async clear(opts?: { packageId?: string; actionId?: string; status?: string }): Promise<number> {
        if ("listApps" in self.target) {
          const apps = opts?.packageId
            ? [self.target.getApp(opts.packageId)].filter(Boolean) as ActionDockApp[]
            : self.target.listApps();
          let total = 0;
          for (const app of apps) {
            total += app.storage.clearRuns({
              actionId: opts?.actionId,
              status: opts?.status,
            });
          }
          return total;
        }

        if (opts?.packageId && opts.packageId !== self.target.packageId) {
          return 0;
        }
        return self.target.storage.clearRuns({
          actionId: opts?.actionId,
          status: opts?.status,
        });
      },
    };

    if (options?.enableManagement !== false) {
      this.management = {
        config: {
          async get(packageId: string, key: string): Promise<ConfigValueView> {
            if (packageId === "global") {
              const globalStorage = self.getGlobalStorage();
              const val = globalStorage.getConfig(key);
              const configured = val !== undefined;
              const declaredItem = self.findDeclaredConfigItem(key);
              const isSecret = isSecretConfigKey(key, declaredItem);
              return {
                key,
                configured,
                secret: isSecret,
                source: configured ? "global" : "default",
                value: !isSecret && configured ? (val as JsonValue) : undefined,
              };
            }
            const app = self.resolveApp(packageId);
            if (!app) {
              throw new Error(`Package '${packageId}' not found in service`);
            }
            return app.getConfig(key);
          },

          async set(packageId: string, key: string, value: JsonValue): Promise<void> {
            if (packageId === "global") {
              await self.getGlobalStorage().setConfig(key, value);
              return;
            }
            const app = self.resolveApp(packageId);
            if (!app) {
              throw new Error(`Package '${packageId}' not found in service`);
            }
            await app.setConfig(key, value);
          },

          async delete(packageId: string, key: string): Promise<boolean> {
            if (packageId === "global") {
              return await self.getGlobalStorage().deleteConfig(key);
            }
            const app = self.resolveApp(packageId);
            if (!app) {
              throw new Error(`Package '${packageId}' not found in service`);
            }
            return await app.deleteConfig(key);
          },

          async list(packageId: string): Promise<ConfigValueView[]> {
            if (packageId === "global") {
              const globalStorage = self.getGlobalStorage();
              const all = globalStorage.listConfig();
              return Object.entries(all).map(([key, val]) => {
                const declaredItem = self.findDeclaredConfigItem(key);
                const isSecret = isSecretConfigKey(key, declaredItem);
                return {
                  key,
                  configured: true,
                  secret: isSecret,
                  source: "global",
                  value: isSecret ? undefined : (val as JsonValue),
                };
              });
            }
            const app = self.resolveApp(packageId);
            if (!app) {
              throw new Error(`Package '${packageId}' not found in service`);
            }
            return app.listConfig();
          },
        },

        state: {
          async get<T extends JsonValue = JsonValue>(
            packageId: string,
            actionId: string,
            key: string,
            opts?: StateScopeOptions
          ): Promise<T | undefined> {
            const app = self.resolveApp(packageId);
            if (!app) {
              throw new Error(`Package '${packageId}' not found in service`);
            }
            return app.getState<T>(actionId, key, opts);
          },

          async set<T extends JsonValue = JsonValue>(
            packageId: string,
            actionId: string,
            key: string,
            value: T,
            opts?: StateScopeOptions
          ): Promise<void> {
            const app = self.resolveApp(packageId);
            if (!app) {
              throw new Error(`Package '${packageId}' not found in service`);
            }
            if (actionId) {
              await app.setActionState<T>(actionId, key, value, opts);
            } else {
              await app.setState<T>(key, value, opts);
            }
          },

          async delete(
            packageId: string,
            actionId: string,
            key: string,
            opts?: StateScopeOptions
          ): Promise<boolean> {
            const app = self.resolveApp(packageId);
            if (!app) {
              throw new Error(`Package '${packageId}' not found in service`);
            }
            return app.deleteState(actionId, key, opts);
          },

          async list(
            packageId: string,
            actionId: string,
            opts?: StateScopeOptions
          ): Promise<string[]> {
            const app = self.resolveApp(packageId);
            if (!app) {
              throw new Error(`Package '${packageId}' not found in service`);
            }
            return app.listStateKeys(actionId, opts);
          },

          async clear(
            packageId: string,
            actionId: string,
            opts?: StateScopeOptions
          ): Promise<number> {
            const app = self.resolveApp(packageId);
            if (!app) {
              throw new Error(`Package '${packageId}' not found in service`);
            }
            return app.clearState(actionId, opts);
          },

          async listEntries(
            packageId: string,
            opts?: any
          ): Promise<StateEntry[]> {
            const app = self.resolveApp(packageId);
            if (!app) {
              throw new TargetError(
                TARGET_CAPABILITY_UNAVAILABLE,
                `TARGET_CAPABILITY_UNAVAILABLE: Package '${packageId}' not found in service`
              );
            }
            if (!app.storage || typeof (app.storage as any).listStateEntries !== "function") {
              throw new TargetError(
                TARGET_CAPABILITY_UNAVAILABLE,
                `TARGET_CAPABILITY_UNAVAILABLE: listStateEntries is not supported by package '${packageId}' storage`
              );
            }
            return app.storage.listStateEntries(opts);
          },
        },
      };
    }
  }

  async info(): Promise<PackageInfo[]> {
    return this.discovery.listPackages();
  }

  private resolveApp(packageId?: string): ActionDockApp | undefined {
    if ("listApps" in this.target) {
      if (packageId) {
        return this.target.getApp(packageId);
      }
      const apps = this.target.listApps();
      return apps.length === 1 ? apps[0] : undefined;
    }
    if (!packageId || packageId === this.target.packageId) {
      return this.target;
    }
    return undefined;
  }

  private getGlobalStorage(): RuntimeStorage {
    if ("globalStorage" in this.target && (this.target as any).globalStorage) {
      return (this.target as any).globalStorage;
    }
    const apps = "listApps" in this.target ? (this.target as any).listApps() : [];
    for (const app of apps) {
      if (app.globalStorage) return app.globalStorage;
    }
    if (!this.fallbackGlobalStorage) {
      this.fallbackGlobalStorage = createGlobalStorage({
        dataDir: (this.target as any).options?.dataDir,
        customHome: (this.target as any).options?.customHome,
      });
    }
    return this.fallbackGlobalStorage;
  }

  private findDeclaredConfigItem(key: string): ConfigItemDefinition | undefined {
    if ("listApps" in this.target) {
      let foundItem: ConfigItemDefinition | undefined;
      for (const app of (this.target as ActionDockHost).listApps()) {
        const item = app.projectConfig?.config?.[key];
        if (item) {
          if (item.secret) return item;
          foundItem = item;
        }
      }
      return foundItem;
    }
    if ("projectConfig" in this.target) {
      return (this.target as ActionDockApp).projectConfig?.config?.[key];
    }
    return undefined;
  }

  async close(options?: { timeoutMs?: number; graceMs?: number }): Promise<void> {
    try {
      this.fallbackGlobalStorage?.close();
    } catch {
      // 忽略兜底全局存储关闭异常
    }
    this.fallbackGlobalStorage = undefined;

    const timeout = options?.timeoutMs ?? options?.graceMs;
    if (timeout && timeout > 0) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const timeoutPromise = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          reject(new CloseTimeoutError(`Service close operation timed out after ${timeout}ms`));
        }, timeout);
      });
      try {
        await Promise.race([this.target.close(options), timeoutPromise]);
      } finally {
        if (timer) clearTimeout(timer);
      }
      return;
    }
    return this.target.close(options);
  }
}
