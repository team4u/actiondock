import type { RemoteClientRequestOptions } from "./client-transport";
import { buildQueryStringPreservingEmpty, fetchRemoteJson } from "./client-query";

/**
 * 远端状态存储域端点。
 */

/**
 * 列出远端状态键（可按包、Action、命名空间与前缀过滤）。
 */
export async function fetchRemoteStateList(
  serverUrl: string,
  token?: string,
  options?: { package?: string; action?: string; namespace?: string; prefix?: string } & RemoteClientRequestOptions
): Promise<{ ok: boolean; packageId: string; keys: string[] }> {
  return fetchRemoteJson(
    serverUrl,
    `/api/v2/state${buildQueryStringPreservingEmpty({
      package: options?.package,
      action: options?.action,
      namespace: options?.namespace,
      prefix: options?.prefix,
    })}`,
    token,
    {
      errorPrefix: "Failed to list remote state keys",
      allowInsecureHttp: options?.allowInsecureHttp,
      insecure: options?.insecure,
      dispatcher: options?.dispatcher,
    }
  );
}

/**
 * 读取单个远端状态键的值。
 */
export async function getRemoteStateKey(
  serverUrl: string,
  key: string,
  token?: string,
  options?: { package?: string; action?: string; namespace?: string } & RemoteClientRequestOptions
): Promise<any> {
  return fetchRemoteJson(
    serverUrl,
    `/api/v2/state/${encodeURIComponent(key)}${buildQueryStringPreservingEmpty({
      package: options?.package,
      action: options?.action,
      namespace: options?.namespace,
    })}`,
    token,
    {
      errorPrefix: `Failed to fetch remote state key '${key}'`,
      allowInsecureHttp: options?.allowInsecureHttp,
      insecure: options?.insecure,
      dispatcher: options?.dispatcher,
    }
  );
}

/**
 * 写入单个远端状态键（可携带 TTL 过期时间）。
 */
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

/**
 * 删除单个远端状态键。
 */
export async function deleteRemoteStateKey(
  serverUrl: string,
  key: string,
  token?: string,
  options?: { package?: string; action?: string; namespace?: string } & RemoteClientRequestOptions
): Promise<any> {
  return fetchRemoteJson(
    serverUrl,
    `/api/v2/state/${encodeURIComponent(key)}${buildQueryStringPreservingEmpty({
      package: options?.package,
      action: options?.action,
      namespace: options?.namespace,
    })}`,
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

/**
 * 批量清除远端状态键（可按包、Action、命名空间、前缀与全量标志过滤）。
 */
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
