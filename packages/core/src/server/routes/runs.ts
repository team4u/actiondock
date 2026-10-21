import {
  ACTION_FORBIDDEN,
  CAPABILITY_UNAVAILABLE,
  EVENT_BACKPRESSURE_LIMIT,
  EVENT_CURSOR_EXPIRED,
  EXECUTION_FAILED,
  INVALID_ARGUMENT,
  PACKAGE_FORBIDDEN,
  RUN_ALREADY_FINISHED,
  RUN_INTERRUPTED,
  RUN_NOT_FOUND,
  RUNS_CLEAR_ERROR,
  RUNS_LIST_ERROR,
} from "../../errors";
import { isTerminalRunStatus } from "../../storage/types";
import type { ExecutionEvent, RunRecord } from "@actiondock/sdk";
import { createAbortError } from "../../ipc/service";
import { parseDuration } from "../../utils";
import { readJsonBody } from "../body";
import { parseActionRef } from "../../catalog/resolve-action";
import { getSubPath, isActionAllowedByPolicy, isFullAccessGranted, isPackageAllowedByPolicy, isPackageVisibleByPolicy, jsonResponse, type RouteContext } from "./common";
import type { EffectiveServerPolicy } from "../types";

/** 清理范围必须落在整包或精确动作授权内，全局清理必须显式拥有全部授权。 */
function resolveRunCleanupScope(
  packageId: string | undefined,
  actionId: string | undefined,
  policy: EffectiveServerPolicy
): { ok: true; filter: { packageId?: string; actionId?: string } } | { ok: false; reason: string } {
  if (isFullAccessGranted(policy)) {
    if (packageId && !isPackageVisibleByPolicy(packageId, policy)) {
      return {
        ok: false,
        reason: `Package '${packageId}' is not in the allowed package list`,
      };
    }
    return { ok: true, filter: { packageId, actionId } };
  }

  // 单动作清理必须解析出完整身份，避免鉴权与实际清理范围不一致。
  if (actionId) {
    let parsed: { packageId?: string; actionId: string };
    try {
      parsed = parseActionRef(actionId);
    } catch {
      return { ok: false, reason: `Invalid action reference '${actionId}'` };
    }
    // 全限定引用与显式 packageId 归一化后不一致必须拒绝，防止鉴权与过滤范围错位
    if (parsed.packageId && packageId && parsed.packageId !== packageId) {
      return {
        ok: false,
        reason: `Action reference '${parsed.packageId}/${parsed.actionId}' does not match the requested package scope '${packageId}'`,
      };
    }
    const targetPkgId = parsed.packageId || packageId;
    if (!targetPkgId) {
      return {
        ok: false,
        reason: "Restricted access policy requires a fully qualified 'packageId/actionId' action reference for run cleanup",
      };
    }
    if (!isActionAllowedByPolicy({ packageId: targetPkgId, actionId: parsed.actionId }, policy)) {
      return {
        ok: false,
        reason: `Action '${targetPkgId}/${parsed.actionId}' is not in the allowed action list`,
      };
    }
    // 以归一化完整引用传递，确保底层过滤范围与鉴权引用一致且不扩大
    return { ok: true, filter: { packageId: targetPkgId, actionId: parsed.actionId } };
  }

  // 无 actionId：必须有明确包范围，且该范围必须是整包授权
  if (!packageId) {
    return {
      ok: false,
      reason: "Restricted access policy requires an explicit 'packageId' or fully qualified 'actionId' scope for run cleanup",
    };
  }
  if (!isPackageAllowedByPolicy(packageId, policy)) {
    return {
      ok: false,
      reason: `Package '${packageId}' is not fully granted; run cleanup requires a fully granted package or an explicitly granted 'packageId/actionId' reference`,
    };
  }
  return { ok: true, filter: { packageId } };
}

/**
 * 处理历史运行记录查询、清理、详情及 SSE 流式日志接口。
 */
export async function handleRunsRoutes(ctx: RouteContext): Promise<Response | null> {
  const { req, url, pathname, corsHeaders, options, service, activePolicy: policy } = ctx;
  const subpath = getSubPath(pathname);

  // 1. Runs List: GET /api/v2/runs, GET /runs
  if (subpath === "/runs" && req.method === "GET") {
    try {
      const status = url.searchParams.get("status") || undefined;
      const actionId = url.searchParams.get("actionId") || undefined;
      const packageId = url.searchParams.get("packageId") || undefined;
      const channel = url.searchParams.get("channel") || undefined;
      const view = url.searchParams.get("view") || undefined;
      const since = url.searchParams.get("since") || undefined;
      const until = url.searchParams.get("until") || undefined;
      const rootRunId = url.searchParams.get("rootRunId") || undefined;
      const parentRunId = url.searchParams.get("parentRunId") || undefined;
      const withTotal = url.searchParams.get("withTotal") === "true";
      const intent = url.searchParams.get("intent") || undefined;
      // requestId 反查：支持 requestId 与 requestIds 重复查询参数，将每一个参数值作为原样字符串保存
      const requestIds = [
        ...url.searchParams.getAll("requestId"),
        ...url.searchParams.getAll("requestIds"),
      ].filter((id) => id.length > 0);

      // offset 校验：非负安全整数，默认为 0，上限 100000 防止滥用
      const rawOffset = url.searchParams.get("offset");
      let offset = 0;
      if (rawOffset !== null && rawOffset !== "") {
        const parsedOffset = Number(rawOffset);
        if (!Number.isSafeInteger(parsedOffset) || parsedOffset < 0 || parsedOffset > 100_000) {
          return jsonResponse(
            {
              ok: false,
              error: {
                code: INVALID_ARGUMENT,
                message: `Invalid offset '${rawOffset}': must be a non-negative safe integer <= 100000`,
              },
            },
            400,
            corsHeaders
          );
        }
        offset = parsedOffset;
      }

      // limit 边界防护：未提供保持默认值 50，提供则夹紧在 1 至 500 区间
      const rawLimit = url.searchParams.get("limit");
      let limit = 50;
      if (rawLimit !== null) {
        const parsedLimit = parseInt(rawLimit, 10);
        if (Number.isFinite(parsedLimit)) {
          limit = Math.min(Math.max(parsedLimit, 1), 500);
        }
      }

      if (packageId && !isPackageVisibleByPolicy(packageId, policy)) {
        return jsonResponse(
          {
            ok: false,
            error: {
              code: PACKAGE_FORBIDDEN,
              message: `Package '${packageId}' is not in the allowed package list`,
            },
          },
          403,
          corsHeaders
        );
      }

      if (actionId && (packageId || actionId.includes("/")) && !isActionAllowedByPolicy({ packageId, actionId }, policy)) {
        return jsonResponse(
          {
            ok: false,
            error: {
              code: ACTION_FORBIDDEN,
              message: `Action '${packageId ? `${packageId}/${actionId}` : actionId}' is not in the allowed action list`,
            },
          },
          403,
          corsHeaders
        );
      }

      // 下推的是包可见性并集，仍须逐条校验动作，不能丢弃单动作授权包的记录。
      const visiblePackageIds = new Set([
        ...(policy.packageAllowlist || []).filter((id) => id !== "*"),
        ...(policy.actionAllowlist || []).map((ref) => parseActionRef(ref).packageId!),
      ]);
      const backendPackageFilter = isFullAccessGranted(policy) ? undefined : [...visiblePackageIds];
      if (backendPackageFilter?.length === 0) {
        return jsonResponse({ ok: true, items: [], total: 0, limit, offset }, 200, corsHeaders);
      }

      const queryOptions: import("../../service/types").ListRunsOptions = {
        actionId,
        status,
        packageId,
        channel,
        view,
        since,
        until,
        rootRunId,
        parentRunId,
        withTotal,
        intent,
        requestIds: requestIds.length > 0 ? requestIds : undefined,
        signal: req.signal,
        packageAllowlist: backendPackageFilter,
      };

      const hasPolicyFilter = !isFullAccessGranted(policy);

      let runs: RunRecord[];
      let total: number | undefined;

      if (hasPolicyFilter) {
        const BATCH_SIZE = 100;
        let cursorOffset = 0;
        let matchedCount = 0;
        const pagedRuns: RunRecord[] = [];

        while (true) {
          if (req.signal?.aborted) {
            throw createAbortError(req.signal.reason);
          }

          const batch = await service.runs.list(
            {
              ...queryOptions,
              limit: BATCH_SIZE,
              offset: cursorOffset,
              signal: req.signal,
            },
            { signal: req.signal }
          );

          if (req.signal?.aborted) {
            throw createAbortError(req.signal.reason);
          }

          if (batch.length === 0) {
            break;
          }

          for (const run of batch) {
            // 逐条以实际 packageId/actionId 完整引用判定授权：
            // 包可见性拦无关包，动作授权保留单动作授权目标（如 B/read）
            const packageAllowed = isPackageVisibleByPolicy(run.packageId, policy);
            const actionAllowed = isActionAllowedByPolicy(
              { packageId: run.packageId, actionId: run.actionId },
              policy
            );
            if (packageAllowed && actionAllowed) {
              if (matchedCount >= offset && pagedRuns.length < limit) {
                pagedRuns.push(run);
              }
              matchedCount++;
            }
          }

          cursorOffset += batch.length;
          if (batch.length < BATCH_SIZE) {
            break;
          }
        }

        runs = pagedRuns;
        total = matchedCount;
      } else {
        // 当 hasPolicyFilter 为 false 时：下推 limit 与 offset 到底层查询
        if (req.signal?.aborted) {
          throw createAbortError(req.signal.reason);
        }

        runs = await service.runs.list(
          {
            ...queryOptions,
            limit,
            offset,
            signal: req.signal,
          },
          { signal: req.signal }
        );

        if (req.signal?.aborted) {
          throw createAbortError(req.signal.reason);
        }

        // 统计总数 total 的可靠处理：
        if (typeof service.runs.count === "function") {
          total = await service.runs.count(
            {
              ...queryOptions,
              signal: req.signal,
            },
            { signal: req.signal }
          );
        } else if (runs.length === 0 && offset === 0) {
          total = 0;
        } else if (runs.length > 0 && runs.length < limit) {
          total = offset + runs.length;
        } else {
          total = undefined;
        }
      }

      const responseData: { ok: true; items: RunRecord[]; total?: number; limit: number; offset: number } = {
        ok: true,
        items: runs,
        limit,
        offset,
      };
      if (typeof total === "number") {
        responseData.total = total;
      }

      return jsonResponse(
        responseData,
        200,
        corsHeaders
      );
    } catch (err: any) {
      if (req.signal?.aborted || err?.name === "AbortError") {
        throw err;
      }
      return jsonResponse(
        { ok: false, error: { code: RUNS_LIST_ERROR, message: err.message } },
        500,
        corsHeaders
      );
    }
  }

  // 2. Runs Clear: POST /api/v2/runs/clear, DELETE /api/v2/runs, etc.
  if (
    (subpath === "/runs/clear" && req.method === "POST") ||
    (subpath === "/runs" && req.method === "DELETE")
  ) {
    try {
      let body: any = {};
      if (req.method === "POST" || req.headers.get("content-type")?.includes("json")) {
        body = await readJsonBody(req, { maxBytes: options.maxBodyBytes }).catch(() => ({}));
      }
      const packageId = url.searchParams.get("packageId") || body.packageId || undefined;
      const actionId = url.searchParams.get("actionId") || body.actionId || undefined;
      const status = url.searchParams.get("status") || body.status || undefined;

      const rawOlderThan =
        url.searchParams.get("olderThan") ||
        url.searchParams.get("olderThanMs") ||
        body.olderThan ||
        body.olderThanMs;
      let olderThanMs: number | undefined;
      if (typeof rawOlderThan === "number" && rawOlderThan > 0) {
        olderThanMs = rawOlderThan;
      } else if (typeof rawOlderThan === "string" && rawOlderThan.trim()) {
        try {
          olderThanMs = parseDuration(rawOlderThan);
        } catch {}
      }

      const rawKeep = url.searchParams.get("keep") || body.keep;
      let keep: number | undefined;
      if (typeof rawKeep === "number" && rawKeep >= 0) {
        keep = rawKeep;
      } else if (typeof rawKeep === "string" && rawKeep.trim()) {
        const parsed = parseInt(rawKeep.trim(), 10);
        if (!isNaN(parsed) && parsed >= 0) {
          keep = parsed;
        }
      }

      const scopeCheck = resolveRunCleanupScope(packageId, actionId, policy);
      if (!scopeCheck.ok) {
        return jsonResponse(
          {
            ok: false,
            error: {
              code: PACKAGE_FORBIDDEN,
              message: scopeCheck.reason,
            },
          },
          403,
          corsHeaders
        );
      }
      const clearedScope = scopeCheck.filter;

      let clearedCount = 0;
      if (service.runs.clear) {
        clearedCount = await service.runs.clear({
          packageId: clearedScope.packageId,
          actionId: clearedScope.actionId,
          status,
          olderThanMs,
          keep,
        });
      }

      return jsonResponse({ ok: true, clearedCount }, 200, corsHeaders);
    } catch (err: any) {
      return jsonResponse(
        { ok: false, error: { code: RUNS_CLEAR_ERROR, message: err.message } },
        500,
        corsHeaders
      );
    }
  }

  // 2.1 Runs Clean Expired: POST /api/v2/runs/clean-expired, POST /runs/clean-expired
  // 此操作无法按包或动作收窄范围，只允许显式的全部授权。
  if (subpath === "/runs/clean-expired" && req.method === "POST") {
    if (!isFullAccessGranted(policy)) {
      return jsonResponse(
        {
          ok: false,
          error: {
            code: PACKAGE_FORBIDDEN,
            message: "Expired run cleanup cannot be scoped under a restricted access policy",
          },
        },
        403,
        corsHeaders
      );
    }
    try {
      let body: any = {};
      if (req.headers.get("content-type")?.includes("json")) {
        body = await readJsonBody(req, { maxBytes: options.maxBodyBytes }).catch(() => ({}));
      }
      let cleanedCount = 0;
      if (service.runs.cleanExpired) {
        cleanedCount = await service.runs.cleanExpired(body);
      }
      return jsonResponse({ ok: true, cleanedCount }, 200, corsHeaders);
    } catch (err: any) {
      return jsonResponse(
        { ok: false, error: { code: RUNS_CLEAR_ERROR, message: err.message } },
        500,
        corsHeaders
      );
    }
  }

  // 3. Run Events SSE: GET /api/v2/runs/:runId/events (and stream alias)
  const runEventsMatch = subpath.match(/^\/runs\/([^/]+)\/(events|stream)$/);
  if (runEventsMatch && req.method === "GET") {
    const runId = decodeURIComponent(runEventsMatch[1]);
    const run = await service.runs.get(runId);

    if (!run) {
      return jsonResponse(
        { ok: false, error: { code: RUN_NOT_FOUND, message: `Run '${runId}' not found` } },
        404,
        corsHeaders
      );
    }

    if (!isPackageVisibleByPolicy(run.packageId, policy)) {
      return jsonResponse(
        {
          ok: false,
          error: {
            code: PACKAGE_FORBIDDEN,
            message: `Package '${run.packageId || "unknown"}' is not in the allowed package list`,
          },
        },
        403,
        corsHeaders
      );
    }

    if (!isActionAllowedByPolicy({ packageId: run.packageId, actionId: run.actionId }, policy)) {
      return jsonResponse(
        {
          ok: false,
          error: {
            code: ACTION_FORBIDDEN,
            message: `Action '${run.packageId ? `${run.packageId}/${run.actionId}` : run.actionId}' is not in the allowed action list`,
          },
        },
        403,
        corsHeaders
      );
    }

    // 解析 Last-Event-ID 请求头或 query 参数 after 游标
    const lastEventIdHeader =
      req.headers.get("Last-Event-ID") ||
      req.headers.get("last-event-id") ||
      url.searchParams.get("after") ||
      undefined;

    let afterCursor: number | string | undefined = undefined;
    if (lastEventIdHeader !== undefined && lastEventIdHeader.trim() !== "") {
      const trimmed = lastEventIdHeader.trim();
      if (/^-?\d+$/.test(trimmed)) {
        afterCursor = parseInt(trimmed, 10);
      } else {
        afterCursor = trimmed;
      }
    }

    if (!service.events) {
      return jsonResponse(
        {
          ok: false,
          error: {
            code: CAPABILITY_UNAVAILABLE,
            message: "EventsPort is not supported by this ActionDock service",
          },
        },
        501
      );
    }

    const eventStream = service.events.events(runId, { after: afterCursor, signal: req.signal });
    const iterator = eventStream[Symbol.asyncIterator]();

    const encoder = new TextEncoder();
    const encodeEvent = (evt: ExecutionEvent): Uint8Array => {
      const eventType = evt.type || "message";
      const idField = evt.eventId ? `id: ${evt.eventId}\n` : `id: ${evt.sequence}\n`;
      return encoder.encode(`${idField}event: ${eventType}\ndata: ${JSON.stringify(evt)}\n\n`);
    };

    // 游标过期检测：仅等待首事件一小段时间（过期错误通常在拉取瞬间抛出）；
    // 超时后立即开流，保证响应头及时下发，不再等首事件到达
    const CURSOR_PROBE_MS = 250;
    let firstResult: IteratorResult<ExecutionEvent> | undefined;
    let cursorExpired: any = null;
    const firstPull = iterator.next();
    try {
      firstResult = await Promise.race([
        firstPull,
        new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), CURSOR_PROBE_MS)),
      ]);
    } catch (err: any) {
      cursorExpired = err;
    }

    if (cursorExpired?.code === EVENT_CURSOR_EXPIRED) {
      return jsonResponse(
        {
          ok: false,
          error: {
            code: EVENT_CURSOR_EXPIRED,
            message: cursorExpired.message || "Event cursor has expired",
            details: cursorExpired.details,
          },
        },
        410,
        corsHeaders
      );
    }

    const stream = new ReadableStream({
      async start(controller) {
        let sawFinish = false;

        try {
          // 先消费首个事件结果（探测期内未完成则继续等待）
          const first = firstResult ?? (await firstPull);
          if (!first.done) {
            const evt = first.value;
            if (evt.type === "finish") {
              sawFinish = true;
            }
            controller.enqueue(encodeEvent(evt));
            // 若首条事件为背压终止事件，立即关闭通道
            if (evt.type === "error" && (evt as any).error?.code === EVENT_BACKPRESSURE_LIMIT) {
              controller.close();
              return;
            }
          }

          // 循环消费后续实时或队列事件
          while (!req.signal.aborted) {
            const nextResult = await iterator.next();
            if (nextResult.done) break;
            const evt = nextResult.value;
            if (evt.type === "finish") {
              sawFinish = true;
            }
            controller.enqueue(encodeEvent(evt));

            // 若收到背压截断终止事件，正常关闭流通道
            if (evt.type === "error" && (evt as any).error?.code === EVENT_BACKPRESSURE_LIMIT) {
              break;
            }
          }

          if (!sawFinish && run && isTerminalRunStatus(run.status)) {
            const finishEvt = {
              type: "finish",
              runId,
              timestamp: run.finishedAt || new Date().toISOString(),
              result:
                run.status === "success"
                  ? { ok: true, runId, data: run.output ?? null }
                  : {
                      ok: false,
                      runId,
                      error: run.error || {
                        code: run.status === "interrupted" ? RUN_INTERRUPTED : EXECUTION_FAILED,
                        message: `Run finished with status ${run.status}`,
                      },
                    },
            };
            controller.enqueue(
              encoder.encode(`event: finish\ndata: ${JSON.stringify(finishEvt)}\n\n`)
            );
          }
        } catch (err) {
          // 流中断不静默：保留诊断线索（客户端断连属正常路径，仅记录非预期异常）
          if (!(err instanceof Error) || err.name !== "AbortError") {
            console.warn(`[RunsRoute] SSE stream for run '${runId}' interrupted: ${err instanceof Error ? err.message : String(err)}`);
          }
        } finally {
          try {
            controller.close();
          } catch {}
        }
      },
      cancel() {
        // 客户端断开时释放底层事件迭代器，避免资源悬挂
        try {
          const ret = iterator.return?.() as unknown;
          if (ret && typeof (ret as Promise<void>).catch === "function") {
            (ret as Promise<void>).catch(() => {});
          }
        } catch {}
      },
    });

    return new Response(stream, {
      status: 200,
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
        ...corsHeaders,
      },
    });
  }

  // 4. Run Show: GET /api/v2/runs/:runId, GET /runs/:runId
  const runShowMatch = subpath.match(/^\/runs\/([^/]+)$/);
  if (runShowMatch && req.method === "GET") {
    const runId = decodeURIComponent(runShowMatch[1]);
    const run = await service.runs.get(runId, { signal: req.signal });

    if (!run) {
      return jsonResponse(
        {
          ok: false,
          error: {
            code: RUN_NOT_FOUND,
            message: `Run '${runId}' not found`,
          },
        },
        404,
        corsHeaders
      );
    }

    if (!isPackageVisibleByPolicy(run.packageId, policy)) {
      return jsonResponse(
        {
          ok: false,
          error: {
            code: PACKAGE_FORBIDDEN,
            message: `Package '${run.packageId || "unknown"}' is not in the allowed package list`,
          },
        },
        403,
        corsHeaders
      );
    }

    if (!isActionAllowedByPolicy({ packageId: run.packageId, actionId: run.actionId }, policy)) {
      return jsonResponse(
        {
          ok: false,
          error: {
            code: ACTION_FORBIDDEN,
            message: `Action '${run.packageId ? `${run.packageId}/${run.actionId}` : run.actionId}' is not in the allowed action list`,
          },
        },
        403,
        corsHeaders
      );
    }

    return jsonResponse(run, 200, corsHeaders);
  }

  // 5. Run Cancel: POST /api/v2/runs/:runId/cancel, POST /runs/:runId/cancel
  const runCancelMatch = subpath.match(/^\/runs\/([^/]+)\/cancel$/);
  if (runCancelMatch && req.method === "POST") {
    const runId = decodeURIComponent(runCancelMatch[1]);
    if (!isFullAccessGranted(policy)) {
      const run = await service.runs.get(runId);
      if (run) {
        if (!isPackageVisibleByPolicy(run.packageId, policy)) {
          return jsonResponse(
            {
              ok: false,
              error: {
                code: PACKAGE_FORBIDDEN,
                message: `Package '${run.packageId || "unknown"}' is not in the allowed package list`,
              },
            },
            403,
            corsHeaders
          );
        }
        if (!isActionAllowedByPolicy({ packageId: run.packageId, actionId: run.actionId }, policy)) {
          return jsonResponse(
            {
              ok: false,
              error: {
                code: ACTION_FORBIDDEN,
                message: `Action '${run.packageId ? `${run.packageId}/${run.actionId}` : run.actionId}' is not in the allowed action list`,
              },
            },
            403,
            corsHeaders
          );
        }
      }
    }
    let body: any = {};
    try {
      body = await readJsonBody(req, { maxBytes: options.maxBodyBytes });
    } catch {}

    const reason = body?.reason || "Cancelled by client request";
    const cancelResult = await service.runs.cancel(runId, reason);

    if (cancelResult.outcome === "not_found") {
      return jsonResponse(
        {
          ok: false,
          error: {
            code: RUN_NOT_FOUND,
            message: `Run '${runId}' not found`,
          },
        },
        404,
        corsHeaders
      );
    }

    if (cancelResult.outcome === "already_terminal") {
      return jsonResponse(
        {
          ok: false,
          error: {
            code: RUN_ALREADY_FINISHED,
            message: `Run '${runId}' has already finished with status '${cancelResult.status}'`,
            status: cancelResult.status,
          },
        },
        409,
        corsHeaders
      );
    }

    return jsonResponse(
      {
        ok: true,
        runId,
        status: "cancelled",
      },
      200,
      corsHeaders
    );
  }

  return null;
}
