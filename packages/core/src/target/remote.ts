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
  assertSecureTransport,
} from "../profile/client";
import { normalizeServerUrl } from "../profile/manager";
import { type StateEntry, isTerminalRunStatus } from "../storage/types";
import {
  ACTIONDOCK_PROTOCOL_VERSION,
  type ActionDockTarget,
  type ConfigValueView,
  type ListRunsOptions,
  type RemoteTargetOptions,
  type StateScopeOptions,
  type TargetInfo,
  TargetError,
  TARGET_PROTOCOL_UNSUPPORTED,
  TARGET_CAPABILITY_UNAVAILABLE,
  TARGET_RESULT_UNKNOWN,
} from "./types";
import { ACTION_CANCELLED, EXECUTION_FAILED, STATE_KEY_NOT_FOUND, TIMEOUT } from "../errors";

/**
 * 读取并解析远端 SSE 事件流。
 */
export async function* streamRemoteEvents(
  serverUrl: string,
  runId: string,
  token?: string,
  options?: { after?: number | string; signal?: AbortSignal; maxQueueSize?: number; allowInsecureHttp?: boolean }
): AsyncIterable<ExecutionEvent> {
  assertSecureTransport(serverUrl, token, options?.allowInsecureHttp);
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
  public readonly baseTimeoutMs: number;

  constructor(options: RemoteTargetOptions) {
    this.serverUrl = options.serverUrl;
    this.token = options.token;
    this.timeoutMs = options.timeoutMs;
    this.baseTimeoutMs = options.baseTimeoutMs ?? 60000;
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
      result: this.waitForRunCompletion(runId, options?.signal, options?.timeoutMs),
    };
  }

  /**
   * 等待远端运行抵达终态：优先监听 SSE 事件流，失败后按指数退避轮询运行详情。
   *
   * @param runId 运行标识
   * @param signal 外部取消信号
   * @param timeoutMs 运行自身声明的超时（等待上限取该值与默认上限中的较大者）
   */
  private async waitForRunCompletion(
    runId: string,
    signal?: AbortSignal,
    timeoutMs?: number
  ): Promise<ExecutionResult> {
    // 优先尝试监听 SSE 事件流终态事件
    try {
      for await (const evt of this.events(runId, { signal })) {
        if (evt.type === "finish") {
          const res = (evt as any).result || (evt as any).data || evt;
          if (typeof res?.ok === "boolean") {
            return res;
          }
        }
      }
    } catch (err: any) {
      // SSE 通道异常视为不可用：记录后按指数退避进入轮询兜底
      console.warn(
        `[ActionDock] SSE event stream unavailable for run '${runId}', falling back to polling: ${err?.message || String(err)}`
      );
    }

    // 回退指数退避轮询检索运行详情（150ms 起步，上限 2000ms）
    return this.pollRunCompletion(runId, signal, timeoutMs);
  }

  /**
   * 指数退避轮询远端运行详情直至终态、取消或超时上限。
   */
  private async pollRunCompletion(
    runId: string,
    signal?: AbortSignal,
    timeoutMs?: number
  ): Promise<ExecutionResult> {
    const startTime = Date.now();
    // 等待上限与运行自身 timeoutMs 对齐（取二者较大值，默认 baseTimeoutMs = 60000ms）
    const baseWait = this.baseTimeoutMs;
    const maxWaitMs = Math.max(baseWait, timeoutMs ?? 0);
    let delayMs = Math.min(150, Math.max(10, Math.floor(maxWaitMs / 4)));
    const maxDelayMs = 2000;

    while (Date.now() - startTime < maxWaitMs) {
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
      const run = await this.getRun(runId);
      if (run && isTerminalRunStatus(run.status)) {
        if (run.status === "success") {
          return { ok: true, runId, data: run.output ?? null };
        }
        if (run.status === "interrupted") {
          return {
            ok: false,
            runId,
            error: run.error || {
              code: "RUN_INTERRUPTED",
              message: `Run '${runId}' was interrupted`,
            },
          };
        }
        return {
          ok: false,
          runId,
          error: run.error || {
            code: EXECUTION_FAILED,
            message: `Run finished with status ${run.status}`,
          },
        };
      }
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      delayMs = Math.min(delayMs * 2, maxDelayMs);
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
      if (isRemoteStateKeyNotFound(err)) {
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
      if (isRemoteStateKeyNotFound(err)) {
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

/**
 * 判定远端状态键访问异常是否为键不存在。
 *
 * 优先读取传输层透传的结构化错误码（fetchRemoteJson 会将响应体 error.code
 * 附加到抛出异常的 code 字段），仅当旧版服务器未透传 code 时回退到
 * HTTP 状态与消息文本兼容嗅探。
 */
function isRemoteStateKeyNotFound(err: any): boolean {
  if (err?.code === STATE_KEY_NOT_FOUND) {
    return true;
  }
  const msg = String(err?.message || "");
  return err?.status === 404 || msg.includes("404") || msg.includes("not found");
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
