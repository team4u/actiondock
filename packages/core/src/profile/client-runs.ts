import type { RunRecord } from "@actiondock/sdk";
import type { RemoteClientRequestOptions } from "./client-transport";
import { buildQueryString, fetchRemoteJson } from "./client-query";

/**
 * 远端运行记录域端点。
 */

/**
 * 拉取单条远端运行记录。
 */
export async function fetchRemoteRun(
  serverUrl: string,
  runId: string,
  token?: string,
  options?: RemoteClientRequestOptions
): Promise<RunRecord> {
  return fetchRemoteJson<RunRecord>(
    serverUrl,
    `/api/v2/runs/${encodeURIComponent(runId)}`,
    token,
    {
      errorPrefix: `Failed to fetch remote run '${runId}'`,
      allowInsecureHttp: options?.allowInsecureHttp,
      insecure: options?.insecure,
      dispatcher: options?.dispatcher,
    }
  );
}

/**
 * 取消远端运行。
 */
export async function cancelRemoteRun(
  serverUrl: string,
  runId: string,
  token?: string,
  reason?: string,
  options?: RemoteClientRequestOptions
): Promise<{ ok: boolean; runId: string; status: string }> {
  return fetchRemoteJson(
    serverUrl,
    `/api/v2/runs/${encodeURIComponent(runId)}/cancel`,
    token,
    {
      method: "POST",
      body: { reason },
      errorPrefix: `Failed to cancel remote run '${runId}'`,
      allowInsecureHttp: options?.allowInsecureHttp,
      insecure: options?.insecure,
      dispatcher: options?.dispatcher,
    }
  );
}

/**
 * 分页查询远端运行记录列表。
 */
export async function fetchRemoteRuns(
  serverUrl: string,
  token?: string,
  options?: { status?: string; actionId?: string; packageId?: string; intent?: string; limit?: number } & RemoteClientRequestOptions
): Promise<{ ok: boolean; total: number; items: RunRecord[] }> {
  return fetchRemoteJson(
    serverUrl,
    `/api/v2/runs${buildQueryString({
      status: options?.status,
      actionId: options?.actionId,
      packageId: options?.packageId,
      intent: options?.intent,
      limit: options?.limit,
    })}`,
    token,
    {
      errorPrefix: "Failed to fetch remote runs",
      allowInsecureHttp: options?.allowInsecureHttp,
      insecure: options?.insecure,
      dispatcher: options?.dispatcher,
    }
  );
}

/**
 * 清空远端运行记录（可按包、Action、状态过滤清除范围）。
 */
export async function clearRemoteRuns(
  serverUrl: string,
  token?: string,
  options?: { packageId?: string; actionId?: string; status?: string } & RemoteClientRequestOptions
): Promise<{ ok: boolean; clearedCount: number }> {
  return fetchRemoteJson(
    serverUrl,
    "/api/v2/runs/clear",
    token,
    {
      method: "POST",
      body: options || {},
      errorPrefix: "Failed to clear remote runs",
      allowInsecureHttp: options?.allowInsecureHttp,
      insecure: options?.insecure,
      dispatcher: options?.dispatcher,
    }
  );
}
