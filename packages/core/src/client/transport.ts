import { isLoopbackHost } from "../utils";
import { getInsecureDispatcher } from "./dispatcher";
import { ActionDockError, INSECURE_TRANSPORT, INVALID_ARGUMENT, NOT_FOUND, REMOTE_REQUEST_FAILED, UNAUTHORIZED } from "../errors";

/**
 * 远端客户端传输层单点。
 *
 * 职责单一聚焦：服务端地址规范化、鉴权头拼装、明文传输安全校验、
 * insecure dispatcher 注入、JSON 响应解析与查询参数序列化，
 * 作为全部远端端点函数的统一传输层单一事实源。
 */

/**
 * 传输层安全豁免控制选项。
 */
export interface SecureTransportOptions {
  /** 是否允许向非回环地址发送明文 HTTP 请求 */
  allowInsecureHttp?: boolean;
  /** 是否跳过 TLS 证书合法性校验 */
  insecure?: boolean;
}

/**
 * 格式化并规范化 Server URL 地址（若未指定协议，本地回环地址默认使用 http://，非本地回环地址默认使用 https://，并移除末尾斜杠）。
 */
export function normalizeServerUrl(url: string): string {
  let cleaned = url.trim().replace(/\/+$/, "");
  if (!cleaned || cleaned === "local") {
    return cleaned;
  }
  if (!/^https?:\/\//i.test(cleaned)) {
    let hostname = cleaned;
    const slashIdx = hostname.indexOf("/");
    if (slashIdx !== -1) {
      hostname = hostname.slice(0, slashIdx);
    }
    if (hostname.startsWith("[")) {
      const endBracket = hostname.indexOf("]");
      if (endBracket !== -1) {
        hostname = hostname.slice(1, endBracket);
      }
    } else {
      const colonIdx = hostname.indexOf(":");
      if (colonIdx !== -1) {
        hostname = hostname.slice(0, colonIdx);
      }
    }
    const isLoopback = isLoopbackHost(hostname);
    cleaned = `${isLoopback ? "http" : "https"}://${cleaned}`;
  }
  return cleaned;
}

/**
 * 脱敏 URL：移除 userinfo 凭据与查询串后再返回；仅保留协议、主机与路径。
 */
function redactUrl(url: string): string {
  let candidate = url;
  try {
    const u = new URL(candidate);
    u.username = "";
    u.password = "";
    u.search = "";
    return u.toString();
  } catch {
    candidate = candidate.replace(/^([a-zA-Z][a-zA-Z0-9+.-]*:\/\/)[^\/@]+@/, "$1");
    return candidate.length > 128 ? `${candidate.slice(0, 128)}...` : candidate;
  }
}

/**
 * 校验在携带认证 Token 时传输层协议与目标地址是否安全。
 * 若请求携带认证 Token 且目标为非本地回环的明文 http://，默认报错拒绝。
 * 可通过 allowInsecureHttp 选项、insecure 选项、环境变量或命令行参数豁免明文限制。
 * 目标 URL 无法解析时无论豁免与否均 fail-closed 抛 INVALID_ARGUMENT。
 */
export function assertSecureTransport(
  serverUrl: string,
  token?: string,
  options?: SecureTransportOptions
): void {
  if (!token || !token.trim()) {
    return;
  }

  const allowInsecureHttp = Boolean(options?.allowInsecureHttp);
  const insecure = Boolean(options?.insecure);

  const allow =
    allowInsecureHttp ||
    insecure ||
    (typeof process !== "undefined" &&
      (process.env?.ACTIONDOCK_ALLOW_INSECURE_HTTP === "true" ||
        process.env?.ACTIONDOCK_ALLOW_INSECURE_HTTP === "1" ||
        process.env?.ACTIONDOCK_INSECURE === "true" ||
        process.env?.ACTIONDOCK_INSECURE === "1"));

  const base = normalizeServerUrl(serverUrl);

  if (base.startsWith("http://") || base.startsWith("https://")) {
    let parsed: URL;
    try {
      parsed = new URL(base);
    } catch (err: any) {
      const reason = err instanceof Error ? err.message : String(err);
      throw new ActionDockError(
        INVALID_ARGUMENT,
        `Invalid server URL '${redactUrl(base)}' with authentication token: URL parse failed (${reason}). Fix the profile server URL before sending credentials.`
      );
    }

    if (!allow && base.startsWith("http://") && !isLoopbackHost(parsed.hostname)) {
      throw new ActionDockError(
        INSECURE_TRANSPORT,
        `Insecure HTTP connection with authentication token to non-loopback host '${parsed.hostname}' is prohibited. Use HTTPS or pass --allow-insecure-http to override.`
      );
    }
  }
}

/**
 * 构造携带鉴权信息的标准请求头。
 */
export function buildHeaders(token?: string): Record<string, string> {
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
  /** 取消信号，用于中止 HTTP 请求 */
  signal?: AbortSignal;
}

/** 远端请求描述选项。 */
export interface RemoteFetchInit {
  /** HTTP 方法（默认 GET） */
  method?: string;
  /** JSON 序列化请求体 */
  body?: unknown;
  /** 额外合并的请求头 */
  headers?: Record<string, string>;
  /** 中断信号 */
  signal?: AbortSignal;
}

/**
 * 构建绑定传输上下文（Token、安全选项与调度器）的远端请求函数。
 */
export function createRemoteFetch(
  serverUrl: string,
  token?: string,
  options?: RemoteClientRequestOptions
): (path: string, init?: RemoteFetchInit) => Promise<Response> {
  assertSecureTransport(serverUrl, token, {
    allowInsecureHttp: options?.allowInsecureHttp,
    insecure: options?.insecure,
  });
  const base = normalizeServerUrl(serverUrl);
  const headers = buildHeaders(token);

  return async (path: string, init: RemoteFetchInit = {}): Promise<Response> => {
    const method = init.method || "GET";
    const mergedHeaders: Record<string, string> = { ...headers };
    if (init.body !== undefined || init.headers) {
      for (const [k, v] of Object.entries(init.headers || {})) {
        mergedHeaders[k] = v;
      }
      if (init.body !== undefined) {
        mergedHeaders["Content-Type"] = mergedHeaders["Content-Type"] || "application/json";
      }
    }

    const fetchInit: RequestInit & { dispatcher?: any } = {
      method,
      headers: mergedHeaders,
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
      signal: init.signal,
    };
    if (options?.dispatcher) {
      fetchInit.dispatcher = options.dispatcher;
    } else if (options?.insecure) {
      fetchInit.dispatcher = getInsecureDispatcher();
      (fetchInit as any).tls = { rejectUnauthorized: false };
    }

    return fetchRemoteRoute(base, path, fetchInit);
  };
}

/**
 * 远端请求底层入口：执行目标协议路由请求。
 */
export async function fetchRemoteRoute(
  base: string,
  path: string,
  init: RequestInit & { dispatcher?: any }
): Promise<Response> {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return fetch(`${base}${normalizedPath}`, init);
}

/**
 * 执行远端请求并将响应解析为 JSON，统一处理错误信封透传。
 */
export async function fetchRemoteJson<T = any>(
  serverUrl: string,
  path: string,
  token?: string,
  options: {
    method?: string;
    body?: unknown;
    errorPrefix?: string;
  } & RemoteClientRequestOptions = {}
): Promise<T> {
  const remoteFetch = createRemoteFetch(serverUrl, token, {
    allowInsecureHttp: options.allowInsecureHttp,
    insecure: options.insecure,
    dispatcher: options.dispatcher,
  });
  const res = await remoteFetch(path, {
    method: options.method,
    body: options.body,
    signal: options.signal,
  });

  const data = (await res.json().catch(() => ({}))) as any;

  if (!res.ok || (options.method === "POST" && data && data.ok === false)) {
    const errorPrefix = options.errorPrefix || "Remote request failed";
    const msg = data?.error?.message || `${errorPrefix} (${res.status}): ${res.statusText}`;
    const code =
      data?.error?.code ||
      (res.status === 404 ? NOT_FOUND : res.status === 401 ? UNAUTHORIZED : REMOTE_REQUEST_FAILED);
    const details = data?.error?.details ?? data?.error;
    const err = new ActionDockError(code, msg, details, res.status);
    (err as any).errorData = data?.error;
    throw err;
  }

  return data as T;
}

/**
 * 由可选参数字典构造查询串（无参数时返回空串）。
 * 过滤 undefined 与空串。
 */
export function buildQueryString(
  params: Record<string, string | number | boolean | readonly (string | number | boolean)[] | undefined>
): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === "") {
      continue;
    }
    if (Array.isArray(value)) {
      for (const item of value) {
        if (item !== undefined && item !== "") {
          search.append(key, String(item));
        }
      }
      continue;
    }
    search.set(key, String(value));
  }
  const qs = search.toString();
  return qs ? `?${qs}` : "";
}

/**
 * 构造保留空串语义的查询串：仅跳过 undefined，保留空串。
 */
export function buildQueryStringPreservingEmpty(
  params: Record<string, string | number | boolean | readonly (string | number | boolean)[] | undefined>
): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined) {
      continue;
    }
    if (Array.isArray(value)) {
      for (const item of value) {
        if (item !== undefined) {
          search.append(key, String(item));
        }
      }
      continue;
    }
    search.set(key, String(value));
  }
  const qs = search.toString();
  return qs ? `?${qs}` : "";
}
