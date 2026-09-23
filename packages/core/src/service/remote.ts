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
} from "../app/types";
import { ActionResolver } from "../catalog/action-resolver";
import { ACTION_CANCELLED, TIMEOUT } from "../errors";
import type {
  CancelResult,
  ExecuteOptions,
  ExecutionTicket,
} from "../execution/types";
import type { RunOptions } from "../invocation/types";
import {
  cancelRemoteRun,
  clearRemoteRuns,
  clearRemoteState,
  deleteRemoteConfig,
  deleteRemoteStateKey,
  executeRemoteAction,
  fetchRemoteActionShow,
  fetchRemoteActions,
  fetchRemoteConfig,
  fetchRemoteInfo,
  fetchRemotePlaybookShow,
  fetchRemotePlaybooks,
  fetchRemoteRun,
  fetchRemoteRuns,
  fetchRemoteStateList,
  getRemoteStateKey,
  setRemoteConfig,
  setRemoteStateKey,
} from "../profile/client";
import { isRemoteStateKeyNotFound, wrapRemoteError } from "./remote-errors";
import { formatTerminalRunResult, pollRunCompletion } from "./remote-polling";
import { streamRemoteEvents } from "./sse-stream";
import { isTerminalRunStatus, type StateEntry } from "../storage/types";
import { CAPABILITY_UNAVAILABLE } from "../errors";
import {
  ACTIONDOCK_PROTOCOL_VERSION,
  PROTOCOL_UNSUPPORTED,
  SERVICE_CLOSED,
  ServiceError,
  type ConfigValueView,
  type ListRunsOptions,
  type RemoteServiceOptions,
  type StateScopeOptions,
} from "./types";
import type {
  ActionDockService,
  ConfigPort,
  ConnectActionDockOptions,
  DiscoveryPort,
  ExecutionPort,
  RunsPort,
  StatePort,
} from "./types";

/**
 * 远程 ActionDockService 端口实现。
 * 封装与远端 ActionDock 服务的 HTTP / SSE 协议交互，
 * 遵循统一的 Service Ports 契约。
 */
export class RemoteActionDockService implements ActionDockService {
  public readonly serverUrl: string;
  public readonly token?: string;
  public readonly timeoutMs?: number;
  public readonly baseTimeoutMs: number;
  public readonly allowInsecureHttp?: boolean;
  public readonly insecure?: boolean;
  public readonly dispatcher?: unknown;
  private isClosed = false;

  public readonly discovery: DiscoveryPort;
  public readonly execution: ExecutionPort;
  public readonly runs: RunsPort;
  public readonly management?: {
    config: ConfigPort;
    state: StatePort;
  };

  constructor(options: ConnectActionDockOptions | RemoteServiceOptions) {
    if (!options.serverUrl) {
      throw new Error("serverUrl is required for RemoteActionDockService");
    }
    this.serverUrl = options.serverUrl;
    this.token = options.token;
    this.timeoutMs = options.timeoutMs;
    this.baseTimeoutMs = options.baseTimeoutMs ?? 60000;
    this.allowInsecureHttp = options.allowInsecureHttp;
    this.insecure = options.insecure;
    this.dispatcher = options.dispatcher;

    const self = this;

    this.discovery = {
      async listPackages(): Promise<PackageInfo[]> {
        self.assertNotClosed();
        let raw: any;
        try {
          raw = await fetchRemoteInfo(self.serverUrl, self.token, {
            allowInsecureHttp: self.allowInsecureHttp,
            insecure: self.insecure,
            dispatcher: self.dispatcher,
          });
        } catch (err: any) {
          wrapRemoteError(err);
        }

        const protocolVersion = (raw && typeof raw === "object" && raw.protocolVersion) || ACTIONDOCK_PROTOCOL_VERSION;
        if (protocolVersion && typeof protocolVersion === "string") {
          const [remoteMajor] = protocolVersion.split(".");
          const [currentMajor] = ACTIONDOCK_PROTOCOL_VERSION.split(".");
          if (remoteMajor !== currentMajor) {
            throw new ServiceError(
              PROTOCOL_UNSUPPORTED,
              `PROTOCOL_UNSUPPORTED: Remote server protocol version '${protocolVersion}' is incompatible with expected '${ACTIONDOCK_PROTOCOL_VERSION}'`
            );
          }
        }

        if (Array.isArray(raw)) {
          return raw;
        }
        if (raw && typeof raw === "object") {
          if (Array.isArray(raw.packages)) {
            return raw.packages;
          }
          if (raw.packages && typeof raw.packages === "object") {
            return Object.values(raw.packages);
          }
        }
        return [];
      },

      async listActions(opts?: ListActionsOptions): Promise<ActionSummary[]> {
        self.assertNotClosed();
        const rawList = await fetchRemoteActions(self.serverUrl, self.token, opts?.query, {
          allowInsecureHttp: self.allowInsecureHttp,
          insecure: self.insecure,
          dispatcher: self.dispatcher,
        });
        let summaries: ActionSummary[] = rawList.map((item: any) => ({
          id: item.id,
          description: item.description,
          tags: item.tags,
          inputSchema: item.inputSchema,
          outputSchema: item.outputSchema,
          packageId: item.packageId,
        }));

        if (opts?.prefix) {
          summaries = summaries.filter((s) => s.id.startsWith(opts.prefix!));
        }
        if (opts?.tags && opts.tags.length > 0) {
          summaries = summaries.filter((s) =>
            opts.tags!.every((t) => s.tags?.includes(t))
          );
        }
        return summaries;
      },

      async describeAction(ref: ActionRef | string): Promise<ActionSpec> {
        self.assertNotClosed();
        let parsed: ActionRef;
        try {
          parsed = ActionResolver.parseRef(ref);
        } catch {
          parsed = typeof ref === "object" ? ref : { actionId: ref };
        }

        const actionId = parsed.packageId
          ? `${parsed.packageId}/${parsed.actionId}`
          : parsed.actionId;
        const raw = await fetchRemoteActionShow(self.serverUrl, actionId, self.token, {
          allowInsecureHttp: self.allowInsecureHttp,
          insecure: self.insecure,
          dispatcher: self.dispatcher,
        });

        return {
          id: raw.id,
          description: raw.description,
          inputSchema: raw.inputSchema,
          outputSchema: raw.outputSchema,
          tags: raw.tags,
          annotations: raw.annotations,
          uses: raw.uses,
          entry: raw.entry,
          filePath: raw.filePath,
          packageId: raw.packageId ?? parsed.packageId,
        };
      },

      async listPlaybooks(opts?: { intent?: string; package?: string }): Promise<PlaybookSummary[]> {
        self.assertNotClosed();
        const rawList = await fetchRemotePlaybooks(self.serverUrl, self.token, {
          ...opts,
          allowInsecureHttp: self.allowInsecureHttp,
          insecure: self.insecure,
          dispatcher: self.dispatcher,
        });
        return rawList.map((item: any) => ({
          id: item.id,
          description: item.description,
          actions: item.actions,
          packageId: item.packageId,
          filePath: item.filePath,
        }));
      },

      async describePlaybook(id: string): Promise<PlaybookSpec> {
        self.assertNotClosed();
        const raw = await fetchRemotePlaybookShow(self.serverUrl, id, self.token, {
          allowInsecureHttp: self.allowInsecureHttp,
          insecure: self.insecure,
          dispatcher: self.dispatcher,
        });
        const parsedPkgId = id.includes("/") ? id.slice(0, id.lastIndexOf("/")) : undefined;
        return {
          id: raw.id,
          description: raw.description,
          actions: raw.actions,
          filePath: raw.filePath,
          content: raw.content,
          packageId: raw.packageId ?? parsedPkgId,
        };
      },
    };

    this.execution = {
      async run(
        ref: ActionRef,
        input?: unknown,
        opts?: RunOptions
      ): Promise<ExecutionResult> {
        self.assertNotClosed();
        let parsed: ActionRef;
        try {
          parsed = ActionResolver.parseRef(ref);
        } catch {
          parsed = typeof ref === "object" ? ref : { actionId: String(ref) };
        }

        const actionId = parsed.packageId
          ? `${parsed.packageId}/${parsed.actionId}`
          : parsed.actionId;

        return executeRemoteAction(
          self.serverUrl,
          actionId,
          (input ?? {}) as JsonValue,
          {
            configOverrides: opts?.config,
            token: self.token,
            timeoutMs: opts?.timeoutMs ?? self.timeoutMs,
            signal: opts?.signal,
            requestId: opts?.requestId,
            async: false,
            allowInsecureHttp: self.allowInsecureHttp,
            insecure: self.insecure,
            dispatcher: self.dispatcher,
          }
        );
      },

      async start(
        ref: ActionRef,
        input?: unknown,
        opts?: RunOptions
      ): Promise<ExecutionTicket> {
        self.assertNotClosed();
        let parsed: ActionRef;
        try {
          parsed = ActionResolver.parseRef(ref);
        } catch {
          parsed = typeof ref === "object" ? ref : { actionId: String(ref) };
        }

        const actionId = parsed.packageId
          ? `${parsed.packageId}/${parsed.actionId}`
          : parsed.actionId;

        const res = await executeRemoteAction(
          self.serverUrl,
          actionId,
          (input ?? {}) as JsonValue,
          {
            configOverrides: opts?.config,
            token: self.token,
            timeoutMs: opts?.timeoutMs ?? self.timeoutMs,
            signal: opts?.signal,
            requestId: opts?.requestId,
            async: true,
            allowInsecureHttp: self.allowInsecureHttp,
            insecure: self.insecure,
            dispatcher: self.dispatcher,
          }
        );

        if (!res.ok) {
          return {
            runId: res.runId,
            status: "failed",
            result: Promise.resolve(res),
          };
        }

        const runId = (res as any).runId || (res.data as any)?.runId;
        const status = (res as any).status || (res.data as any)?.status || "running";

        return {
          runId,
          status,
          result: self.waitForRunCompletion(runId, opts?.signal, opts?.timeoutMs),
        };
      },
    };

    this.runs = {
      async list(query?: ListRunsOptions): Promise<RunRecord[]> {
        self.assertNotClosed();
        try {
          const res = await fetchRemoteRuns(self.serverUrl, self.token, {
            packageId: query?.packageId,
            actionId: query?.actionId,
            status: query?.status,
            intent: query?.intent,
            limit: query?.limit,
            allowInsecureHttp: self.allowInsecureHttp,
            insecure: self.insecure,
            dispatcher: self.dispatcher,
          });
          return res.items || [];
        } catch (err: any) {
          wrapRemoteError(err);
        }
      },

      async get(runId: string): Promise<RunRecord | undefined> {
        self.assertNotClosed();
        try {
          return await fetchRemoteRun(self.serverUrl, runId, self.token, {
            allowInsecureHttp: self.allowInsecureHttp,
            insecure: self.insecure,
            dispatcher: self.dispatcher,
          });
        } catch (err: any) {
          const code = String(err?.code || "");
          if (code === "RUN_NOT_FOUND" || code === "NOT_FOUND" || err?.status === 404) {
            return undefined;
          }
          throw err;
        }
      },

      async cancel(runId: string, reason?: string): Promise<CancelResult> {
        self.assertNotClosed();
        try {
          const res = await cancelRemoteRun(self.serverUrl, runId, self.token, reason, {
            allowInsecureHttp: self.allowInsecureHttp,
            insecure: self.insecure,
            dispatcher: self.dispatcher,
          });
          return { outcome: "requested", runId: res.runId };
        } catch (err: any) {
          const code = String(err?.code || "");
          if (code === "RUN_ALREADY_FINISHED") {
            let status = (err as any)?.errorData?.status || (err as any)?.details?.status;
            if (!status) {
              try {
                const run = await self.runs.get(runId);
                if (run?.status) {
                  status = run.status;
                }
              } catch {}
            }
            return { outcome: "already_terminal", runId, status: (status as any) || "failed" };
          }
          if (code === "RUN_NOT_FOUND" || code === "NOT_FOUND" || err?.status === 404) {
            return { outcome: "not_found", runId };
          }
          throw err;
        }
      },

      events(
        runId: string,
        opts?: { after?: number | string; signal?: AbortSignal; maxQueueSize?: number }
      ): AsyncIterable<ExecutionEvent> {
        self.assertNotClosed();
        async function* stream(): AsyncIterable<ExecutionEvent> {
          self.assertNotClosed();
          for await (const event of streamRemoteEvents(self.serverUrl, runId, self.token, {
            ...opts,
            allowInsecureHttp: self.allowInsecureHttp,
            insecure: self.insecure,
            dispatcher: self.dispatcher,
          })) {
            self.assertNotClosed();
            yield event;
          }
        }
        return stream();
      },

      async clear(opts?: { packageId?: string; actionId?: string; status?: string }): Promise<number> {
        self.assertNotClosed();
        try {
          const res = await clearRemoteRuns(self.serverUrl, self.token, {
            ...opts,
            allowInsecureHttp: self.allowInsecureHttp,
            insecure: self.insecure,
            dispatcher: self.dispatcher,
          });
          return res.clearedCount ?? 0;
        } catch (err: any) {
          wrapRemoteError(err);
        }
      },
    };

    if (options?.enableManagement !== false) {
      this.management = {
        config: {
          async get(packageId: string, key: string): Promise<ConfigValueView> {
            self.assertNotClosed();
            try {
              const list = await self.management!.config.list(packageId);
              const found = list.find((c) => c.key === key);
              if (found) {
                return found;
              }
              return {
                key,
                configured: false,
                secret: false,
                source: "default",
                value: undefined,
              };
            } catch (err: any) {
              wrapRemoteError(err);
            }
          },

          async set(packageId: string, key: string, value: JsonValue): Promise<void> {
            self.assertNotClosed();
            try {
              await setRemoteConfig(self.serverUrl, key, value, self.token, packageId || undefined, {
                allowInsecureHttp: self.allowInsecureHttp,
                insecure: self.insecure,
                dispatcher: self.dispatcher,
              });
            } catch (err: any) {
              wrapRemoteError(err);
            }
          },

          async delete(packageId: string, key: string): Promise<boolean> {
            self.assertNotClosed();
            try {
              const res = await deleteRemoteConfig(self.serverUrl, key, self.token, packageId || undefined, {
                allowInsecureHttp: self.allowInsecureHttp,
                insecure: self.insecure,
                dispatcher: self.dispatcher,
              });
              return Boolean(res?.deleted ?? true);
            } catch (err: any) {
              wrapRemoteError(err);
            }
          },

          async list(packageId: string): Promise<ConfigValueView[]> {
            self.assertNotClosed();
            try {
              const res = await fetchRemoteConfig(self.serverUrl, self.token, packageId || undefined, {
                allowInsecureHttp: self.allowInsecureHttp,
                insecure: self.insecure,
                dispatcher: self.dispatcher,
              });
              if (Array.isArray(res)) return res;
              if (Array.isArray(res?.items)) return res.items;
              if (Array.isArray(res?.config)) return res.config;
              const values = res?.values || {};
              const declared = res?.declared || {};
              const defaultSource: "global" | "package" = packageId === "global" ? "global" : "package";
              return Object.entries(values).map(([k, v]) => ({
                key: k,
                configured: v !== undefined,
                secret: Boolean(declared[k]?.secret),
                source: defaultSource,
                value: v as JsonValue,
              }));
            } catch (err: any) {
              wrapRemoteError(err);
            }
          },
        },

        state: {
          async get<T extends JsonValue = JsonValue>(
            packageId: string,
            actionId: string,
            key: string,
            opts?: StateScopeOptions
          ): Promise<T | undefined> {
            self.assertNotClosed();
            try {
              const res = await getRemoteStateKey(self.serverUrl, key, self.token, {
                package: packageId || undefined,
                action: actionId || undefined,
                namespace: opts?.namespace,
                allowInsecureHttp: self.allowInsecureHttp,
                insecure: self.insecure,
                dispatcher: self.dispatcher,
              });
              if (res === undefined) return undefined;
              if (opts?.detail) {
                return res as T;
              }
              return (res?.value !== undefined ? res.value : res) as T;
            } catch (err: any) {
              if (isRemoteStateKeyNotFound(err)) {
                return undefined;
              }
              wrapRemoteError(err);
            }
          },

          async set<T extends JsonValue = JsonValue>(
            packageId: string,
            actionId: string,
            key: string,
            value: T,
            opts?: StateScopeOptions
          ): Promise<void> {
            self.assertNotClosed();
            try {
              await setRemoteStateKey(self.serverUrl, key, value, self.token, {
                package: packageId || undefined,
                action: actionId || undefined,
                namespace: opts?.namespace,
                ttl: opts?.ttl,
                allowInsecureHttp: self.allowInsecureHttp,
                insecure: self.insecure,
                dispatcher: self.dispatcher,
              });
            } catch (err: any) {
              wrapRemoteError(err);
            }
          },

          async delete(
            packageId: string,
            actionId: string,
            key: string,
            opts?: StateScopeOptions
          ): Promise<boolean> {
            self.assertNotClosed();
            try {
              const res = await deleteRemoteStateKey(self.serverUrl, key, self.token, {
                package: packageId || undefined,
                action: actionId || undefined,
                namespace: opts?.namespace,
                allowInsecureHttp: self.allowInsecureHttp,
                insecure: self.insecure,
                dispatcher: self.dispatcher,
              });
              return Boolean(res?.deleted ?? true);
            } catch (err: any) {
              if (isRemoteStateKeyNotFound(err)) {
                return false;
              }
              wrapRemoteError(err);
            }
          },

          async list(
            packageId: string,
            actionId: string,
            opts?: StateScopeOptions
          ): Promise<string[]> {
            self.assertNotClosed();
            try {
              const res = await fetchRemoteStateList(self.serverUrl, self.token, {
                package: packageId || undefined,
                action: actionId || undefined,
                namespace: opts?.namespace,
                prefix: opts?.prefix,
                allowInsecureHttp: self.allowInsecureHttp,
                insecure: self.insecure,
                dispatcher: self.dispatcher,
              });
              return res.keys || [];
            } catch (err: any) {
              wrapRemoteError(err);
            }
          },

          async clear(
            packageId: string,
            actionId: string,
            opts?: StateScopeOptions
          ): Promise<number> {
            self.assertNotClosed();
            try {
              const res = await clearRemoteState(self.serverUrl, self.token, {
                package: packageId || undefined,
                action: actionId || undefined,
                namespace: opts?.namespace,
                prefix: opts?.prefix,
                all: opts?.all,
                allowInsecureHttp: self.allowInsecureHttp,
                insecure: self.insecure,
                dispatcher: self.dispatcher,
              });
              return res.clearedCount ?? 0;
            } catch (err: any) {
              wrapRemoteError(err);
            }
          },

          async listEntries(
            _packageId: string,
            _opts?: any
          ): Promise<StateEntry[]> {
            self.assertNotClosed();
            throw new ServiceError(
              CAPABILITY_UNAVAILABLE,
              "CAPABILITY_UNAVAILABLE: listStateEntries is not supported on remote service"
            );
          },
        },
      };
    }
  }

  private assertNotClosed(): void {
    if (this.isClosed) {
      throw new ServiceError(
        SERVICE_CLOSED,
        "RemoteActionDockService is closed"
      );
    }
  }

  async info(): Promise<PackageInfo[]> {
    return this.discovery.listPackages();
  }

  private async waitForRunCompletion(
    runId: string,
    signal?: AbortSignal,
    timeoutMs?: number
  ): Promise<ExecutionResult> {
    const startTime = Date.now();
    const maxWaitMs = Math.max(this.baseTimeoutMs, timeoutMs ?? 0);

    if (signal?.aborted) {
      return {
        ok: false,
        runId,
        error: {
          code: ACTION_CANCELLED,
          message: "Action execution was cancelled",
        },
      };
    }

    if (this.isClosed) {
      return {
        ok: false,
        runId,
        error: {
          code: SERVICE_CLOSED,
          message: "RemoteActionDockService is closed",
        },
      };
    }

    const internalController = new AbortController();
    let sseTimedOut = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    if (maxWaitMs > 0 && maxWaitMs !== Infinity) {
      timer = setTimeout(() => {
        sseTimedOut = true;
        internalController.abort();
      }, maxWaitMs);
    }

    const onAbort = () => {
      internalController.abort();
    };
    if (signal) {
      signal.addEventListener("abort", onAbort, { once: true });
    }

    try {
      for await (const evt of this.runs.events(runId, { signal: internalController.signal })) {
        if (evt.type === "finish") {
          const res = (evt as any).result || (evt as any).data || evt;
          if (typeof res?.ok === "boolean") {
            return res;
          }
        }
      }
    } catch (err: any) {
      if (err?.code === SERVICE_CLOSED || this.isClosed) {
        return {
          ok: false,
          runId,
          error: {
            code: SERVICE_CLOSED,
            message: "RemoteActionDockService is closed",
          },
        };
      }
      if (!signal?.aborted && !sseTimedOut) {
        console.warn(
          `[ActionDock] SSE event stream unavailable for run '${runId}', falling back to polling: ${err?.message || String(err)}`
        );
      }
    } finally {
      if (timer) {
        clearTimeout(timer);
      }
      if (signal) {
        signal.removeEventListener("abort", onAbort);
      }
    }

    if (signal?.aborted) {
      return {
        ok: false,
        runId,
        error: {
          code: ACTION_CANCELLED,
          message: "Action execution was cancelled",
        },
      };
    }

    const remainingWaitMs = Math.max(0, maxWaitMs - (Date.now() - startTime));
    if (remainingWaitMs <= 0) {
      if (this.isClosed) {
        return {
          ok: false,
          runId,
          error: {
            code: SERVICE_CLOSED,
            message: "RemoteActionDockService is closed",
          },
        };
      }
      try {
        const run = await this.runs.get(runId);
        if (run && isTerminalRunStatus(run.status)) {
          return formatTerminalRunResult(run, runId);
        }
      } catch (err: any) {
        if (err?.code === SERVICE_CLOSED || this.isClosed) {
          return {
            ok: false,
            runId,
            error: {
              code: SERVICE_CLOSED,
              message: "RemoteActionDockService is closed",
            },
          };
        }
        throw err;
      }
      const waitedMs = Date.now() - startTime;
      return {
        ok: false,
        runId,
        error: {
          code: TIMEOUT,
          message: `Timed out waiting for run '${runId}' completion after ${waitedMs}ms`,
        },
      };
    }

    return pollRunCompletion(
      {
        baseTimeoutMs: this.baseTimeoutMs,
        isClosed: () => this.isClosed,
        getRun: (id) => this.runs.get(id),
      },
      runId,
      signal,
      remainingWaitMs,
      startTime,
      maxWaitMs
    );
  }

  async close(_options?: { timeoutMs?: number; graceMs?: number }): Promise<void> {
    if (this.isClosed) {
      return;
    }
    this.isClosed = true;
  }
}
