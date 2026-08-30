import { randomUUID } from "node:crypto";
import type { ExecutionResult, RuntimeError, RunRecord } from "@actiondock/sdk";
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

export interface RemoteExecuteOptions {
  configOverrides?: Record<string, unknown>;
  token?: string;
  timeoutMs?: number;
  signal?: AbortSignal;
  async?: boolean;
}

export type RemoteExecutionResult<T = unknown> = ExecutionResult<T> & {
  status?: string;
};

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

export async function executeRemoteAction<T = unknown>(
  serverUrl: string,
  actionId: string,
  input: unknown = {},
  configOverridesOrOptions?: Record<string, unknown> | RemoteExecuteOptions,
  tokenArg?: string
): Promise<RemoteExecutionResult<T>> {
  const base = normalizeServerUrl(serverUrl);
  const url = `${base}/api/v1/actions/${encodeURIComponent(actionId)}/run`;

  // Parse options / backwards compatibility
  let configOverrides: Record<string, unknown> | undefined;
  let token: string | undefined = tokenArg;
  let timeoutMs: number | undefined;
  let signal: AbortSignal | undefined;
  let isAsync = false;

  if (configOverridesOrOptions && typeof configOverridesOrOptions === "object") {
    if (
      "token" in configOverridesOrOptions ||
      "timeoutMs" in configOverridesOrOptions ||
      "signal" in configOverridesOrOptions ||
      "async" in configOverridesOrOptions ||
      "configOverrides" in configOverridesOrOptions
    ) {
      const opts = configOverridesOrOptions as RemoteExecuteOptions;
      configOverrides = opts.configOverrides;
      token = opts.token ?? tokenArg;
      timeoutMs = opts.timeoutMs;
      signal = opts.signal;
      isAsync = Boolean(opts.async);
    } else {
      configOverrides = configOverridesOrOptions as Record<string, unknown>;
    }
  }

  const executionPayload: Record<string, unknown> = {};
  if (isAsync) {
    executionPayload.mode = "async";
  }
  if (typeof timeoutMs === "number" && timeoutMs > 0) {
    executionPayload.timeoutMs = timeoutMs;
  }

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
        execution: Object.keys(executionPayload).length > 0 ? executionPayload : undefined,
      }),
      signal,
    });

    const data = (await res.json().catch(() => null)) as any;

    if (data && typeof data === "object" && typeof data.ok === "boolean") {
      return data;
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
    if (err.name === "AbortError" || signal?.aborted) {
      return {
        ok: false,
        runId: randomUUID(),
        error: {
          code: "ACTION_CANCELLED",
          message: "Action execution was cancelled",
        },
      };
    }
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

export async function fetchRemoteRun(
  serverUrl: string,
  runId: string,
  token?: string
): Promise<RunRecord> {
  const base = normalizeServerUrl(serverUrl);
  const url = `${base}/api/v1/runs/${encodeURIComponent(runId)}`;

  const res = await fetch(url, {
    method: "GET",
    headers: buildHeaders(token),
  });

  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    throw new Error(
      errData?.error?.message || `Failed to fetch remote run '${runId}' (${res.status}): ${res.statusText}`
    );
  }

  return (await res.json()) as RunRecord;
}

export async function cancelRemoteRun(
  serverUrl: string,
  runId: string,
  token?: string,
  reason?: string
): Promise<{ ok: boolean; runId: string; status: string }> {
  const base = normalizeServerUrl(serverUrl);
  const url = `${base}/api/v1/runs/${encodeURIComponent(runId)}/cancel`;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      ...buildHeaders(token),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ reason }),
  });

  const data = (await res.json().catch(() => ({}))) as any;
  if (!res.ok || !data.ok) {
    throw new Error(
      data?.error?.message || `Failed to cancel remote run '${runId}' (${res.status}): ${res.statusText}`
    );
  }

  return data;
}

export async function fetchRemoteActions(
  serverUrl: string,
  token?: string,
  intent?: string
): Promise<Array<{ id: string; description: string; packageId?: string }>> {
  const base = normalizeServerUrl(serverUrl);
  const query = intent ? `?intent=${encodeURIComponent(intent)}` : "";
  const url = `${base}/api/v1/actions${query}`;

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
