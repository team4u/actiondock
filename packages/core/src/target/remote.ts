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
  TARGET_CLOSED,
} from "./types";
import { ACTION_CANCELLED, REMOTE_STREAM_UNAVAILABLE, TIMEOUT } from "../errors";
import { getInsecureDispatcher } from "../server/dispatcher";
import { listProtocolRouteCandidates } from "../profile/client";
import { isRemoteStateKeyNotFound, wrapRemoteError } from "./remote-errors";
import { formatTerminalRunResult, pollRunCompletion } from "./remote-polling";
import { type SseMessage, parseSseMessages } from "./sse-parser";

/**
 * 读取并解析远端 SSE 事件流。
 *
 * 候选路由依次尝试：v2 /events -> v2 /stream -> v1 /stream；
 * 全部候选均不可用（网络异常或非流式响应）时抛出携带各候选 URL 与
 * 失败原因的 REMOTE_STREAM_UNAVAILABLE 聚合错误，严禁以空流伪装正常。
 */
export async function* streamRemoteEvents(
  serverUrl: string,
  runId: string,
  token?: string,
  options?: {
    after?: number | string;
    signal?: AbortSignal;
    maxQueueSize?: number;
    allowInsecureHttp?: boolean;
    insecure?: boolean;
    dispatcher?: unknown;
  }
): AsyncIterable<ExecutionEvent> {
  assertSecureTransport(serverUrl, token, {
    allowInsecureHttp: options?.allowInsecureHttp,
    insecure: options?.insecure,
  });
  const base = normalizeServerUrl(serverUrl);
  const runRoute = `runs/${encodeURIComponent(runId)}`;
  // 候选优先级：v2 /events -> v2 /stream -> v1 /stream（后两者经共享协议候选工具展开）
  const candidateUrls = [
    `${base}/api/v2/${runRoute}/events`,
    ...listProtocolRouteCandidates(base, `/api/v2/${runRoute}/stream`),
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

  /**
   * 依次尝试全部候选路由，返回首个可用响应。
   *
   * 单个候选失败（网络异常或非流式响应）时记录原因继续尝试后续候选；
   * 所有候选均失败时返回汇总后的失败原因列表供上层抛出聚合错误。
   */
  async function resolveStreamCandidate(): Promise<
    { ok: true; body: ReadableStream<Uint8Array> } | { ok: false; candidateFailures: Array<{ url: string; reason: string }> }
  > {
    const candidateFailures: Array<{ url: string; reason: string }> = [];
    for (const url of candidateUrls) {
      const fetchInit: RequestInit & { dispatcher?: any } = {
        headers,
        signal: options?.signal,
      };
      if (options?.dispatcher) {
        fetchInit.dispatcher = options.dispatcher;
      } else if (options?.insecure) {
        fetchInit.dispatcher = getInsecureDispatcher();
      }
      try {
        const resp = await fetch(url, fetchInit);
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
          return { ok: true, body: resp.body };
        }
        candidateFailures.push({
          url,
          reason: `HTTP ${resp.status} ${resp.statusText || ""}`.trim(),
        });
      } catch (err: any) {
        if (err?.code === "EVENT_CURSOR_EXPIRED") {
          throw err;
        }
        candidateFailures.push({
          url,
          reason: err?.message ? `${err.name || "Error"}: ${err.message}` : String(err),
        });
      }
    }
    return { ok: false, candidateFailures };
  }

  /**
   * 构造全部候选路由均不可用时的聚合错误。
   */
  function buildStreamUnavailableError(
    candidateFailures: Array<{ url: string; reason: string }>
  ): Error {
    const summary = candidateFailures
      .map((f) => `${f.url} (${f.reason})`)
      .join(", ");
    const err = new Error(
      `REMOTE_STREAM_UNAVAILABLE: All event stream candidates failed for run '${runId}': ${summary}`
    );
    (err as any).code = REMOTE_STREAM_UNAVAILABLE;
    (err as any).details = {
      runId,
      candidates: candidateFailures.map((f) => ({ url: f.url, reason: f.reason })),
    };
    return err;
  }

  const res = await resolveStreamCandidate();
  if (!res.ok) {
    throw buildStreamUnavailableError(res.candidateFailures);
  }

  try {
    for await (const msg of parseSseMessages(res.body, { signal: options?.signal })) {
      const evt = decodeExecutionEvent(msg, runId);
      if (evt) yield evt;
    }
  } catch (err: any) {
    if (err.name === "AbortError" || options?.signal?.aborted) {
      return;
    }
    throw err;
  }
}

/**
 * 将 SSE 消息载荷解码为统一执行事件。
 *
 * 非 JSON 数据行直接忽略；finish 事件取 data.result 字段，其余事件字段展开合并。
 */
function decodeExecutionEvent(msg: SseMessage, runId: string): ExecutionEvent | undefined {
  try {
    const data = JSON.parse(msg.data);
    if (msg.event === "finish") {
      return {
        eventId: msg.id ?? data.eventId,
        type: "finish",
        runId,
        timestamp: new Date().toISOString(),
        result: data.result || data,
      } as ExecutionEvent;
    } else {
      return {
        eventId: msg.id ?? data.eventId,
        type: (msg.event || "message") as any,
        runId,
        timestamp: new Date().toISOString(),
        ...data,
      } as ExecutionEvent;
    }
  } catch {
    // 忽略非 JSON 数据行
    return undefined;
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
  public readonly allowInsecureHttp?: boolean;
  public readonly insecure?: boolean;
  public readonly dispatcher?: unknown;
  private isClosed = false;

  constructor(options: RemoteTargetOptions) {
    this.serverUrl = options.serverUrl;
    this.token = options.token;
    this.timeoutMs = options.timeoutMs;
    this.baseTimeoutMs = options.baseTimeoutMs ?? 60000;
    this.allowInsecureHttp = options.allowInsecureHttp;
    this.insecure = options.insecure;
    this.dispatcher = options.dispatcher;
  }

  private assertNotClosed(): void {
    if (this.isClosed) {
      throw new TargetError(
        TARGET_CLOSED,
        "RemoteActionDockTarget is closed"
      );
    }
  }

  async info(): Promise<TargetInfo> {
    this.assertNotClosed();
    let raw: any;
    try {
      raw = await fetchRemoteInfo(this.serverUrl, this.token, {
        allowInsecureHttp: this.allowInsecureHttp,
        insecure: this.insecure,
        dispatcher: this.dispatcher,
      });
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
    this.assertNotClosed();
    const info = await this.info();
    return info.packages;
  }

  async listActions(options?: ListActionsOptions): Promise<ActionSummary[]> {
    this.assertNotClosed();
    const rawList = await fetchRemoteActions(this.serverUrl, this.token, options?.query, {
      allowInsecureHttp: this.allowInsecureHttp,
      insecure: this.insecure,
      dispatcher: this.dispatcher,
    });
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
    this.assertNotClosed();
    let parsed: ActionRef;
    try {
      parsed = ActionResolver.parseRef(ref);
    } catch {
      parsed = typeof ref === "object" ? ref : { actionId: ref };
    }

    const actionId = parsed.packageId
      ? `${parsed.packageId}/${parsed.actionId}`
      : parsed.actionId;
    const raw = await fetchRemoteActionShow(this.serverUrl, actionId, this.token, {
      allowInsecureHttp: this.allowInsecureHttp,
      insecure: this.insecure,
      dispatcher: this.dispatcher,
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
  }

  async listPlaybooks(options?: { intent?: string; package?: string }): Promise<PlaybookSummary[]> {
    this.assertNotClosed();
    const rawList = await fetchRemotePlaybooks(this.serverUrl, this.token, {
      ...options,
      allowInsecureHttp: this.allowInsecureHttp,
      insecure: this.insecure,
      dispatcher: this.dispatcher,
    });
    return rawList.map((item: any) => ({
      id: item.id,
      description: item.description,
      actions: item.actions,
      packageId: item.packageId,
      filePath: item.filePath,
    }));
  }

  async describePlaybook(id: string): Promise<PlaybookSpec> {
    this.assertNotClosed();
    const raw = await fetchRemotePlaybookShow(this.serverUrl, id, this.token, {
      allowInsecureHttp: this.allowInsecureHttp,
      insecure: this.insecure,
      dispatcher: this.dispatcher,
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
  }

  async runAction(
    ref: ActionRef | string,
    input: JsonValue,
    options?: ExecuteOptions
  ): Promise<ExecutionResult> {
    this.assertNotClosed();
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
        allowInsecureHttp: this.allowInsecureHttp,
        insecure: this.insecure,
        dispatcher: this.dispatcher,
      }
    );
  }

  async startAction(
    ref: ActionRef | string,
    input: JsonValue,
    options?: ExecuteOptions
  ): Promise<ExecutionTicket> {
    this.assertNotClosed();
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
        allowInsecureHttp: this.allowInsecureHttp,
        insecure: this.insecure,
        dispatcher: this.dispatcher,
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
          code: TARGET_CLOSED,
          message: "RemoteActionDockTarget is closed",
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

    // 优先尝试监听 SSE 事件流终态事件
    try {
      for await (const evt of this.events(runId, { signal: internalController.signal })) {
        if (evt.type === "finish") {
          const res = (evt as any).result || (evt as any).data || evt;
          if (typeof res?.ok === "boolean") {
            return res;
          }
        }
      }
    } catch (err: any) {
      if (err?.code === TARGET_CLOSED || this.isClosed) {
        return {
          ok: false,
          runId,
          error: {
            code: TARGET_CLOSED,
            message: "RemoteActionDockTarget is closed",
          },
        };
      }
      if (!signal?.aborted && !sseTimedOut) {
        // SSE 通道异常视为不可用：记录后按指数退避进入轮询兜底
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
            code: TARGET_CLOSED,
            message: "RemoteActionDockTarget is closed",
          },
        };
      }
      try {
        const run = await this.getRun(runId);
        if (run && isTerminalRunStatus(run.status)) {
          return this.formatTerminalRunResult(run, runId);
        }
      } catch (err: any) {
        if (err?.code === TARGET_CLOSED || this.isClosed) {
          return {
            ok: false,
            runId,
            error: {
              code: TARGET_CLOSED,
              message: "RemoteActionDockTarget is closed",
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

    // 剩余时间继续通过 pollRunCompletion 进行轮询兜底
    return this.pollRunCompletion(runId, signal, remainingWaitMs, startTime, maxWaitMs);
  }

  /**
   * 指数退避轮询远端运行详情直至终态、取消或超时上限。
   */
  private async pollRunCompletion(
    runId: string,
    signal?: AbortSignal,
    timeoutMs?: number,
    startTime: number = Date.now(),
    totalMaxWaitMs?: number
  ): Promise<ExecutionResult> {
    return pollRunCompletion(
      {
        baseTimeoutMs: this.baseTimeoutMs,
        isClosed: () => this.isClosed,
        getRun: (id) => this.getRun(id),
      },
      runId,
      signal,
      timeoutMs,
      startTime,
      totalMaxWaitMs
    );
  }

  private formatTerminalRunResult(run: RunRecord, runId: string): ExecutionResult {
    return formatTerminalRunResult(run, runId);
  }

  async listRuns(options?: ListRunsOptions): Promise<RunRecord[]> {
    this.assertNotClosed();
    try {
      const res = await fetchRemoteRuns(this.serverUrl, this.token, {
        packageId: options?.packageId,
        actionId: options?.actionId,
        status: options?.status,
        intent: options?.intent,
        limit: options?.limit,
        allowInsecureHttp: this.allowInsecureHttp,
        insecure: this.insecure,
        dispatcher: this.dispatcher,
      });
      return res.items || [];
    } catch (err: any) {
      wrapRemoteError(err);
    }
  }

  async clearRuns(options?: { packageId?: string; actionId?: string; status?: string }): Promise<number> {
    this.assertNotClosed();
    try {
      const res = await clearRemoteRuns(this.serverUrl, this.token, {
        ...options,
        allowInsecureHttp: this.allowInsecureHttp,
        insecure: this.insecure,
        dispatcher: this.dispatcher,
      });
      return res.clearedCount ?? 0;
    } catch (err: any) {
      wrapRemoteError(err);
    }
  }

  async getRun(runId: string): Promise<RunRecord | undefined> {
    this.assertNotClosed();
    try {
      return await fetchRemoteRun(this.serverUrl, runId, this.token, {
        allowInsecureHttp: this.allowInsecureHttp,
        insecure: this.insecure,
        dispatcher: this.dispatcher,
      });
    } catch (err: any) {
      const msg = String(err?.message || "");
      if (msg.includes("404") || msg.includes("not found") || msg.includes("RUN_NOT_FOUND")) {
        return undefined;
      }
      throw err;
    }
  }

  async cancelRun(runId: string, reason?: string): Promise<CancelResult> {
    this.assertNotClosed();
    try {
      const res = await cancelRemoteRun(this.serverUrl, runId, this.token, reason, {
        allowInsecureHttp: this.allowInsecureHttp,
        insecure: this.insecure,
        dispatcher: this.dispatcher,
      });
      return { outcome: "requested", runId: res.runId };
    } catch (err: any) {
      const msg = String(err?.message || "");
      const code = String(err?.code || "");
      if (
        code === "RUN_ALREADY_FINISHED" ||
        msg.includes("already finished") ||
        msg.includes("RUN_ALREADY_FINISHED")
      ) {
        let status = (err as any)?.errorData?.status || (err as any)?.details?.status;
        if (!status) {
          try {
            const run = await this.getRun(runId);
            if (run?.status) {
              status = run.status;
            }
          } catch {}
        }
        return { outcome: "already_terminal", runId, status: (status as any) || "failed" };
      }
      if (
        code === "RUN_NOT_FOUND" ||
        msg.includes("not found") ||
        msg.includes("RUN_NOT_FOUND") ||
        msg.includes("404")
      ) {
        return { outcome: "not_found", runId };
      }
      throw err;
    }
  }

  events(
    runId: string,
    options?: { after?: number | string; signal?: AbortSignal; maxQueueSize?: number }
  ): AsyncIterable<ExecutionEvent> {
    this.assertNotClosed();
    const self = this;
    async function* stream(): AsyncIterable<ExecutionEvent> {
      self.assertNotClosed();
      for await (const event of streamRemoteEvents(self.serverUrl, runId, self.token, {
        ...options,
        allowInsecureHttp: self.allowInsecureHttp,
        insecure: self.insecure,
        dispatcher: self.dispatcher,
      })) {
        self.assertNotClosed();
        yield event;
      }
    }
    return stream();
  }

  async getConfig(packageId: string, key: string): Promise<ConfigValueView> {
    this.assertNotClosed();
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
    this.assertNotClosed();
    try {
      await setRemoteConfig(this.serverUrl, key, value, this.token, packageId || undefined, {
        allowInsecureHttp: this.allowInsecureHttp,
        insecure: this.insecure,
        dispatcher: this.dispatcher,
      });
    } catch (err: any) {
      wrapRemoteError(err);
    }
  }

  async deleteConfig(packageId: string, key: string): Promise<boolean> {
    this.assertNotClosed();
    try {
      const res = await deleteRemoteConfig(this.serverUrl, key, this.token, packageId || undefined, {
        allowInsecureHttp: this.allowInsecureHttp,
        insecure: this.insecure,
        dispatcher: this.dispatcher,
      });
      return Boolean(res?.deleted ?? true);
    } catch (err: any) {
      wrapRemoteError(err);
    }
  }

  async listConfig(packageId: string): Promise<ConfigValueView[]> {
    this.assertNotClosed();
    try {
      const res = await fetchRemoteConfig(this.serverUrl, this.token, packageId || undefined, {
        allowInsecureHttp: this.allowInsecureHttp,
        insecure: this.insecure,
        dispatcher: this.dispatcher,
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
  }

  async getState<T extends JsonValue = JsonValue>(
    packageId: string,
    actionId: string,
    key: string,
    options?: StateScopeOptions
  ): Promise<T | undefined> {
    this.assertNotClosed();
    try {
      const res = await getRemoteStateKey(this.serverUrl, key, this.token, {
        package: packageId || undefined,
        action: actionId || undefined,
        namespace: options?.namespace,
        allowInsecureHttp: this.allowInsecureHttp,
        insecure: this.insecure,
        dispatcher: this.dispatcher,
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
    this.assertNotClosed();
    try {
      await setRemoteStateKey(this.serverUrl, key, value, this.token, {
        package: packageId || undefined,
        action: actionId || undefined,
        namespace: options?.namespace,
        ttl: options?.ttl,
        allowInsecureHttp: this.allowInsecureHttp,
        insecure: this.insecure,
        dispatcher: this.dispatcher,
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
    this.assertNotClosed();
    try {
      const res = await deleteRemoteStateKey(this.serverUrl, key, this.token, {
        package: packageId || undefined,
        action: actionId || undefined,
        namespace: options?.namespace,
        allowInsecureHttp: this.allowInsecureHttp,
        insecure: this.insecure,
        dispatcher: this.dispatcher,
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
    this.assertNotClosed();
    try {
      const res = await fetchRemoteStateList(this.serverUrl, this.token, {
        package: packageId || undefined,
        action: actionId || undefined,
        namespace: options?.namespace,
        prefix: options?.prefix,
        allowInsecureHttp: this.allowInsecureHttp,
        insecure: this.insecure,
        dispatcher: this.dispatcher,
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
    this.assertNotClosed();
    try {
      const res = await clearRemoteState(this.serverUrl, this.token, {
        package: packageId || undefined,
        action: actionId || undefined,
        namespace: options?.namespace,
        prefix: options?.prefix,
        all: options?.all,
        allowInsecureHttp: this.allowInsecureHttp,
        insecure: this.insecure,
        dispatcher: this.dispatcher,
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
    this.assertNotClosed();
    throw new TargetError(
      TARGET_CAPABILITY_UNAVAILABLE,
      "TARGET_CAPABILITY_UNAVAILABLE: listStateEntries is not supported on remote target"
    );
  }

  async close(_options?: { timeoutMs?: number }): Promise<void> {
    if (this.isClosed) {
      return;
    }
    this.isClosed = true;
  }
}

