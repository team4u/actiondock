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
import type {
  CancelResult,
  ExecuteOptions,
  ExecutionTicket,
} from "../execution/types";
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
import { normalizeServerUrl } from "../profile/manager";
import type { StateEntry } from "../storage/types";
import {
  ACTIONDOCK_PROTOCOL_VERSION,
  type ActionDockTarget,
  type ConfigValueView,
  type ListRunsOptions,
  type RemoteTargetOptions,
  type StateScopeOptions,
  type TargetInfo,
  TargetError,
  CloseTimeoutError,
  TARGET_PROTOCOL_UNSUPPORTED,
  TARGET_CAPABILITY_UNAVAILABLE,
  TARGET_RESULT_UNKNOWN,
} from "./types";

/**
 * 读取并解析远端 SSE 事件流。
 */
export async function* streamRemoteEvents(
  serverUrl: string,
  runId: string,
  token?: string,
  options?: { after?: number | string; signal?: AbortSignal; maxQueueSize?: number }
): AsyncIterable<ExecutionEvent> {
  const base = normalizeServerUrl(serverUrl);
  const candidateUrls = [
    `${base}/api/v2/runs/${encodeURIComponent(runId)}/events`,
    `${base}/api/v2/runs/${encodeURIComponent(runId)}/stream`,
    `${base}/api/v1/runs/${encodeURIComponent(runId)}/stream`,
  ];
  const headers: Record<string, string> = {
    Accept: "text/event-stream",
  };
  if (token && token.trim()) {
    headers.Authorization = `Bearer ${token.trim()}`;
  }
  if (options?.after !== undefined) {
    headers["Last-Event-ID"] = String(options.after);
  }

  let res: Response | undefined;
  for (const url of candidateUrls) {
    try {
      const resp = await fetch(url, {
        headers,
        signal: options?.signal,
      });
      if (resp.status === 410) {
        let errJson: any;
        try {
          errJson = await resp.json();
        } catch {}
        const err = new Error(errJson?.error?.message || "Event cursor has expired");
        (err as any).code = errJson?.error?.code || "EVENT_CURSOR_EXPIRED";
        (err as any).details = errJson?.error?.details;
        throw err;
      }
      if (resp.ok && resp.body) {
        res = resp;
        break;
      }
      if (resp.status !== 404) {
        res = resp;
        break;
      }
    } catch (err: any) {
      if (err?.code === "EVENT_CURSOR_EXPIRED") {
        throw err;
      }
      // 忽略单次网络连接异常并尝试备选路由
    }
  }

  if (!res || !res.ok || !res.body) {
    return;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      if (options?.signal?.aborted) break;
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const parts = buffer.split("\n\n");
      buffer = parts.pop() || "";

      for (const part of parts) {
        if (!part.trim()) continue;
        let eventType = "message";
        let eventId: string | undefined;
        let dataStr = "";
        for (const line of part.split("\n")) {
          if (line.startsWith("event:")) {
            eventType = line.slice(6).trim();
          } else if (line.startsWith("id:")) {
            eventId = line.slice(3).trim();
          } else if (line.startsWith("data:")) {
            dataStr += line.slice(5).trim();
          }
        }
        if (dataStr) {
          try {
            const data = JSON.parse(dataStr);
            if (eventType === "finish") {
              yield {
                eventId: eventId ?? data.eventId,
                type: "finish",
                runId,
                timestamp: new Date().toISOString(),
                result: data.result || data,
              } as ExecutionEvent;
            } else {
              yield {
                eventId: eventId ?? data.eventId,
                type: eventType as any,
                runId,
                timestamp: new Date().toISOString(),
                ...data,
              } as ExecutionEvent;
            }
          } catch {
            // 忽略非 JSON 数据行
          }
        }
      }
    }
  } catch (err: any) {
    if (err.name === "AbortError" || options?.signal?.aborted) {
      return;
    }
    throw err;
  } finally {
    try {
      reader.releaseLock();
    } catch {}
  }
}

/**
 * 远程 ActionDockTarget 门面实现。
 * 内部封装基于 HTTP/SSE 协议与远端 ActionDock 服务端的通信管道。
 */
export class RemoteActionDockTarget implements ActionDockTarget {
  public readonly serverUrl: string;
  public readonly token?: string;
  public readonly timeoutMs?: number;

  constructor(options: RemoteTargetOptions) {
    this.serverUrl = options.serverUrl;
    this.token = options.token;
    this.timeoutMs = options.timeoutMs;
  }

  async info(): Promise<TargetInfo> {
    let raw: any;
    try {
      raw = await fetchRemoteInfo(this.serverUrl, this.token);
    } catch (err: any) {
      wrapRemoteError(err);
    }

    const protocolVersion = (raw && typeof raw === "object" && raw.protocolVersion) || ACTIONDOCK_PROTOCOL_VERSION;
    if (protocolVersion && typeof protocolVersion === "string") {
      const [remoteMajor] = protocolVersion.split(".");
      const [currentMajor] = ACTIONDOCK_PROTOCOL_VERSION.split(".");
      if (remoteMajor !== currentMajor) {
        throw new TargetError(
          TARGET_PROTOCOL_UNSUPPORTED,
          `TARGET_PROTOCOL_UNSUPPORTED: Remote server protocol version '${protocolVersion}' is incompatible with expected '${ACTIONDOCK_PROTOCOL_VERSION}'`
        );
      }
    }

    let packages: PackageInfo[] = [];
    if (Array.isArray(raw)) {
      packages = raw;
    } else if (raw && typeof raw === "object") {
      if (Array.isArray(raw.packages)) {
        packages = raw.packages;
      } else if (raw.packages && typeof raw.packages === "object") {
        packages = Object.values(raw.packages);
      }
    }
    return {
      id: (raw && typeof raw === "object" && raw.id) || "remote-target",
      name: (raw && typeof raw === "object" && raw.name) || "Remote ActionDock Server",
      protocolVersion,
      packages,
      capabilities: (raw && typeof raw === "object" && Array.isArray(raw.capabilities))
        ? raw.capabilities
        : ["actions", "playbooks", "runs", "events", "management.config", "management.state"],
      idempotencyPolicy: raw && typeof raw === "object" ? raw.idempotencyPolicy : undefined,
    };
  }

  async listPackages(): Promise<PackageInfo[]> {
    const info = await this.info();
    return info.packages;
  }

  async listActions(options?: ListActionsOptions): Promise<ActionSummary[]> {
    const rawList = await fetchRemoteActions(this.serverUrl, this.token, options?.query);
    let summaries: ActionSummary[] = rawList.map((item: any) => ({
      id: item.id,
      description: item.description,
      tags: item.tags,
      inputSchema: item.inputSchema,
      outputSchema: item.outputSchema,
      packageId: item.packageId,
    }));

    if (options?.prefix) {
      summaries = summaries.filter((s) => s.id.startsWith(options.prefix!));
    }
    if (options?.tags && options.tags.length > 0) {
      summaries = summaries.filter((s) =>
        options.tags!.every((t) => s.tags?.includes(t))
      );
    }
    return summaries;
  }

  async describeAction(ref: ActionRef | string): Promise<ActionSpec> {
    let parsed: ActionRef;
    try {
      parsed = ActionResolver.parseRef(ref);
    } catch {
      parsed = typeof ref === "object" ? ref : { actionId: ref };
    }

    const actionId = parsed.packageId
      ? `${parsed.packageId}/${parsed.actionId}`
      : parsed.actionId;
    const raw = await fetchRemoteActionShow(this.serverUrl, actionId, this.token);

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
    };
  }

  async listPlaybooks(options?: { intent?: string; package?: string }): Promise<PlaybookSummary[]> {
    const rawList = await fetchRemotePlaybooks(this.serverUrl, this.token, options);
    return rawList.map((item: any) => ({
      id: item.id,
      description: item.description,
      actions: item.actions,
      packageId: item.packageId,
      filePath: item.filePath,
    }));
  }

  async describePlaybook(id: string): Promise<PlaybookSpec> {
    const raw = await fetchRemotePlaybookShow(this.serverUrl, id, this.token);
    return {
      id: raw.id,
      description: raw.description,
      actions: raw.actions,
      filePath: raw.filePath,
      content: raw.content,
    };
  }

  async runAction(
    ref: ActionRef | string,
    input: JsonValue,
    options?: ExecuteOptions
  ): Promise<ExecutionResult> {
    let parsed: ActionRef;
    try {
      parsed = ActionResolver.parseRef(ref);
    } catch {
      parsed = typeof ref === "object" ? ref : { actionId: ref };
    }

    const actionId = parsed.packageId
      ? `${parsed.packageId}/${parsed.actionId}`
      : parsed.actionId;

    return executeRemoteAction(
      this.serverUrl,
      actionId,
      input,
      {
        configOverrides: options?.config,
        token: this.token,
        timeoutMs: options?.timeoutMs ?? this.timeoutMs,
        signal: options?.signal,
        requestId: options?.requestId,
        async: false,
      }
    );
  }

  async startAction(
    ref: ActionRef | string,
    input: JsonValue,
    options?: ExecuteOptions
  ): Promise<ExecutionTicket> {
    let parsed: ActionRef;
    try {
      parsed = ActionResolver.parseRef(ref);
    } catch {
      parsed = typeof ref === "object" ? ref : { actionId: ref };
    }

    const actionId = parsed.packageId
      ? `${parsed.packageId}/${parsed.actionId}`
      : parsed.actionId;

    const res = await executeRemoteAction(
      this.serverUrl,
      actionId,
      input,
      {
        configOverrides: options?.config,
        token: this.token,
        timeoutMs: options?.timeoutMs ?? this.timeoutMs,
        signal: options?.signal,
        requestId: options?.requestId,
        async: true,
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
      result: this.waitForRunCompletion(runId, options?.signal),
    };
  }

  private async waitForRunCompletion(
    runId: string,
    signal?: AbortSignal
  ): Promise<ExecutionResult> {
    // 1. 优先尝试监听 SSE 事件流终态事件
    try {
      for await (const evt of this.events(runId, { signal })) {
        if (evt.type === "finish") {
          const res = (evt as any).result || (evt as any).data || evt;
          if (typeof res?.ok === "boolean") {
            return res;
          }
        }
      }
    } catch {
      // 忽略 SSE 异常并自动回退轮询
    }

    // 2. 回退短轮询检索运行详情
    const startTime = Date.now();
    const maxWaitMs = 60000;
    while (Date.now() - startTime < maxWaitMs) {
      if (signal?.aborted) {
        return {
          ok: false,
          runId,
          error: {
            code: "ACTION_CANCELLED",
            message: "Action execution was cancelled",
          },
        };
      }
      const run = await this.getRun(runId);
      if (run) {
        if (run.status === "success") {
          return { ok: true, runId, data: run.output ?? null };
        }
        if (
          run.status === "failed" ||
          run.status === "timed_out" ||
          run.status === "cancelled"
        ) {
          return {
            ok: false,
            runId,
            error: run.error || {
              code: "EXECUTION_FAILED",
              message: `Run finished with status ${run.status}`,
            },
          };
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 150));
    }

    return {
      ok: false,
      runId,
      error: {
        code: "TIMEOUT",
        message: `Timed out waiting for run '${runId}' completion`,
      },
    };
  }

  async listRuns(options?: ListRunsOptions): Promise<RunRecord[]> {
    try {
      const res = await fetchRemoteRuns(this.serverUrl, this.token, {
        packageId: options?.packageId,
        actionId: options?.actionId,
        status: options?.status,
        intent: options?.intent,
        limit: options?.limit,
      });
      return res.items || [];
    } catch (err: any) {
      wrapRemoteError(err);
    }
  }

  async clearRuns(options?: { packageId?: string; actionId?: string; status?: string }): Promise<number> {
    try {
      const res = await clearRemoteRuns(this.serverUrl, this.token, options);
      return res.clearedCount ?? 0;
    } catch (err: any) {
      wrapRemoteError(err);
    }
  }

  async getRun(runId: string): Promise<RunRecord | undefined> {
    try {
      return await fetchRemoteRun(this.serverUrl, runId, this.token);
    } catch (err: any) {
      const msg = String(err?.message || "");
      if (msg.includes("404") || msg.includes("not found") || msg.includes("RUN_NOT_FOUND")) {
        return undefined;
      }
      throw err;
    }
  }

  async cancelRun(runId: string, reason?: string): Promise<CancelResult> {
    try {
      const res = await cancelRemoteRun(this.serverUrl, runId, this.token, reason);
      return { outcome: "requested", runId: res.runId };
    } catch (err: any) {
      const msg = String(err?.message || "");
      if (msg.includes("already finished") || msg.includes("RUN_ALREADY_FINISHED")) {
        return { outcome: "already_terminal", runId, status: "failed" };
      }
      if (msg.includes("not found") || msg.includes("RUN_NOT_FOUND") || msg.includes("404")) {
        return { outcome: "not_found", runId };
      }
      throw err;
    }
  }

  async *events(
    runId: string,
    options?: { after?: number | string; signal?: AbortSignal; maxQueueSize?: number }
  ): AsyncIterable<ExecutionEvent> {
    yield* streamRemoteEvents(this.serverUrl, runId, this.token, options);
  }

  async getConfig(packageId: string, key: string): Promise<ConfigValueView> {
    try {
      const list = await this.listConfig(packageId);
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
  }

  async setConfig(packageId: string, key: string, value: JsonValue): Promise<void> {
    try {
      await setRemoteConfig(this.serverUrl, key, value, this.token, packageId || undefined);
    } catch (err: any) {
      wrapRemoteError(err);
    }
  }

  async deleteConfig(packageId: string, key: string): Promise<boolean> {
    try {
      const res = await deleteRemoteConfig(this.serverUrl, key, this.token, packageId || undefined);
      return Boolean(res?.deleted ?? true);
    } catch (err: any) {
      wrapRemoteError(err);
    }
  }

  async listConfig(packageId: string): Promise<ConfigValueView[]> {
    try {
      const res = await fetchRemoteConfig(this.serverUrl, this.token, packageId || undefined);
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
  }

  async getState<T extends JsonValue = JsonValue>(
    packageId: string,
    actionId: string,
    key: string,
    options?: StateScopeOptions
  ): Promise<T | undefined> {
    try {
      const res = await getRemoteStateKey(this.serverUrl, key, this.token, {
        package: packageId || undefined,
        action: actionId || undefined,
        namespace: options?.namespace,
      });
      if (res === undefined) return undefined;
      if (options?.detail) {
        return res as T;
      }
      return (res?.value !== undefined ? res.value : res) as T;
    } catch (err: any) {
      const msg = String(err?.message || "");
      if (msg.includes("404") || msg.includes("not found") || msg.includes("STATE_KEY_NOT_FOUND")) {
        return undefined;
      }
      wrapRemoteError(err);
    }
  }

  async setState<T extends JsonValue = JsonValue>(
    packageId: string,
    actionId: string,
    key: string,
    value: T,
    options?: StateScopeOptions
  ): Promise<void> {
    try {
      await setRemoteStateKey(this.serverUrl, key, value, this.token, {
        package: packageId || undefined,
        action: actionId || undefined,
        namespace: options?.namespace,
        ttl: options?.ttl,
      });
    } catch (err: any) {
      wrapRemoteError(err);
    }
  }

  async deleteState(
    packageId: string,
    actionId: string,
    key: string,
    options?: StateScopeOptions
  ): Promise<boolean> {
    try {
      const res = await deleteRemoteStateKey(this.serverUrl, key, this.token, {
        package: packageId || undefined,
        action: actionId || undefined,
        namespace: options?.namespace,
      });
      return Boolean(res?.deleted ?? true);
    } catch (err: any) {
      const msg = String(err?.message || "");
      if (msg.includes("404") || msg.includes("not found") || msg.includes("STATE_KEY_NOT_FOUND")) {
        return false;
      }
      wrapRemoteError(err);
    }
  }

  async listStateKeys(
    packageId: string,
    actionId: string,
    options?: StateScopeOptions
  ): Promise<string[]> {
    try {
      const res = await fetchRemoteStateList(this.serverUrl, this.token, {
        package: packageId || undefined,
        action: actionId || undefined,
        namespace: options?.namespace,
        prefix: options?.prefix,
      });
      return res.keys || [];
    } catch (err: any) {
      wrapRemoteError(err);
    }
  }

  async clearState(
    packageId: string,
    actionId: string,
    options?: StateScopeOptions
  ): Promise<number> {
    try {
      const res = await clearRemoteState(this.serverUrl, this.token, {
        package: packageId || undefined,
        action: actionId || undefined,
        namespace: options?.namespace,
        prefix: options?.prefix,
        all: options?.all,
      });
      return res.clearedCount ?? 0;
    } catch (err: any) {
      wrapRemoteError(err);
    }
  }

  async listStateEntries(
    packageId: string,
    options?: any
  ): Promise<StateEntry[]> {
    throw new TargetError(
      TARGET_CAPABILITY_UNAVAILABLE,
      "TARGET_CAPABILITY_UNAVAILABLE: listStateEntries is not supported on remote target"
    );
  }

  async close(_options?: { timeoutMs?: number }): Promise<void> {
    // 远程 Target 无本地资源需要释放
  }
}

function wrapRemoteError(err: any): never {
  const msg = String(err?.message || "");
  const code = err?.code || "";
  if (
    code === "CAPABILITY_UNAVAILABLE" ||
    code === "TARGET_CAPABILITY_UNAVAILABLE" ||
    msg.includes("CAPABILITY_UNAVAILABLE") ||
    msg.includes("TARGET_CAPABILITY_UNAVAILABLE") ||
    msg.includes("Management APIs are not enabled") ||
    err?.status === 403 ||
    msg.includes("(403)")
  ) {
    throw new TargetError(
      TARGET_CAPABILITY_UNAVAILABLE,
      `TARGET_CAPABILITY_UNAVAILABLE: Management APIs are not enabled on remote target`,
      { originalMessage: msg }
    );
  }
  if (
    code === "PROTOCOL_UNSUPPORTED" ||
    code === "TARGET_PROTOCOL_UNSUPPORTED" ||
    msg.includes("PROTOCOL_UNSUPPORTED") ||
    msg.includes("TARGET_PROTOCOL_UNSUPPORTED")
  ) {
    throw new TargetError(
      TARGET_PROTOCOL_UNSUPPORTED,
      `TARGET_PROTOCOL_UNSUPPORTED: ${msg}`,
      { originalMessage: msg }
    );
  }
  if (
    code === "TARGET_RESULT_UNKNOWN" ||
    code === "RESULT_UNKNOWN" ||
    msg.includes("TARGET_RESULT_UNKNOWN")
  ) {
    throw new TargetError(
      TARGET_RESULT_UNKNOWN,
      `TARGET_RESULT_UNKNOWN: ${msg}`,
      { originalMessage: msg }
    );
  }
  throw err;
}
