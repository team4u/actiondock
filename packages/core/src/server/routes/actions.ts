import { randomUUID } from "node:crypto";
import { filterByIntent } from "../../filter";
import { InvalidJsonError, readJsonBody, RequestTooLargeError } from "../body";
import { getSubPath, jsonResponse, type RouteContext } from "./common";

/**
 * 处理 Action 相关的 HTTP 路由（列表、规范查询、同步执行与异步启动）。
 */
export async function handleActionsRoutes(ctx: RouteContext): Promise<Response | null> {
  const { req, url, pathname, corsHeaders, options, target } = ctx;
  const subpath = getSubPath(pathname);

  // 1. Actions List: GET /api/v2/actions, GET /actions
  if (subpath === "/actions" && req.method === "GET") {
    try {
      const intent = url.searchParams.get("intent") || undefined;
      const query = url.searchParams.get("query") || intent;
      const targetPkg = url.searchParams.get("package") || url.searchParams.get("packageId") || undefined;
      const prefix = url.searchParams.get("prefix") || undefined;
      const tags = url.searchParams.getAll("tag");

      let actions = await target.listActions({
        query,
        prefix,
        tags: tags.length > 0 ? tags : undefined,
      });

      if (targetPkg) {
        actions = actions.filter(
          (a) => a.packageId === targetPkg || a.id.startsWith(`${targetPkg}/`)
        );
      }

      if (intent) {
        actions = filterByIntent(
          actions,
          intent,
          [(a) => a.id, (a) => a.description || "", (a) => a.packageId || ""],
          false
        );
      }

      return jsonResponse(actions, 200, corsHeaders);
    } catch (err: any) {
      return jsonResponse(
        {
          ok: false,
          error: { code: "ACTIONS_LIST_ERROR", message: err.message },
        },
        500,
        corsHeaders
      );
    }
  }

  // 2. Multi-package Action Show: GET /api/v2/packages/:packageId/actions/:actionId
  const pkgActionShowMatch = subpath.match(/^\/packages\/([^/]+)\/actions\/([^/]+)$/);
  if (pkgActionShowMatch && req.method === "GET") {
    const packageId = decodeURIComponent(pkgActionShowMatch[1]);
    const actionId = decodeURIComponent(pkgActionShowMatch[2]);
    const ref = `${packageId}/${actionId}`;
    try {
      const spec = await target.describeAction(ref);
      return jsonResponse(spec, 200, corsHeaders);
    } catch (err: any) {
      return jsonResponse(
        {
          ok: false,
          error: {
            code: "ACTION_NOT_FOUND",
            message: err.message || `Action '${actionId}' not found in package '${packageId}'`,
          },
        },
        404,
        corsHeaders
      );
    }
  }

  // 3. Short Action Show: GET /api/v2/actions/:actionId, GET /actions/:actionId
  const actionShowMatch = subpath.match(/^\/actions\/(.+)$/);
  if (actionShowMatch && req.method === "GET") {
    const actionId = decodeURIComponent(actionShowMatch[1]);
    try {
      const spec = await target.describeAction(actionId);
      return jsonResponse(spec, 200, corsHeaders);
    } catch (err: any) {
      return jsonResponse(
        {
          ok: false,
          error: {
            code: "ACTION_NOT_FOUND",
            message: err.message || `Action '${actionId}' not found`,
          },
        },
        404,
        corsHeaders
      );
    }
  }

  // 4. Execution Routes (Run & Start)
  // Match patterns:
  // - /packages/:packageId/actions/:actionId/run
  // - /packages/:packageId/actions/:actionId/start
  // - /actions/:actionId/run
  // - /actions/:actionId/start
  const pkgRunMatch = subpath.match(/^\/packages\/([^/]+)\/actions\/([^/]+)\/(run|start)$/);
  const shortRunMatch = subpath.match(/^\/actions\/(.+)\/(run|start)$/);

  if ((pkgRunMatch || shortRunMatch) && req.method === "POST") {
    let actionRef: string;
    let endpointMode: "run" | "start";
    let pkgId: string | undefined;

    if (pkgRunMatch) {
      pkgId = decodeURIComponent(pkgRunMatch[1]);
      const actId = decodeURIComponent(pkgRunMatch[2]);
      endpointMode = pkgRunMatch[3] as "run" | "start";
      actionRef = `${pkgId}/${actId}`;
    } else {
      actionRef = decodeURIComponent(shortRunMatch![1]);
      endpointMode = shortRunMatch![2] as "run" | "start";
      if (actionRef.includes("/")) {
        pkgId = actionRef.split("/")[0];
      }
    }

    // 校验 Package 允许白名单
    if (pkgId && options.packageAllowlist && options.packageAllowlist.length > 0) {
      if (!options.packageAllowlist.includes(pkgId)) {
        return jsonResponse(
          {
            ok: false,
            runId: randomUUID(),
            error: {
              code: "PACKAGE_FORBIDDEN",
              message: `Package '${pkgId}' is not in the allowed package list`,
            },
          },
          403,
          corsHeaders
        );
      }
    }

    let body: any = {};
    try {
      body = await readJsonBody(req, { maxBytes: options.maxBodyBytes });
    } catch (err: any) {
      if (err instanceof RequestTooLargeError) {
        return jsonResponse(
          {
            ok: false,
            runId: randomUUID(),
            error: { code: "REQUEST_TOO_LARGE", message: err.message },
          },
          413,
          corsHeaders
        );
      }
      if (err instanceof InvalidJsonError) {
        return jsonResponse(
          {
            ok: false,
            runId: randomUUID(),
            error: { code: "INVALID_JSON", message: err.message },
          },
          400,
          corsHeaders
        );
      }
      return jsonResponse(
        {
          ok: false,
          runId: randomUUID(),
          error: { code: "INVALID_JSON", message: `Failed to parse request body: ${err.message}` },
        },
        400,
        corsHeaders
      );
    }

    const isAsync =
      endpointMode === "start" ||
      body?.execution?.mode === "async" ||
      body?.async === true;

    const timeoutMs =
      typeof body?.execution?.timeoutMs === "number" && body.execution.timeoutMs > 0
        ? body.execution.timeoutMs
        : undefined;

    const input = body && "input" in body ? body.input : {};
    const configOverrides = body?.config;

    if (isAsync) {
      try {
        const ticket = await target.startAction(actionRef, input, {
          timeoutMs,
          config: configOverrides,
        });

        if (ticket.status === "failed") {
          const res = await ticket.result!;
          return jsonResponse(res, 400, corsHeaders);
        }

        return jsonResponse(
          {
            ok: true,
            runId: ticket.runId,
            status: ticket.status || "running",
            streamUrl: `/api/v2/runs/${ticket.runId}/events`,
          },
          202,
          corsHeaders
        );
      } catch (err: any) {
        return jsonResponse(
          {
            ok: false,
            runId: randomUUID(),
            error: {
              code: "ACTION_START_FAILED",
              message: err.message || String(err),
            },
          },
          500,
          corsHeaders
        );
      }
    }

    // 同步执行模式
    try {
      const result = await target.runAction(actionRef, input, {
        signal: req.signal,
        timeoutMs,
        config: configOverrides,
      });

      let status = 200;
      if (!result.ok) {
        if (result.error?.code === "INPUT_VALIDATION_FAILED") {
          status = 400;
        } else if (
          result.error?.code === "ACTION_NOT_FOUND" ||
          result.error?.code === "PACKAGE_NOT_FOUND"
        ) {
          status = 404;
        } else if (result.error?.code === "ACTION_TIMEOUT") {
          status = 504;
        } else {
          status = 500;
        }
      }

      return jsonResponse(result, status, corsHeaders);
    } catch (err: any) {
      return jsonResponse(
        {
          ok: false,
          runId: randomUUID(),
          error: {
            code: "ACTION_EXECUTION_ERROR",
            message: err.message || String(err),
          },
        },
        500,
        corsHeaders
      );
    }
  }

  return null;
}
