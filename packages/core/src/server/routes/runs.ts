import {
  ACTION_FORBIDDEN,
  CAPABILITY_UNAVAILABLE,
  EVENT_BACKPRESSURE_LIMIT,
  EVENT_CURSOR_EXPIRED,
  EXECUTION_FAILED,
  PACKAGE_FORBIDDEN,
  RUN_ALREADY_FINISHED,
  RUN_INTERRUPTED,
  RUN_NOT_FOUND,
  RUNS_CLEAR_ERROR,
  RUNS_LIST_ERROR,
} from "../../errors";
import { isTerminalRunStatus } from "../../storage/types";
import type { ExecutionEvent } from "@actiondock/sdk";
import { readJsonBody } from "../body";
import { getSubPath, isActionAllowed, jsonResponse, type RouteContext } from "./common";

/**
 * 处理历史运行记录查询、清理、详情及 SSE 流式日志接口。
 */
export async function handleRunsRoutes(ctx: RouteContext): Promise<Response | null> {
  const { req, url, pathname, corsHeaders, options, service } = ctx;
  const subpath = getSubPath(pathname);

  // 1. Runs List: GET /api/v2/runs, GET /runs
  if (subpath === "/runs" && req.method === "GET") {
    try {
      const status = url.searchParams.get("status") || undefined;
      const actionId = url.searchParams.get("actionId") || undefined;
      const packageId = url.searchParams.get("packageId") || undefined;
      const intent = url.searchParams.get("intent") || undefined;
      // limit 边界防护：非法或超界值回退默认 50，并夹紧到 1 至 500 区间
      const parsedLimit = parseInt(url.searchParams.get("limit") || "50", 10);
      const limit =
        Number.isFinite(parsedLimit) && parsedLimit > 0
          ? Math.min(parsedLimit, 500)
          : 50;

      if (
        packageId &&
        options.packageAllowlist &&
        options.packageAllowlist.length > 0 &&
        !options.packageAllowlist.includes(packageId)
      ) {
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

      if (
        actionId &&
        options.actionAllowlist &&
        options.actionAllowlist.length > 0 &&
        !isActionAllowed({ packageId, actionId }, options.actionAllowlist)
      ) {
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

      let allRuns = await service.runs.list({
        actionId,
        status,
        packageId,
        intent,
        limit,
      });

      if (options.packageAllowlist && options.packageAllowlist.length > 0) {
        allRuns = allRuns.filter(
          (r) => !r.packageId || options.packageAllowlist!.includes(r.packageId)
        );
      }

      if (options.actionAllowlist && options.actionAllowlist.length > 0) {
        allRuns = allRuns.filter((r) =>
          isActionAllowed({ packageId: r.packageId, actionId: r.actionId }, options.actionAllowlist)
        );
      }

      const sliced = allRuns.slice(0, limit);
      return jsonResponse(
        { ok: true, total: allRuns.length, items: sliced },
        200,
        corsHeaders
      );
    } catch (err: any) {
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

      if (
        packageId &&
        options.packageAllowlist &&
        options.packageAllowlist.length > 0 &&
        !options.packageAllowlist.includes(packageId)
      ) {
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

      let clearedCount = 0;
      if (service.runs.clear) {
        clearedCount = await service.runs.clear({ packageId, actionId, status });
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

    if (
      options.packageAllowlist &&
      options.packageAllowlist.length > 0 &&
      (!run.packageId || !options.packageAllowlist.includes(run.packageId))
    ) {
      return jsonResponse(
        {
          ok: false,
          error: {
            code: PACKAGE_FORBIDDEN,
            message: `Package '${run.packageId}' is not in the allowed package list`,
          },
        },
        403,
        corsHeaders
      );
    }

    if (
      options.actionAllowlist &&
      options.actionAllowlist.length > 0 &&
      !isActionAllowed({ packageId: run.packageId, actionId: run.actionId }, options.actionAllowlist)
    ) {
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
    const run = await service.runs.get(runId);

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

    if (
      options.packageAllowlist &&
      options.packageAllowlist.length > 0 &&
      (!run.packageId || !options.packageAllowlist.includes(run.packageId))
    ) {
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

    if (
      options.actionAllowlist &&
      options.actionAllowlist.length > 0 &&
      !isActionAllowed({ packageId: run.packageId, actionId: run.actionId }, options.actionAllowlist)
    ) {
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
    if (
      (options.packageAllowlist && options.packageAllowlist.length > 0) ||
      (options.actionAllowlist && options.actionAllowlist.length > 0)
    ) {
      const run = await service.runs.get(runId);
      if (run) {
        if (
          options.packageAllowlist &&
          options.packageAllowlist.length > 0 &&
          (!run.packageId || !options.packageAllowlist.includes(run.packageId))
        ) {
          return jsonResponse(
            {
              ok: false,
              error: {
                code: PACKAGE_FORBIDDEN,
                message: `Package '${run.packageId}' is not in the allowed package list`,
              },
            },
            403,
            corsHeaders
          );
        }
        if (
          options.actionAllowlist &&
          options.actionAllowlist.length > 0 &&
          !isActionAllowed({ packageId: run.packageId, actionId: run.actionId }, options.actionAllowlist)
        ) {
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
