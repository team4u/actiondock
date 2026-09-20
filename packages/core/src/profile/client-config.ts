import type { RemoteClientRequestOptions } from "./client-transport";
import { buildQueryString, fetchRemoteJson } from "./client-query";

/**
 * 远端配置域端点。
 */

/**
 * 拉取远端配置视图（可定向指定包）。
 */
export async function fetchRemoteConfig(
  serverUrl: string,
  token?: string,
  packageId?: string,
  options?: RemoteClientRequestOptions
): Promise<any> {
  return fetchRemoteJson(
    serverUrl,
    `/api/v2/config${buildQueryString({ package: packageId })}`,
    token,
    {
      errorPrefix: "Failed to fetch remote config",
      allowInsecureHttp: options?.allowInsecureHttp,
      insecure: options?.insecure,
      dispatcher: options?.dispatcher,
    }
  );
}

/**
 * 写入单个远端配置键值。
 */
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

/**
 * 删除单个远端配置键。
 */
export async function deleteRemoteConfig(
  serverUrl: string,
  key: string,
  token?: string,
  packageId?: string,
  options?: RemoteClientRequestOptions
): Promise<any> {
  return fetchRemoteJson(
    serverUrl,
    `/api/v2/config/${encodeURIComponent(key)}${buildQueryString({ package: packageId })}`,
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

/**
 * 拉取远端配置环境变量检查结果（可定向指定包）。
 */
export async function fetchRemoteConfigEnv(
  serverUrl: string,
  token?: string,
  packageId?: string,
  options?: RemoteClientRequestOptions
): Promise<any> {
  return fetchRemoteJson(
    serverUrl,
    `/api/v2/config/env${buildQueryString({ package: packageId })}`,
    token,
    {
      errorPrefix: "Failed to fetch remote config env checks",
      allowInsecureHttp: options?.allowInsecureHttp,
      insecure: options?.insecure,
      dispatcher: options?.dispatcher,
    }
  );
}
