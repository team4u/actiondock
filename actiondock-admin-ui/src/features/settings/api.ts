import { JSON_HEADERS, request } from "../../shared/api/httpClient";
import type {
  AccessToken,
  AccessTokenRequest,
  ConfigValue,
  ConfigValueDetail,
  ConfigValueRequest,
  SharedStateCompareAndSetRequest,
  SharedStateCompareAndSetResult,
  SharedStateDetail,
  SharedStateRequest,
  SharedStateSummary
} from "../../shared/types";

export function listConfigValues(): Promise<ConfigValue[]> {
  return request<ConfigValue[]>("/api/config-values");
}

export function getConfigValue(key: string): Promise<ConfigValueDetail> {
  return request<ConfigValueDetail>(`/api/config-values/${encodeURIComponent(key)}`);
}

export function createConfigValue(payload: ConfigValueRequest): Promise<ConfigValue> {
  return request<ConfigValue>("/api/config-values", {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify(payload)
  });
}

export function updateConfigValue(key: string, payload: ConfigValueRequest): Promise<ConfigValue> {
  return request<ConfigValue>(`/api/config-values/${encodeURIComponent(key)}`, {
    method: "PUT",
    headers: JSON_HEADERS,
    body: JSON.stringify(payload)
  });
}

export function deleteConfigValue(key: string): Promise<void> {
  return request<void>(`/api/config-values/${encodeURIComponent(key)}`, {
    method: "DELETE"
  });
}

export function copyConfigValueAsLocalOverride(key: string): Promise<ConfigValueDetail> {
  return request<ConfigValueDetail>(`/api/config-values/${encodeURIComponent(key)}/copy-local-override`, {
    method: "POST"
  });
}

export function restoreConfigValueRepositoryDefault(key: string): Promise<ConfigValueDetail> {
  return request<ConfigValueDetail>(`/api/config-values/${encodeURIComponent(key)}/restore-repository-default`, {
    method: "POST"
  });
}

export function listSharedStateNamespaces(): Promise<string[]> {
  return request<string[]>("/api/shared-state/namespaces");
}

export function listSharedState(namespace: string): Promise<SharedStateSummary[]> {
  const params = new URLSearchParams({ namespace });
  return request<SharedStateSummary[]>(`/api/shared-state?${params.toString()}`);
}

export function getSharedState(namespace: string, key: string): Promise<SharedStateDetail> {
  const params = new URLSearchParams({ namespace, key });
  return request<SharedStateDetail>(`/api/shared-state/detail?${params.toString()}`);
}

export function createSharedState(payload: SharedStateRequest): Promise<SharedStateDetail> {
  return request<SharedStateDetail>("/api/shared-state", {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify(payload)
  });
}

export function updateSharedState(payload: SharedStateRequest): Promise<SharedStateDetail> {
  return request<SharedStateDetail>("/api/shared-state", {
    method: "PUT",
    headers: JSON_HEADERS,
    body: JSON.stringify(payload)
  });
}

export function compareAndSetSharedState(payload: SharedStateCompareAndSetRequest): Promise<SharedStateCompareAndSetResult> {
  return request<SharedStateCompareAndSetResult>("/api/shared-state/cas", {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify(payload)
  });
}

export function deleteSharedState(namespace: string, key: string): Promise<void> {
  const params = new URLSearchParams({ namespace, key });
  return request<void>(`/api/shared-state?${params.toString()}`, {
    method: "DELETE"
  });
}

export function purgeExpiredSharedState(namespace?: string): Promise<number> {
  const params = new URLSearchParams();
  if (namespace) {
    params.set("namespace", namespace);
  }
  const suffix = params.size > 0 ? `?${params.toString()}` : "";
  return request<number>(`/api/shared-state/purge-expired${suffix}`, {
    method: "POST"
  });
}

export function listAccessTokens(): Promise<AccessToken[]> {
  return request<AccessToken[]>("/api/access-tokens");
}

export function createAccessToken(payload: AccessTokenRequest): Promise<AccessToken> {
  return request<AccessToken>("/api/access-tokens", {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify(payload)
  });
}

export function updateAccessToken(id: string, payload: AccessTokenRequest): Promise<AccessToken> {
  return request<AccessToken>(`/api/access-tokens/${encodeURIComponent(id)}`, {
    method: "PUT",
    headers: JSON_HEADERS,
    body: JSON.stringify(payload)
  });
}

export function enableAccessToken(id: string): Promise<AccessToken> {
  return request<AccessToken>(`/api/access-tokens/${encodeURIComponent(id)}/enable`, {
    method: "POST"
  });
}

export function disableAccessToken(id: string): Promise<AccessToken> {
  return request<AccessToken>(`/api/access-tokens/${encodeURIComponent(id)}/disable`, {
    method: "POST"
  });
}

export function deleteAccessToken(id: string): Promise<void> {
  return request<void>(`/api/access-tokens/${encodeURIComponent(id)}`, {
    method: "DELETE"
  });
}
