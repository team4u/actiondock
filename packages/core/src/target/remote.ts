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
} from "../app/types";
import { ActionResolver } from "../catalog/action-resolver";
import type {
  CancelResult,
  ExecuteOptions,
  ExecutionTicket,
} from "../execution/types";
import {
  cancelRemoteRun,
  executeRemoteAction,
  fetchRemoteActionShow,
  fetchRemoteActions,
  fetchRemoteInfo,
  fetchRemoteRun,
} from "../profile/client";
import { normalizeServerUrl } from "../profile/manager";
import type { ActionDockTarget, RemoteTargetOptions } from "./types";

/**
 * 读取并解析远端 SSE 事件流。
 */
export async function* streamRemoteEvents(
  serverUrl: string,
  runId: string,
  token?: string,
  options?: { signal?: AbortSignal }
): AsyncIterable<ExecutionEvent> {
  const base = normalizeServerUrl(serverUrl);
  const url = `${base}/api/v1/runs/${encodeURIComponent(runId)}/stream`;
  const headers: Record<string, string> = {
    Accept: "text/event-stream",
  };
  if (token && token.trim()) {
    headers.Authorization = `Bearer ${token.trim()}`;
  }

  let res: Response;
  try {
    res = await fetch(url, {
      headers,
      signal: options?.signal,
    });
  } catch {
    return;
  }

  if (!res.ok || !res.body) {
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
        let dataStr = "";
        for (const line of part.split("\n")) {
          if (line.startsWith("event:")) {
            eventType = line.slice(6).trim();
          } else if (line.startsWith("data:")) {
            dataStr += line.slice(5).trim();
          }
        }
        if (dataStr) {
          try {
            const data = JSON.parse(dataStr);
            if (eventType === "finish") {
              yield {
                type: "finish",
                runId,
                timestamp: new Date().toISOString(),
                result: data.result || data,
              } as ExecutionEvent;
            } else {
              yield {
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

  async info(): Promise<PackageInfo | PackageInfo[]> {
    const raw = await fetchRemoteInfo(this.serverUrl, this.token);
    if (Array.isArray(raw)) return raw;
    if (raw && typeof raw === "object" && "packages" in raw) {
      return Object.values(raw.packages);
    }
    return raw;
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
    options?: { after?: number; signal?: AbortSignal }
  ): AsyncIterable<ExecutionEvent> {
    yield* streamRemoteEvents(this.serverUrl, runId, this.token, options);
  }

  async close(): Promise<void> {
    // 远程 Target 无本地资源需要释放
  }
}
