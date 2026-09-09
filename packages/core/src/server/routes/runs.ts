import { existsSync } from "node:fs";
import { filterByIntent } from "../../filter";
import { loadProjectConfig } from "../../project/loader";
import { listLinkedPackages } from "../../registry/registry";
import type { RuntimeStorage } from "../../storage/types";
import { readJsonBody } from "../body";
import { type RouteContext, findRunAcrossStorages, jsonResponse } from "./common";

/**
 * 处理历史运行记录检索、清理、详情及 SSE 流式日志接口。
 */
export async function handleRunsRoutes(ctx: RouteContext): Promise<Response | null> {
  const { req, url, pathname, corsHeaders, projectRoot, customHome, runtimeRegistry, options } = ctx;

  // 1. Runs List: GET /api/v1/runs
  if (pathname === "/api/v1/runs" && req.method === "GET") {
    try {
      const status = url.searchParams.get("status") || undefined;
      const actionId = url.searchParams.get("actionId") || undefined;
      const packageId = url.searchParams.get("packageId") || undefined;
      const intent = url.searchParams.get("intent") || undefined;
      const limit = parseInt(url.searchParams.get("limit") || "50", 10);

      const allRuns: any[] = [];
      const seenRunIds = new Set<string>();

      const candidateStorages: Array<{ packageId: string; storage: RuntimeStorage }> = [];
      if (projectRoot) {
        try {
          const cfg = loadProjectConfig(projectRoot);
          candidateStorages.push({
            packageId: cfg.id,
            storage: runtimeRegistry.getStorage(cfg.id, projectRoot),
          });
        } catch {}
      }
      const linked = listLinkedPackages(customHome);
      for (const pkg of linked) {
        if (projectRoot && pkg.path === projectRoot) continue;
        if (!existsSync(pkg.path)) continue;
        candidateStorages.push({
          packageId: pkg.id,
          storage: runtimeRegistry.getStorage(pkg.id, pkg.path),
        });
      }

      for (const item of candidateStorages) {
        if (packageId && item.packageId !== packageId) continue;
        try {
          const records = item.storage.listRuns({ actionId, limit });
          for (const r of records) {
            if (!seenRunIds.has(r.id)) {
              seenRunIds.add(r.id);
              if (status && r.status !== status) continue;
              allRuns.push(r);
            }
          }
        } catch {}
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

  // 2. Runs Clear: POST /api/v1/runs/clear or DELETE /api/v1/runs
  if (
    (pathname === "/api/v1/runs/clear" && req.method === "POST") ||
    (pathname === "/api/v1/runs" && req.method === "DELETE")
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
      const candidateStorages: RuntimeStorage[] = [];
      if (projectRoot) {
        try {
          const cfg = loadProjectConfig(projectRoot);
          candidateStorages.push(runtimeRegistry.getStorage(cfg.id, projectRoot));
        } catch {}
      }
      const linked = listLinkedPackages(customHome);
      for (const pkg of linked) {
        if (projectRoot && pkg.path === projectRoot) continue;
        if (!existsSync(pkg.path)) continue;
        if (packageId && pkg.id !== packageId) continue;
        candidateStorages.push(runtimeRegistry.getStorage(pkg.id, pkg.path));
      }

      for (const storage of candidateStorages) {
        clearedCount += storage.clearRuns({ actionId, status });
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

  // 3. Run Stream (SSE): GET /api/v1/runs/:runId/stream
  const runStreamMatch = pathname.match(/^\/api\/v1\/runs\/([^/]+)\/stream$/);
  if (runStreamMatch && req.method === "GET") {
    const runId = decodeURIComponent(runStreamMatch[1]);
    const found = findRunAcrossStorages(runId, runtimeRegistry, projectRoot, customHome);
    const activeHandle = runtimeRegistry.executionManager.get(runId);

    if (!found && !activeHandle) {
      return jsonResponse(
        { ok: false, error: { code: "RUN_NOT_FOUND", message: `Run '${runId}' not found` } },
        404,
        corsHeaders
      );
    }

    let closed = false;
    let finishSent = false;
    let unsubscribe: (() => void) | undefined;

    const stream = new ReadableStream({
      start(controller) {
        const encoder = new TextEncoder();
        const sendEvent = (event: string, data: any) => {
          if (closed) return;
          try {
            controller.enqueue(
              encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
            );
          } catch {}
        };

        const cleanup = () => {
          if (closed) return;
          closed = true;
          if (unsubscribe) {
            unsubscribe();
            unsubscribe = undefined;
          }
          try {
            controller.close();
          } catch {}
        };

        const sendFinish = (payload: any) => {
          if (finishSent || closed) return;
          finishSent = true;
          sendEvent("finish", payload);
          cleanup();
        };

        req.signal.addEventListener("abort", cleanup, { once: true });

        if (activeHandle) {
          sendEvent("status", { runId, status: "running" });
          unsubscribe = runtimeRegistry.subscribe(runId, (evt) => {
            if (evt.type === "finish") {
              sendFinish(evt.data);
            } else {
              sendEvent(evt.type, evt.data);
            }
          });

          activeHandle.result.then(
            (res) => {
              sendFinish(res);
            },
            (err) => {
              sendFinish({
                ok: false,
                error: { message: err?.message || String(err) },
              });
            }
          );
        } else if (found) {
          sendFinish(found.run);
        } else {
          cleanup();
        }
      },
      cancel() {
        if (!closed) {
          closed = true;
          if (unsubscribe) {
            unsubscribe();
            unsubscribe = undefined;
          }
        }
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

  // 4. Run Show: GET /api/v1/runs/:runId
  const runShowMatch = pathname.match(/^\/api\/v1\/runs\/([^/]+)$/);
  if (runShowMatch && req.method === "GET") {
    const runId = decodeURIComponent(runShowMatch[1]);
    const found = findRunAcrossStorages(runId, runtimeRegistry, projectRoot, customHome);

    if (!found) {
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

    return jsonResponse(found.run, 200, corsHeaders);
  }

  // 5. Run Cancel: POST /api/v1/runs/:runId/cancel
  const runCancelMatch = pathname.match(/^\/api\/v1\/runs\/([^/]+)\/cancel$/);
  if (runCancelMatch && req.method === "POST") {
    const runId = decodeURIComponent(runCancelMatch[1]);
    let body: any = {};
    try {
      body = await readJsonBody(req, { maxBytes: options.maxBodyBytes });
    } catch {
      // Body is optional
    }

    const reason = body?.reason || "Cancelled by client request";

    const activeHandle = runtimeRegistry.executionManager.get(runId);
    if (activeHandle) {
      const cancelled = runtimeRegistry.executionManager.cancel(runId, reason);
      if (cancelled) {
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
    }

    const found = findRunAcrossStorages(runId, runtimeRegistry, projectRoot, customHome);
    if (!found) {
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

    const { storage, run } = found;
    if (run.status === "success" || run.status === "failed" || run.status === "cancelled") {
      return jsonResponse(
        {
          ok: false,
          error: {
            code: "RUN_ALREADY_FINISHED",
            message: `Run '${runId}' has already finished with status '${run.status}'`,
          },
        },
        409,
        corsHeaders
      );
    }

    storage.updateRun(runId, "cancelled", undefined, {
      code: "ACTION_CANCELLED",
      message: reason,
    });

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
