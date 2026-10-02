import { getInsecureDispatcher } from "./dispatcher";
import {
  assertSecureTransport,
  buildHeaders,
  fetchRemoteRoute,
  normalizeServerUrl,
  type RemoteClientRequestOptions,
} from "./transport";
import { type Clock, SystemClock } from "../storage/clock";

/** 模块级默认时钟实例 */
const defaultClock: Clock = new SystemClock();

/**
 * 远端服务器健康探测与时延检测结果。
 */
export interface RemoteHealthResult {
  /** 服务端是否连通且鉴权成功 */
  ok: boolean;
  /** 服务端状态标识（如 "ok"） */
  status?: string;
  /** 远端 ActionDock 版本号 */
  version?: string;
  /** 远端服务运行时间（秒） */
  uptime?: number;
  /** 网络往返延迟（毫秒） */
  latencyMs: number;
  /** 探测失败时的错误信息 */
  error?: string;
}

/**
 * 远端健康探测控制选项。
 */
export interface CheckRemoteHealthOptions extends RemoteClientRequestOptions {
  /** 可选注入时钟抽象（缺省使用系统时钟） */
  clock?: Clock;
}

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
  options?: CheckRemoteHealthOptions
): Promise<RemoteHealthResult> {
  const clock = options?.clock ?? defaultClock;
  const startTime = clock.monotonic();
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

    const res = await fetchRemoteRoute(normalizeServerUrl(serverUrl), "/api/v2/health", fetchInit);

    const latencyMs = Math.round(clock.monotonic() - startTime);

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
    const latencyMs = Math.round(clock.monotonic() - startTime);
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
