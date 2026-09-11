import { filterByIntent } from "../../filter";
import { EXECUTION_FAILED } from "../../errors";
import type { ExecutionEvent, RunRecord } from "@actiondock/sdk";
import { readJsonBody } from "../body";
import { getSubPath, jsonResponse, type RouteContext } from "./common";

/**
 * 处理历史运行记录查询、清理、详情及 SSE 流式日志接口。
 */
export async function handleRunsRoutes(ctx: RouteContext): Promise<Response | null> {
  const { req, url, pathname, corsHeaders, options, target, host } = ctx;
  const subpath = getSubPath(pathname);

  // 1. Runs List: GET /api/v2/runs, GET /runs
  if (subpath === "/runs" && req.method === "GET") {
    try {
      const status = url.searchParams.get("status") || undefined;
      const actionId = url.searchParams.get("actionId") || undefined;
      const packageId = url.searchParams.get("packageId") || undefined;
      const intent = url.searchParams.get("intent") || undefined;
      const limit = parseInt(url.searchParams.get("limit") || "50", 10);

      const allRuns: RunRecord[] = [];
      const seenRunIds = new Set<string>();

      const apps = host
        ? host.listApps()
        : (() => {
            const inner = target?.unwrap?.();
            return inner && "listApps" in inner ? inner.listApps() : [inner].filter(Boolean);
          })();

      for (const app of apps) {
        if (!app) continue;
        if (packageId && app.packageId !== packageId) continue;
        if (app.storage && typeof app.storage.listRuns === "function") {
          try {
            const records = app.storage.listRuns({ actionId, limit });
            for (const r of records) {
              if (!seenRunIds.has(r.id)) {
                seenRunIds.add(r.id);
                if (status && r.status !== status) continue;
                allRuns.push(r);
              }
            }
          } catch {}
        }
      }

      allRuns.sort((a, b) => (b.startedAt || "").localeCompare(a.startedAt || ""));

      const filtered = intent
        ? filterByIntent(
            allRuns,
            intent,
            [(r) => r.id, (r) => r.actionId, (r) => r.status, (r) => r.packageId],
            false
          )
        : allRuns;

      const sliced = filtered.slice(0, limit);
      return jsonResponse(
        { ok: true, total: filtered.length, items: sliced },
        200,
        corsHeaders
      );
    } catch (err: any) {
      return jsonResponse(
        { ok: false, error: { code: "RUNS_LIST_ERROR", message: err.message } },
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

      let clearedCount = 0;
      const apps = host
        ? host.listApps()
        : (() => {
            const inner = target?.unwrap?.();
            return inner && "listApps" in inner ? inner.listApps() : [inner].filter(Boolean);
          })();

      for (const app of apps) {
        if (!app) continue;
        if (packageId && app.packageId !== packageId) continue;
        if (app.storage && typeof app.storage.clearRuns === "function") {
          clearedCount += app.storage.clearRuns({ actionId, status });
        }
      }

      return jsonResponse({ ok: true, clearedCount }, 200, corsHeaders);
    } catch (err: any) {
      return jsonResponse(
        { ok: false, error: { code: "RUNS_CLEAR_ERROR", message: err.message } },
        500,
        corsHeaders
      );
    }
  }

  // 3. Run Events SSE: GET /api/v2/runs/:runId/events (and stream alias)
  const runEventsMatch = subpath.match(/^\/runs\/([^/]+)\/(events|stream)$/);
  if (runEventsMatch && req.method === "GET") {
    const runId = decodeURIComponent(runEventsMatch[1]);
    const run = await target.getRun(runId);

    if (!run) {
      return jsonResponse(
        { ok: false, error: { code: "RUN_NOT_FOUND", message: `Run '${runId}' not found` } },
        404,
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

    const eventStream = target.events(runId, { after: afterCursor, signal: req.signal });
    const iterator = eventStream[Symbol.asyncIterator]();

    // 检查游标是否在建流前已过期：拉取首个事件，若抛出 EVENT_CURSOR_EXPIRED 直接返回 410
    let firstResult: IteratorResult<ExecutionEvent>;
    try {
      firstResult = await iterator.next();
    } catch (err: any) {
      if (err?.code === "EVENT_CURSOR_EXPIRED") {
        return jsonResponse(
          {
            ok: false,
            error: {
              code: "EVENT_CURSOR_EXPIRED",
              message: err.message || "Event cursor has expired",
              details: err.details,
            },
          },
          410,
          corsHeaders
        );
      }
      throw err;
    }

    const stream = new ReadableStream({
      async start(controller) {
        const encoder = new TextEncoder();
        let eventsCount = 0;
        try {
          // 先消费首个事件结果
          if (!firstResult.done) {
            eventsCount++;
            const evt = firstResult.value;
            const eventType = evt.type || "message";
            const idField = evt.eventId ? `id: ${evt.eventId}\n` : `id: ${evt.sequence}\n`;
            controller.enqueue(
              encoder.encode(`${idField}event: ${eventType}\ndata: ${JSON.stringify(evt)}\n\n`)
            );
            // 若首条事件为背压终止事件，立即关闭通道
            if (evt.type === "error" && (evt as any).error?.code === "EVENT_BACKPRESSURE_LIMIT") {
              controller.close();
              return;
            }
          }

          // 循环消费后续实时或队列事件
          while (!req.signal.aborted) {
            const nextResult = await iterator.next();
            if (nextResult.done) break;
            eventsCount++;
            const evt = nextResult.value;
            const eventType = evt.type || "message";
            const idField = evt.eventId ? `id: ${evt.eventId}\n` : `id: ${evt.sequence}\n`;
            controller.enqueue(
              encoder.encode(`${idField}event: ${eventType}\ndata: ${JSON.stringify(evt)}\n\n`)
            );

            // 若收到背压截断终止事件，正常关闭流通道
            if (evt.type === "error" && (evt as any).error?.code === "EVENT_BACKPRESSURE_LIMIT") {
              break;
            }
          }

          if (
            eventsCount === 0 &&
            run &&
            (run.status === "success" || run.status === "failed" || run.status === "cancelled")
          ) {
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
                        code: EXECUTION_FAILED,
                        message: `Run finished with status ${run.status}`,
                      },
                    },
            };
            controller.enqueue(
              encoder.encode(`event: finish\ndata: ${JSON.stringify(finishEvt)}\n\n`)
            );
          }
        } catch {
          // 忽略中断
        } finally {
          try {
            controller.close();
          } catch {}
        }
      },
      cancel() {},
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
    const run = await target.getRun(runId);

    if (!run) {
      return jsonResponse(
        {
          ok: false,
          error: {
            code: "RUN_NOT_FOUND",
            message: `Run '${runId}' not found`,
          },
        },
        404,
        corsHeaders
      );
    }

    return jsonResponse(run, 200, corsHeaders);
  }

  // 5. Run Cancel: POST /api/v2/runs/:runId/cancel, POST /runs/:runId/cancel
  const runCancelMatch = subpath.match(/^\/runs\/([^/]+)\/cancel$/);
  if (runCancelMatch && req.method === "POST") {
    const runId = decodeURIComponent(runCancelMatch[1]);
    let body: any = {};
    try {
      body = await readJsonBody(req, { maxBytes: options.maxBodyBytes });
    } catch {}

    const reason = body?.reason || "Cancelled by client request";
    const cancelResult = await target.cancelRun(runId, reason);

    if (cancelResult.outcome === "not_found") {
      return jsonResponse(
        {
          ok: false,
          error: {
            code: "RUN_NOT_FOUND",
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
            code: "RUN_ALREADY_FINISHED",
            message: `Run '${runId}' has already finished with status '${cancelResult.status}'`,
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
