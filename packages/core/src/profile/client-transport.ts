import { isLoopbackHost } from "../utils/net";
import { normalizeServerUrl } from "./manager";
import { getInsecureDispatcher } from "../server/dispatcher";
import { ActionDockError, INSECURE_TRANSPORT } from "../errors";

/**
 * 远端客户端传输层。
 *
 * 职责单一聚焦：鉴权头拼装、明文传输安全校验与 insecure dispatcher 注入，
 * 作为全部远端端点函数的传输样板单一事实源。
 */

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
        throw new ActionDockError(
          INSECURE_TRANSPORT,
          `Insecure HTTP connection with authentication token to non-loopback host '${parsed.hostname}' is prohibited. Use HTTPS or pass --allow-insecure-http to override.`
        );
      }
    } catch (e: any) {
      if (e instanceof ActionDockError || e?.code === INSECURE_TRANSPORT) {
        throw e;
      }
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
 *
 * 单一事实源收敛所有 fetchRemoteXxx 端点的传输样板：
 * 调用方仅需声明 path 与查询参数，鉴权头拼装、明文传输校验与
 * insecure dispatcher 注入均在此统一处理。
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

    return fetchWithProtocolFallback(base, path, fetchInit);
  };
}

/**
 * 远端请求单一入口：执行目标协议路由请求。
 */
export async function fetchWithProtocolFallback(
  base: string,
  path: string,
  init: RequestInit & { dispatcher?: any }
): Promise<Response> {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return fetch(`${base}${normalizedPath}`, init);
}

/**
 * 列出指定路由的协议版本候选 URL。
 */
export function listProtocolRouteCandidates(base: string, path: string): string[] {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return [`${base}${normalizedPath}`];
}
