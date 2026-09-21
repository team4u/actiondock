import { normalizeServerUrl } from "./manager";
import type { RemoteHealthResult } from "./types";
import {
  assertSecureTransport,
  buildHeaders,
  fetchWithProtocolFallback,
  type RemoteClientRequestOptions,
} from "./client-transport";
import { getInsecureDispatcher } from "../server/dispatcher";

/**
 * 远端健康检查域端点。
 */

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
      (fetchInit as any).tls = { rejectUnauthorized: false };
    }

    const res = await fetchWithProtocolFallback(normalizeServerUrl(serverUrl), "/api/v2/health", fetchInit);

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
