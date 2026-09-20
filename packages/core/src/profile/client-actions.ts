import { randomUUID } from "node:crypto";
import type { ExecutionResult } from "@actiondock/sdk";
import { ACTION_CANCELLED, ACTION_TIMEOUT, NETWORK_ERROR } from "../errors";
import { getInsecureDispatcher } from "../server/dispatcher";
import { normalizeServerUrl } from "./manager";
import {
  assertSecureTransport,
  buildHeaders,
  fetchWithProtocolFallback,
  type RemoteClientRequestOptions,
} from "./client-transport";
import { buildQueryString, fetchRemoteJson } from "./client-query";

/**
 * 远端 Action 执行与查询域端点。
 */

/**
 * 调用远端 ActionDock 服务端执行 Action 时的选项参数。
 */
export interface RemoteExecuteOptions extends RemoteClientRequestOptions {
  /** 动态配置覆盖 */
  configOverrides?: Record<string, unknown>;
  /** 鉴权 Bearer Token */
  token?: string;
  /** 超时毫秒数 */
  timeoutMs?: number;
  /** 中断信号 */
  signal?: AbortSignal;
  /** 幂等请求去重标识 */
  requestId?: string;
  /** 是否异步触发（202 Accepted 立即返回 runId） */
  async?: boolean;
}

/**
 * 远端 Action 执行结果信封对象。
 */
export type RemoteExecutionResult<T = unknown> = ExecutionResult<T> & {
  status?: string;
};

/**
 * 执行远端 Action：支持幂等标识、异步触发、外部取消信号与本地超时守卫组合。
 */
export async function executeRemoteAction<T = unknown>(
  serverUrl: string,
  actionId: string,
  input: unknown = {},
  configOverridesOrOptions?: Record<string, unknown> | RemoteExecuteOptions,
  tokenArg?: string
): Promise<RemoteExecutionResult<T>> {
  // Parse options / backwards compatibility
  let configOverrides: Record<string, unknown> | undefined;
  let token: string | undefined = tokenArg;
  let timeoutMs: number | undefined;
  let signal: AbortSignal | undefined;
  let isAsync = false;
  let requestId: string | undefined;
  let allowInsecureHttp: boolean | undefined;
  let insecure: boolean | undefined;
  let dispatcher: unknown;

  if (configOverridesOrOptions && typeof configOverridesOrOptions === "object") {
    if (
      "token" in configOverridesOrOptions ||
      "timeoutMs" in configOverridesOrOptions ||
      "signal" in configOverridesOrOptions ||
      "async" in configOverridesOrOptions ||
      "requestId" in configOverridesOrOptions ||
      "configOverrides" in configOverridesOrOptions ||
      "allowInsecureHttp" in configOverridesOrOptions ||
      "insecure" in configOverridesOrOptions ||
      "dispatcher" in configOverridesOrOptions
    ) {
      const opts = configOverridesOrOptions as RemoteExecuteOptions;
      configOverrides = opts.configOverrides;
      token = opts.token ?? tokenArg;
      timeoutMs = opts.timeoutMs;
      signal = opts.signal;
      isAsync = Boolean(opts.async);
      requestId = opts.requestId;
      allowInsecureHttp = opts.allowInsecureHttp;
      insecure = opts.insecure;
      dispatcher = opts.dispatcher;
    } else {
      configOverrides = configOverridesOrOptions as Record<string, unknown>;
    }
  }

  assertSecureTransport(serverUrl, token, { allowInsecureHttp, insecure });

  const executionPayload: Record<string, unknown> = {};
  if (isAsync) {
    executionPayload.mode = "async";
  }
  if (typeof timeoutMs === "number" && timeoutMs > 0) {
    executionPayload.timeoutMs = timeoutMs;
  }
  if (requestId) {
    executionPayload.requestId = requestId;
  }

  // 组合外部取消信号与本地超时守卫：服务端僵死时仍能在 timeoutMs 内本地中断，避免永久挂起
  let timeoutTimer: ReturnType<typeof setTimeout> | undefined;
  let localTimedOut = false;

  try {
    const headers: Record<string, string> = {
      ...buildHeaders(token),
      "Content-Type": "application/json",
    };
    if (requestId) {
      headers["Idempotency-Key"] = requestId;
      headers["x-request-id"] = requestId;
    }

    const reqBody = JSON.stringify({
      input,
      config: configOverrides,
      execution: Object.keys(executionPayload).length > 0 ? executionPayload : undefined,
    });

    const controller = new AbortController();
    const onExternalAbort = () => controller.abort(signal?.reason);
    if (signal) {
      if (signal.aborted) {
        controller.abort(signal.reason);
      } else {
        signal.addEventListener("abort", onExternalAbort, { once: true });
      }
    }
    if (typeof timeoutMs === "number" && timeoutMs > 0) {
      timeoutTimer = setTimeout(() => {
        localTimedOut = true;
        controller.abort();
      }, timeoutMs);
    }

    const fetchInit: RequestInit & { dispatcher?: any } = {
      method: "POST",
      headers,
      body: reqBody,
      signal: controller.signal,
    };
    if (dispatcher) {
      fetchInit.dispatcher = dispatcher;
    } else if (insecure) {
      fetchInit.dispatcher = getInsecureDispatcher();
    }

    let res: Response;
    try {
      res = await fetchWithProtocolFallback(
        normalizeServerUrl(serverUrl),
        `/api/v2/actions/${encodeURIComponent(actionId)}/run`,
        fetchInit
      );
    } finally {
      if (timeoutTimer !== undefined) {
        clearTimeout(timeoutTimer);
      }
      if (signal) {
        signal.removeEventListener("abort", onExternalAbort);
      }
    }

    const data = (await res.json().catch(() => null)) as any;

    if (data && typeof data === "object" && typeof data.ok === "boolean") {
      return data;
    }

    if (!res.ok) {
      // 错误信封严禁伪造 runId：与任何真实运行无关的标识会让调用方查询永远 not_found
      return {
        ok: false,
        runId: "",
        error: {
          code: res.status === 401 ? "UNAUTHORIZED" : "REMOTE_EXECUTION_FAILED",
          message: `Remote server HTTP ${res.status}: ${res.statusText}`,
          details: data,
        },
      };
    }

    return {
      ok: true,
      runId: randomUUID(),
      data,
    };
  } catch (err: any) {
    // 本地超时守卫触发时归类为超时；外部信号中止时归类为取消
    if (localTimedOut) {
      return {
        ok: false,
        runId: "",
        error: {
          code: ACTION_TIMEOUT,
          message: `Remote execution exceeded local timeout of ${timeoutMs}ms`,
        },
      };
    }
    if (err.name === "AbortError" || signal?.aborted) {
      return {
        ok: false,
        runId: "",
        error: {
          code: ACTION_CANCELLED,
          message: "Action execution was cancelled",
        },
      };
    }
    return {
      ok: false,
      runId: "",
      error: {
        code: NETWORK_ERROR,
        message: `Failed to connect to remote ActionDock server at ${serverUrl}: ${err.message}`,
      },
    };
  }
}

/**
 * 拉取远端 Action 列表（可按意图过滤）。
 */
export async function fetchRemoteActions(
  serverUrl: string,
  token?: string,
  intent?: string,
  options?: RemoteClientRequestOptions
): Promise<Array<{ id: string; description: string; packageId?: string }>> {
  return fetchRemoteJson(
    serverUrl,
    `/api/v2/actions${buildQueryString({ intent })}`,
    token,
    {
      errorPrefix: "Failed to fetch remote actions",
      allowInsecureHttp: options?.allowInsecureHttp,
      insecure: options?.insecure,
      dispatcher: options?.dispatcher,
    }
  );
}

/**
 * 拉取单个远端 Action 的详细契约描述。
 */
export async function fetchRemoteActionShow(
  serverUrl: string,
  actionId: string,
  token?: string,
  options?: RemoteClientRequestOptions
): Promise<any> {
  return fetchRemoteJson(
    serverUrl,
    `/api/v2/actions/${encodeURIComponent(actionId)}`,
    token,
    {
      errorPrefix: `Failed to fetch remote action '${actionId}'`,
      allowInsecureHttp: options?.allowInsecureHttp,
      insecure: options?.insecure,
      dispatcher: options?.dispatcher,
    }
  );
}

/**
 * 拉取远端服务信息总览（可按意图、包名过滤并附目录树）。
 */
export async function fetchRemoteInfo(
  serverUrl: string,
  token?: string,
  options?: { intent?: string; package?: string; tree?: boolean } & RemoteClientRequestOptions
): Promise<any> {
  return fetchRemoteJson(
    serverUrl,
    `/api/v2/info${buildQueryString({
      intent: options?.intent,
      package: options?.package,
      tree: options?.tree ? "true" : undefined,
    })}`,
    token,
    {
      errorPrefix: "Failed to fetch remote info",
      allowInsecureHttp: options?.allowInsecureHttp,
      insecure: options?.insecure,
      dispatcher: options?.dispatcher,
    }
  );
}

/**
 * 拉取远端环境体检报告（可定向指定包）。
 */
export async function fetchRemoteDoctor(
  serverUrl: string,
  token?: string,
  targetPackage?: string,
  options?: RemoteClientRequestOptions
): Promise<any> {
  return fetchRemoteJson(
    serverUrl,
    `/api/v2/doctor${buildQueryString({ package: targetPackage })}`,
    token,
    {
      errorPrefix: "Failed to fetch remote doctor report",
      allowInsecureHttp: options?.allowInsecureHttp,
      insecure: options?.insecure,
      dispatcher: options?.dispatcher,
    }
  );
}
