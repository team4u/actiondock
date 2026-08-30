import { randomUUID } from "node:crypto";
import type { ExecutionResult } from "@actiondock/sdk";
import { normalizeServerUrl } from "./manager";
import type { RemoteHealthResult } from "./types";

function buildHeaders(token?: string): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: "application/json",
  };
  if (token && token.trim()) {
    headers.Authorization = `Bearer ${token.trim()}`;
  }
  return headers;
}

export async function checkRemoteHealth(
  serverUrl: string,
  token?: string,
  timeoutMs: number = 5000
): Promise<RemoteHealthResult> {
  const base = normalizeServerUrl(serverUrl);
  const url = `${base}/api/v1/health`;
  const startTime = Date.now();

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    const res = await fetch(url, {
      method: "GET",
      headers: buildHeaders(token),
      signal: controller.signal,
    });
    clearTimeout(timer);

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
      status: data.status || "ok",
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
  }
}

export async function executeRemoteAction(
  serverUrl: string,
  actionId: string,
  input: unknown = {},
  configOverrides?: Record<string, unknown>,
  token?: string
): Promise<ExecutionResult> {
  const base = normalizeServerUrl(serverUrl);
  const url = `${base}/api/v1/actions/${encodeURIComponent(actionId)}/run`;

  try {
    const headers = {
      ...buildHeaders(token),
      "Content-Type": "application/json",
    };

    const res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({
        input,
        config: configOverrides,
      }),
    });

    const data = (await res.json().catch(() => null)) as any;

    if (data && typeof data === "object" && typeof data.ok === "boolean") {
      return data as ExecutionResult;
    }

    if (!res.ok) {
      return {
        ok: false,
        runId: randomUUID(),
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
    return {
      ok: false,
      runId: randomUUID(),
      error: {
        code: "NETWORK_ERROR",
        message: `Failed to connect to remote ActionDock server at ${serverUrl}: ${err.message}`,
      },
    };
  }
}

export async function fetchRemoteActions(
  serverUrl: string,
  token?: string
): Promise<Array<{ id: string; description: string; packageId?: string }>> {
  const base = normalizeServerUrl(serverUrl);
  const url = `${base}/api/v1/actions`;

  const res = await fetch(url, {
    method: "GET",
    headers: buildHeaders(token),
  });

  if (!res.ok) {
    throw new Error(`Failed to fetch remote actions (${res.status}): ${res.statusText}`);
  }

  return (await res.json()) as any;
}

export async function fetchRemoteActionShow(
  serverUrl: string,
  actionId: string,
  token?: string
): Promise<any> {
  const base = normalizeServerUrl(serverUrl);
  const url = `${base}/api/v1/actions/${encodeURIComponent(actionId)}`;

  const res = await fetch(url, {
    method: "GET",
    headers: buildHeaders(token),
  });

  if (!res.ok) {
    throw new Error(`Failed to fetch remote action '${actionId}' (${res.status}): ${res.statusText}`);
  }

  return await res.json();
}

export async function fetchRemoteInfo(
  serverUrl: string,
  token?: string
): Promise<any> {
  const base = normalizeServerUrl(serverUrl);
  const url = `${base}/api/v1/info`;

  const res = await fetch(url, {
    method: "GET",
    headers: buildHeaders(token),
  });

  if (!res.ok) {
    throw new Error(`Failed to fetch remote info (${res.status}): ${res.statusText}`);
  }

  return await res.json();
}
