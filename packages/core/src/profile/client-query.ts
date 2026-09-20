import { createRemoteFetch, type RemoteClientRequestOptions } from "./client-transport";

/**
 * 远端端点函数共享的请求与查询构造层。
 *
 * 职责单一聚焦：JSON 响应解析与错误信封透传、查询参数序列化，
 * 供各按域端点模块复用，杜绝端点函数内手工拼 query 样板。
 */

/**
 * 执行远端请求并将响应解析为 JSON，统一处理错误信封透传。
 * 非 2xx 响应或显式 ok=false 信封抛出携带 code/status/details 的 Error。
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
  });

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

/**
 * 由可选参数字典构造查询串（无参数时返回空串）。
 *
 * 序列化规则与既有端点行为严格一致：
 * - undefined 与空串一律跳过（对应原有 if (options?.xxx) 真值守卫）；
 * - 需保留「存在但为空」语义的参数（如 namespace，服务端区分空串与未传递）
 *   由调用方显式处理，不经由此助手序列化空串。
 */
export function buildQueryString(
  params: Record<string, string | number | boolean | undefined>
): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === "") {
      continue;
    }
    search.set(key, String(value));
  }
  const qs = search.toString();
  return qs ? `?${qs}` : "";
}

/**
 * 构造保留「存在但为空」语义的查询串：仅跳过 undefined，空串照常序列化。
 * 适用 namespace 类参数：服务端以参数是否存在区分空命名空间与默认命名空间。
 */
export function buildQueryStringPreservingEmpty(
  params: Record<string, string | number | boolean | undefined>
): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined) {
      continue;
    }
    search.set(key, String(value));
  }
  const qs = search.toString();
  return qs ? `?${qs}` : "";
}
