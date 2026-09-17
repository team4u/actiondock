import { randomUUID } from "node:crypto";
import type { ExecutionResult, RunRecord } from "@actiondock/sdk";
import { normalizeServerUrl } from "./manager";
import type { RemoteHealthResult } from "./types";
import { ACTION_CANCELLED, ACTION_TIMEOUT, NETWORK_ERROR } from "../errors";
import { isLoopbackHost } from "../server/security";
import { getInsecureDispatcher } from "../server/dispatcher";

/**
 * 校验在携带认证 Token 时传输层协议是否安全。
 * 若请求携带认证 Token 且目标为非本地回环的明文 http://，默认报错拒绝。
 * 可通过 allowInsecureHttp 选项、insecure 选项、环境变量或命令行参数豁免。
 */
export function assertSecureTransport(
  serverUrl: string,
  token?: string,
  allowInsecureHttpOrOptions?: boolean | { allowInsecureHttp?: boolean; insecure?: boolean },
  insecureArg?: boolean
): void {
  if (!token || !token.trim()) {
    return;
  }

  let allowInsecureHttp = false;
  let insecure = false;
  if (typeof allowInsecureHttpOrOptions === "object" && allowInsecureHttpOrOptions !== null) {
    allowInsecureHttp = Boolean(allowInsecureHttpOrOptions.allowInsecureHttp);
    insecure = Boolean(allowInsecureHttpOrOptions.insecure);
  } else {
    allowInsecureHttp = Boolean(allowInsecureHttpOrOptions);
    insecure = Boolean(insecureArg);
  }

  const allow =
    allowInsecureHttp ||
    insecure ||
    (typeof process !== "undefined" &&
      (process.env?.ACTIONDOCK_ALLOW_INSECURE_HTTP === "true" ||
        process.env?.ACTIONDOCK_ALLOW_INSECURE_HTTP === "1" ||
        process.env?.ACTIONDOCK_INSECURE === "true" ||
        process.env?.ACTIONDOCK_INSECURE === "1"));

  if (allow) {
    return;
  }

  const base = normalizeServerUrl(serverUrl);
  if (base.startsWith("http://")) {
    try {
      const parsed = new URL(base);
      if (!isLoopbackHost(parsed.hostname)) {
        const err = new Error(
          `Insecure HTTP connection with authentication token to non-loopback host '${parsed.hostname}' is prohibited. Use HTTPS or pass --allow-insecure-http to override.`
        );
        (err as any).code = "INSECURE_TRANSPORT";
        throw err;
      }
    } catch (e: any) {
      if (e.code === "INSECURE_TRANSPORT") {
        throw e;
      }
    }
  }
}

function buildHeaders(token?: string): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: "application/json",
  };
  if (token && token.trim()) {
    headers.Authorization = `Bearer ${token.trim()}`;
  }
  return headers;
}

/**
 * 远端请求通用控制选项。
 */
export interface RemoteClientRequestOptions {
  /** 是否允许通过非回环明文 HTTP 发送认证 Token */
  allowInsecureHttp?: boolean;
  /** 是否跳过服务端 TLS 证书合法性校验 */
  insecure?: boolean;
  /** 自定义底层 HTTP 调度器（平台中立） */
  dispatcher?: unknown;
}

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
 * 探测指定远端 ActionDock 服务的健康状态与网络延迟。
 * 
 * @param serverUrl 目标服务端地址
 * @param token 鉴权 Token（可选）
 * @param timeoutMs 探测超时时间（默认 5000ms）
 * @param options 传输与安全控制选项
 */
export async function checkRemoteHealth(
  serverUrl: string,
  token?: string,
  timeoutMs: number = 5000,
  options?: RemoteClientRequestOptions
): Promise<RemoteHealthResult> {
  const startTime = Date.now();
  let timer: ReturnType<typeof setTimeout> | undefined;

  try {
    assertSecureTransport(serverUrl, token, {
      allowInsecureHttp: options?.allowInsecureHttp,
      insecure: options?.insecure,
    });
    const base = normalizeServerUrl(serverUrl);
    const v2Url = `${base}/api/v2/health`;

    const controller = new AbortController();
    timer = setTimeout(() => controller.abort(), timeoutMs);

    const fetchInit: RequestInit & { dispatcher?: any } = {
      method: "GET",
      headers: buildHeaders(token),
      signal: controller.signal,
    };
    if (options?.dispatcher) {
      fetchInit.dispatcher = options.dispatcher;
    } else if (options?.insecure) {
      fetchInit.dispatcher = getInsecureDispatcher();
    }

    let res = await fetch(v2Url, fetchInit);

    if (res.status === 404) {
      try {
        const v1Res = await fetch(`${base}/api/v1/health`, fetchInit);
        if (v1Res.ok || v1Res.status !== 404) {
          res = v1Res;
        }
      } catch {}
    }

    const latencyMs = Date.now() - startTime;

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return {
        ok: false,
        latencyMs,
        error: `Server responded with status ${res.status}: ${text || res.statusText}`,
      };
    }

    const data = (await res.json().catch(() => ({}))) as any;
    return {
      ok: true,
      status: data.status || "healthy",
      version: data.version,
      uptime: data.uptime,
      latencyMs,
    };
  } catch (err: any) {
    const latencyMs = Date.now() - startTime;
    return {
      ok: false,
      latencyMs,
      error: err.name === "AbortError" ? "Connection timed out" : err.message,
    };
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  }
}

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
  const base = normalizeServerUrl(serverUrl);
  const v2Url = `${base}/api/v2/actions/${encodeURIComponent(actionId)}/run`;

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
      res = await fetch(v2Url, fetchInit);

      if (res.status === 404) {
        try {
          const v1Res = await fetch(`${base}/api/v1/actions/${encodeURIComponent(actionId)}/run`, fetchInit);
          if (v1Res.ok || v1Res.status !== 404) {
            res = v1Res;
          }
        } catch {}
      }
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

async function fetchRemoteJson<T = any>(
  serverUrl: string,
  path: string,
  token?: string,
  options: {
    method?: string;
    body?: unknown;
    errorPrefix?: string;
  } & RemoteClientRequestOptions = {}
): Promise<T> {
  assertSecureTransport(serverUrl, token, {
    allowInsecureHttp: options.allowInsecureHttp,
    insecure: options.insecure,
  });
  const base = normalizeServerUrl(serverUrl);
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  const url = `${base}${normalizedPath}`;
  const method = options.method || "GET";
  const headers: Record<string, string> = {
    ...buildHeaders(token),
  };
  if (options.body !== undefined) {
    headers["Content-Type"] = "application/json";
  }

  const fetchInit: RequestInit & { dispatcher?: any } = {
    method,
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  };
  if (options.dispatcher) {
    fetchInit.dispatcher = options.dispatcher;
  } else if (options.insecure) {
    fetchInit.dispatcher = getInsecureDispatcher();
  }

  let res = await fetch(url, fetchInit);

  if (res.status === 404 && normalizedPath.startsWith("/api/v2/")) {
    const v1Path = normalizedPath.replace("/api/v2/", "/api/v1/");
    try {
      const v1Res = await fetch(`${base}${v1Path}`, fetchInit);
      if (v1Res.ok || v1Res.status !== 404) {
        res = v1Res;
      }
    } catch {}
  }

  const data = (await res.json().catch(() => ({}))) as any;

  if (!res.ok || (options.method === "POST" && data && data.ok === false)) {
    const errorPrefix = options.errorPrefix || "Remote request failed";
    const msg = data?.error?.message || `${errorPrefix} (${res.status}): ${res.statusText}`;
    const err = new Error(msg);
    if (data?.error?.code) {
      (err as any).code = data.error.code;
    }
    (err as any).status = res.status;
    (err as any).errorData = data?.error;
    (err as any).details = data?.error?.details ?? data?.error;
    throw err;
  }

  return data as T;
}

export async function fetchRemoteRun(
  serverUrl: string,
  runId: string,
  token?: string,
  options?: RemoteClientRequestOptions
): Promise<RunRecord> {
  return fetchRemoteJson<RunRecord>(
    serverUrl,
    `/api/v2/runs/${encodeURIComponent(runId)}`,
    token,
    {
      errorPrefix: `Failed to fetch remote run '${runId}'`,
      allowInsecureHttp: options?.allowInsecureHttp,
      insecure: options?.insecure,
      dispatcher: options?.dispatcher,
    }
  );
}

export async function cancelRemoteRun(
  serverUrl: string,
  runId: string,
  token?: string,
  reason?: string,
  options?: RemoteClientRequestOptions
): Promise<{ ok: boolean; runId: string; status: string }> {
  return fetchRemoteJson(
    serverUrl,
    `/api/v2/runs/${encodeURIComponent(runId)}/cancel`,
    token,
    {
      method: "POST",
      body: { reason },
      errorPrefix: `Failed to cancel remote run '${runId}'`,
      allowInsecureHttp: options?.allowInsecureHttp,
      insecure: options?.insecure,
      dispatcher: options?.dispatcher,
    }
  );
}

export async function fetchRemoteActions(
  serverUrl: string,
  token?: string,
  intent?: string,
  options?: RemoteClientRequestOptions
): Promise<Array<{ id: string; description: string; packageId?: string }>> {
  const query = intent ? `?intent=${encodeURIComponent(intent)}` : "";
  return fetchRemoteJson(
    serverUrl,
    `/api/v2/actions${query}`,
    token,
    {
      errorPrefix: "Failed to fetch remote actions",
      allowInsecureHttp: options?.allowInsecureHttp,
      insecure: options?.insecure,
      dispatcher: options?.dispatcher,
    }
  );
}

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

export async function fetchRemoteInfo(
  serverUrl: string,
  token?: string,
  options?: { intent?: string; package?: string; tree?: boolean } & RemoteClientRequestOptions
): Promise<any> {
  const params = new URLSearchParams();
  if (options?.intent) params.set("intent", options.intent);
  if (options?.package) params.set("package", options.package);
  if (options?.tree) params.set("tree", "true");
  const qs = params.toString() ? `?${params.toString()}` : "";
  return fetchRemoteJson(
    serverUrl,
    `/api/v2/info${qs}`,
    token,
    {
      errorPrefix: "Failed to fetch remote info",
      allowInsecureHttp: options?.allowInsecureHttp,
      insecure: options?.insecure,
      dispatcher: options?.dispatcher,
    }
  );
}

export async function fetchRemoteDoctor(
  serverUrl: string,
  token?: string,
  targetPackage?: string,
  options?: RemoteClientRequestOptions
): Promise<any> {
  const query = targetPackage ? `?package=${encodeURIComponent(targetPackage)}` : "";
  return fetchRemoteJson(
    serverUrl,
    `/api/v2/doctor${query}`,
    token,
    {
      errorPrefix: "Failed to fetch remote doctor report",
      allowInsecureHttp: options?.allowInsecureHttp,
      insecure: options?.insecure,
      dispatcher: options?.dispatcher,
    }
  );
}

export async function fetchRemotePlaybooks(
  serverUrl: string,
  token?: string,
  options?: { intent?: string; package?: string } & RemoteClientRequestOptions
): Promise<Array<{ id: string; description: string; actions: string[]; packageId: string; filePath: string }>> {
  const params = new URLSearchParams();
  if (options?.intent) params.set("intent", options.intent);
  if (options?.package) params.set("package", options.package);
  const qs = params.toString() ? `?${params.toString()}` : "";
  return fetchRemoteJson(
    serverUrl,
    `/api/v2/playbooks${qs}`,
    token,
    {
      errorPrefix: "Failed to fetch remote playbooks",
      allowInsecureHttp: options?.allowInsecureHttp,
      insecure: options?.insecure,
      dispatcher: options?.dispatcher,
    }
  );
}

export async function fetchRemotePlaybookShow(
  playbookId: string,
  token?: string,
  options?: RemoteClientRequestOptions
): Promise<any>;
export async function fetchRemotePlaybookShow(
  serverUrl: string,
  playbookId: string,
  token?: string,
  options?: RemoteClientRequestOptions
): Promise<any>;
export async function fetchRemotePlaybookShow(
  serverUrlOrPlaybookId: string,
  playbookIdOrToken?: string,
  tokenOrOptions?: string | RemoteClientRequestOptions,
  optionsArg?: RemoteClientRequestOptions
): Promise<any> {
  let serverUrl = serverUrlOrPlaybookId;
  let playbookId = playbookIdOrToken || "";
  let token: string | undefined;
  let options: RemoteClientRequestOptions | undefined = optionsArg;

  if (typeof tokenOrOptions === "object") {
    options = tokenOrOptions;
  } else if (typeof tokenOrOptions === "string") {
    token = tokenOrOptions;
  }

  return fetchRemoteJson(
    serverUrl,
    `/api/v2/playbooks/${encodeURIComponent(playbookId)}`,
    token,
    {
      errorPrefix: `Failed to fetch remote playbook '${playbookId}'`,
      allowInsecureHttp: options?.allowInsecureHttp,
      insecure: options?.insecure,
      dispatcher: options?.dispatcher,
    }
  );
}

export async function fetchRemoteRuns(
  serverUrl: string,
  token?: string,
  options?: { status?: string; actionId?: string; packageId?: string; intent?: string; limit?: number } & RemoteClientRequestOptions
): Promise<{ ok: boolean; total: number; items: RunRecord[] }> {
  const params = new URLSearchParams();
  if (options?.status) params.set("status", options.status);
  if (options?.actionId) params.set("actionId", options.actionId);
  if (options?.packageId) params.set("packageId", options.packageId);
  if (options?.intent) params.set("intent", options.intent);
  if (options?.limit) params.set("limit", String(options.limit));
  const qs = params.toString() ? `?${params.toString()}` : "";
  return fetchRemoteJson(
    serverUrl,
    `/api/v2/runs${qs}`,
    token,
    {
      errorPrefix: "Failed to fetch remote runs",
      allowInsecureHttp: options?.allowInsecureHttp,
      insecure: options?.insecure,
      dispatcher: options?.dispatcher,
    }
  );
}

export async function clearRemoteRuns(
  serverUrl: string,
  token?: string,
  options?: { packageId?: string; actionId?: string; status?: string } & RemoteClientRequestOptions
): Promise<{ ok: boolean; clearedCount: number }> {
  return fetchRemoteJson(
    serverUrl,
    "/api/v2/runs/clear",
    token,
    {
      method: "POST",
      body: options || {},
      errorPrefix: "Failed to clear remote runs",
      allowInsecureHttp: options?.allowInsecureHttp,
      insecure: options?.insecure,
      dispatcher: options?.dispatcher,
    }
  );
}

export async function fetchRemoteStateList(
  serverUrl: string,
  token?: string,
  options?: { package?: string; action?: string; namespace?: string; prefix?: string } & RemoteClientRequestOptions
): Promise<{ ok: boolean; packageId: string; keys: string[] }> {
  const params = new URLSearchParams();
  if (options?.package) params.set("package", options.package);
  if (options?.action) params.set("action", options.action);
  if (options?.namespace !== undefined) params.set("namespace", options.namespace);
  if (options?.prefix) params.set("prefix", options.prefix);
  const qs = params.toString() ? `?${params.toString()}` : "";
  return fetchRemoteJson(
    serverUrl,
    `/api/v2/state${qs}`,
    token,
    {
      errorPrefix: "Failed to list remote state keys",
      allowInsecureHttp: options?.allowInsecureHttp,
      insecure: options?.insecure,
      dispatcher: options?.dispatcher,
    }
  );
}

export async function getRemoteStateKey(
  serverUrl: string,
  key: string,
  token?: string,
  options?: { package?: string; action?: string; namespace?: string } & RemoteClientRequestOptions
): Promise<any> {
  const params = new URLSearchParams();
  if (options?.package) params.set("package", options.package);
  if (options?.action) params.set("action", options.action);
  if (options?.namespace !== undefined) params.set("namespace", options.namespace);
  const qs = params.toString() ? `?${params.toString()}` : "";
  return fetchRemoteJson(
    serverUrl,
    `/api/v2/state/${encodeURIComponent(key)}${qs}`,
    token,
    {
      errorPrefix: `Failed to fetch remote state key '${key}'`,
      allowInsecureHttp: options?.allowInsecureHttp,
      insecure: options?.insecure,
      dispatcher: options?.dispatcher,
    }
  );
}

export async function setRemoteStateKey(
  serverUrl: string,
  key: string,
  value: unknown,
  token?: string,
  options?: { package?: string; action?: string; namespace?: string; ttl?: number } & RemoteClientRequestOptions
): Promise<any> {
  return fetchRemoteJson(
    serverUrl,
    `/api/v2/state/${encodeURIComponent(key)}`,
    token,
    {
      method: "PUT",
      body: {
        value,
        package: options?.package,
        action: options?.action,
        namespace: options?.namespace,
        ttl: options?.ttl,
      },
      errorPrefix: `Failed to set remote state key '${key}'`,
      allowInsecureHttp: options?.allowInsecureHttp,
      insecure: options?.insecure,
      dispatcher: options?.dispatcher,
    }
  );
}

export async function deleteRemoteStateKey(
  serverUrl: string,
  key: string,
  token?: string,
  options?: { package?: string; action?: string; namespace?: string } & RemoteClientRequestOptions
): Promise<any> {
  const params = new URLSearchParams();
  if (options?.package) params.set("package", options.package);
  if (options?.action) params.set("action", options.action);
  if (options?.namespace !== undefined) params.set("namespace", options.namespace);
  const qs = params.toString() ? `?${params.toString()}` : "";
  return fetchRemoteJson(
    serverUrl,
    `/api/v2/state/${encodeURIComponent(key)}${qs}`,
    token,
    {
      method: "DELETE",
      errorPrefix: `Failed to delete remote state key '${key}'`,
      allowInsecureHttp: options?.allowInsecureHttp,
      insecure: options?.insecure,
      dispatcher: options?.dispatcher,
    }
  );
}

export async function clearRemoteState(
  serverUrl: string,
  token?: string,
  options?: { package?: string; action?: string; namespace?: string; prefix?: string; all?: boolean } & RemoteClientRequestOptions
): Promise<{ ok: boolean; packageId: string; clearedCount: number }> {
  return fetchRemoteJson(
    serverUrl,
    "/api/v2/state/clear",
    token,
    {
      method: "POST",
      body: options || {},
      errorPrefix: "Failed to clear remote state",
      allowInsecureHttp: options?.allowInsecureHttp,
      insecure: options?.insecure,
      dispatcher: options?.dispatcher,
    }
  );
}

export async function fetchRemoteConfig(
  serverUrl: string,
  token?: string,
  packageId?: string,
  options?: RemoteClientRequestOptions
): Promise<any> {
  const query = packageId ? `?package=${encodeURIComponent(packageId)}` : "";
  return fetchRemoteJson(
    serverUrl,
    `/api/v2/config${query}`,
    token,
    {
      errorPrefix: "Failed to fetch remote config",
      allowInsecureHttp: options?.allowInsecureHttp,
      insecure: options?.insecure,
      dispatcher: options?.dispatcher,
    }
  );
}

export async function setRemoteConfig(
  serverUrl: string,
  key: string,
  value: unknown,
  token?: string,
  packageId?: string,
  options?: RemoteClientRequestOptions
): Promise<any> {
  return fetchRemoteJson(
    serverUrl,
    "/api/v2/config",
    token,
    {
      method: "PUT",
      body: { key, value, package: packageId },
      errorPrefix: `Failed to set remote config '${key}'`,
      allowInsecureHttp: options?.allowInsecureHttp,
      insecure: options?.insecure,
      dispatcher: options?.dispatcher,
    }
  );
}

export async function deleteRemoteConfig(
  serverUrl: string,
  key: string,
  token?: string,
  packageId?: string,
  options?: RemoteClientRequestOptions
): Promise<any> {
  const query = packageId ? `?package=${encodeURIComponent(packageId)}` : "";
  return fetchRemoteJson(
    serverUrl,
    `/api/v2/config/${encodeURIComponent(key)}${query}`,
    token,
    {
      method: "DELETE",
      errorPrefix: `Failed to delete remote config '${key}'`,
      allowInsecureHttp: options?.allowInsecureHttp,
      insecure: options?.insecure,
      dispatcher: options?.dispatcher,
    }
  );
}

export async function fetchRemoteConfigEnv(
  serverUrl: string,
  token?: string,
  packageId?: string,
  options?: RemoteClientRequestOptions
): Promise<any> {
  const query = packageId ? `?package=${encodeURIComponent(packageId)}` : "";
  return fetchRemoteJson(
    serverUrl,
    `/api/v2/config/env${query}`,
    token,
    {
      errorPrefix: "Failed to fetch remote config env checks",
      allowInsecureHttp: options?.allowInsecureHttp,
      insecure: options?.insecure,
      dispatcher: options?.dispatcher,
    }
  );
}
