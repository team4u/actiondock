import type { ExecutionEvent } from "@actiondock/sdk";
import { ActionDockError, EVENT_CURSOR_EXPIRED, REMOTE_STREAM_UNAVAILABLE } from "../errors";
import { assertSecureTransport } from "../profile/client";
import { normalizeServerUrl } from "../profile/manager";
import { getInsecureDispatcher } from "../server/dispatcher";
import { parseSseMessages, type SseMessage } from "./sse-parser";

/**
 * 将 SSE 消息载荷解码为统一执行事件。
 *
 * 非 JSON 数据行直接忽略；finish 事件取 data.result 字段，其余事件字段展开合并。
 */
export function decodeExecutionEvent(msg: SseMessage, runId: string): ExecutionEvent | undefined {
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
 * 订阅远端运行事件流（Server-Sent Events）。
 *
 * 候选路由探测与自动回退：优先尝试标准 v2 路由 /api/v2/runs/:runId/events，
 * 失败时回退至既有路由 /api/v2/runs/:runId/stream；
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
  // 候选路由：v2 /events -> v2 /stream
  const candidateUrls = [
    `${base}/api/v2/${runRoute}/events`,
    `${base}/api/v2/${runRoute}/stream`,
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
          throw new ActionDockError(
            errJson?.error?.code || EVENT_CURSOR_EXPIRED,
            errJson?.error?.message || "Event cursor has expired",
            errJson?.error?.details
          );
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

  function buildStreamUnavailableError(
    candidateFailures: Array<{ url: string; reason: string }>
  ): ActionDockError {
    const summary = candidateFailures
      .map((f) => `${f.url} (${f.reason})`)
      .join(", ");
    return new ActionDockError(
      REMOTE_STREAM_UNAVAILABLE,
      `REMOTE_STREAM_UNAVAILABLE: All event stream candidates failed for run '${runId}': ${summary}`,
      {
        runId,
        candidates: candidateFailures.map((f) => ({ url: f.url, reason: f.reason })),
      }
    );
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
