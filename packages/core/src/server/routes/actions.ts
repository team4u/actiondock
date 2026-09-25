
import type { ActionRef } from "@actiondock/sdk";
import { parseActionRef } from "../../catalog/resolve-action";
import { filterByIntent } from "../../filter";
import {
  ACTION_EXECUTION_ERROR,
  ACTION_FORBIDDEN,
  ACTION_NOT_FOUND,
  ACTION_START_FAILED,
  ACTION_TIMEOUT,
  ACTIONS_LIST_ERROR,
  IDEMPOTENCY_CONFLICT,
  INPUT_VALIDATION_FAILED,
  INVALID_JSON,
  PACKAGE_FORBIDDEN,
  PACKAGE_NOT_FOUND,
  REQUEST_TOO_LARGE,
} from "../../errors";
import { InvalidJsonError, readJsonBody, RequestTooLargeError } from "../body";
import { getSubPath, isActionAllowed, jsonResponse, type RouteContext } from "./common";

/**
 * 处理 Action 相关的 HTTP 路由（列表、规范查询、同步执行与异步启动）。
 */
export async function handleActionsRoutes(ctx: RouteContext): Promise<Response | null> {
  const { req, url, pathname, corsHeaders, options, service } = ctx;
  const subpath = getSubPath(pathname);

  // 1. Actions List: GET /api/v2/actions, GET /actions
  if (subpath === "/actions" && req.method === "GET") {
    try {
      const intent = url.searchParams.get("intent") || undefined;
      const query = url.searchParams.get("query") || intent;
      const targetPkg = url.searchParams.get("package") || url.searchParams.get("packageId") || undefined;
      const prefix = url.searchParams.get("prefix") || undefined;
      const tags = url.searchParams.getAll("tag");

      let actions = await service.discovery.listActions({
        query,
        prefix,
        tags: tags.length > 0 ? tags : undefined,
      });

      if (targetPkg) {
        actions = actions.filter(
          (a) => a.packageId === targetPkg || a.id.startsWith(`${targetPkg}/`)
        );
      }

      if (options.packageAllowlist && options.packageAllowlist.length > 0) {
        actions = actions.filter(
          (a) => a.packageId && options.packageAllowlist!.includes(a.packageId)
        );
      }

      if (options.actionAllowlist && options.actionAllowlist.length > 0) {
        actions = actions.filter((a) =>
          isActionAllowed({ id: a.id, packageId: a.packageId }, options.actionAllowlist)
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
          error: { code: ACTIONS_LIST_ERROR, message: err.message },
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
    if (options.packageAllowlist && options.packageAllowlist.length > 0) {
      if (!options.packageAllowlist.includes(packageId)) {
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
    }
    if (options.actionAllowlist && options.actionAllowlist.length > 0) {
      if (!isActionAllowed({ packageId, actionId }, options.actionAllowlist)) {
        return jsonResponse(
          {
            ok: false,
            error: {
              code: ACTION_FORBIDDEN,
              message: `Action '${packageId}/${actionId}' is not in the allowed action list`,
            },
          },
          403,
          corsHeaders
        );
      }
    }
    const ref = `${packageId}/${actionId}`;
    try {
      const spec = await service.discovery.describeAction(ref);
      return jsonResponse(spec, 200, corsHeaders);
    } catch (err: any) {
      return jsonResponse(
        {
          ok: false,
          error: {
            code: ACTION_NOT_FOUND,
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
      const parsed = parseActionRef(actionId);
      if (parsed.packageId && options.packageAllowlist && options.packageAllowlist.length > 0) {
        if (!options.packageAllowlist.includes(parsed.packageId)) {
          return jsonResponse(
            {
              ok: false,
              error: {
                code: PACKAGE_FORBIDDEN,
                message: `Package '${parsed.packageId}' is not in the allowed package list`,
              },
            },
            403,
            corsHeaders
          );
        }
      }
      if (parsed.packageId && options.actionAllowlist && options.actionAllowlist.length > 0) {
        if (!isActionAllowed({ packageId: parsed.packageId, actionId: parsed.actionId }, options.actionAllowlist)) {
          return jsonResponse(
            {
              ok: false,
              error: {
                code: ACTION_FORBIDDEN,
                message: `Action '${actionId}' is not in the allowed action list`,
              },
            },
            403,
            corsHeaders
          );
        }
      }
    } catch {}

    try {
      const spec = await service.discovery.describeAction(actionId);
      if (
        options.packageAllowlist &&
        options.packageAllowlist.length > 0 &&
        (!spec.packageId || !options.packageAllowlist.includes(spec.packageId))
      ) {
        return jsonResponse(
          {
            ok: false,
            error: {
              code: PACKAGE_FORBIDDEN,
              message: `Package '${spec.packageId}' is not in the allowed package list`,
            },
          },
          403,
          corsHeaders
        );
      }
      if (
        options.actionAllowlist &&
        options.actionAllowlist.length > 0 &&
        !isActionAllowed({ packageId: spec.packageId, actionId: spec.id }, options.actionAllowlist)
      ) {
        return jsonResponse(
          {
            ok: false,
            error: {
              code: ACTION_FORBIDDEN,
              message: `Action '${spec.packageId ? `${spec.packageId}/${spec.id}` : spec.id}' is not in the allowed action list`,
            },
          },
          403,
          corsHeaders
        );
      }
      return jsonResponse(spec, 200, corsHeaders);
    } catch (err: any) {
      return jsonResponse(
        {
          ok: false,
          error: {
            code: ACTION_NOT_FOUND,
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
    let actId: string | undefined;

    if (pkgRunMatch) {
      pkgId = decodeURIComponent(pkgRunMatch[1]);
      actId = decodeURIComponent(pkgRunMatch[2]);
      endpointMode = pkgRunMatch[3] as "run" | "start";
      actionRef = `${pkgId}/${actId}`;
    } else {
      actionRef = decodeURIComponent(shortRunMatch![1]);
      endpointMode = shortRunMatch![2] as "run" | "start";
      try {
        const parsed = parseActionRef(actionRef);
        pkgId = parsed.packageId;
        actId = parsed.actionId;
      } catch {}
    }

    // 校验 Package 允许白名单
    if (options.packageAllowlist && options.packageAllowlist.length > 0) {
      if (!pkgId) {
        try {
          const spec = await service.discovery.describeAction(actionRef);
          pkgId = spec?.packageId;
          if (!actId) {
            actId = spec?.id;
          }
        } catch {}
      }

      if (!pkgId || !options.packageAllowlist.includes(pkgId)) {
        return jsonResponse(
          {
            ok: false,
            runId: "",
            error: {
              code: PACKAGE_FORBIDDEN,
              message: pkgId
                ? `Package '${pkgId}' is not in the allowed package list`
                : `Action '${actionRef}' does not belong to any allowed package`,
            },
          },
          403,
          corsHeaders
        );
      }
    }

    // 校验 Action 允许白名单
    if (options.actionAllowlist && options.actionAllowlist.length > 0) {
      if (!pkgId || !actId) {
        try {
          const spec = await service.discovery.describeAction(actionRef);
          if (!pkgId) pkgId = spec?.packageId;
          if (!actId) actId = spec?.id;
        } catch {}
      }
      if (!actId) {
        try {
          const parsed = parseActionRef(actionRef);
          actId = parsed.actionId;
          if (!pkgId) pkgId = parsed.packageId;
        } catch {
          actId = actionRef;
        }
      }
      if (!isActionAllowed({ packageId: pkgId, actionId: actId }, options.actionAllowlist)) {
        return jsonResponse(
          {
            ok: false,
            runId: "",
            error: {
              code: ACTION_FORBIDDEN,
              message: `Action '${actionRef}' is not in the allowed action list`,
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
            runId: "",
            error: { code: REQUEST_TOO_LARGE, message: err.message },
          },
          413,
          corsHeaders
        );
      }
      if (err instanceof InvalidJsonError) {
        return jsonResponse(
          {
            ok: false,
            runId: "",
            error: { code: INVALID_JSON, message: err.message },
          },
          400,
          corsHeaders
        );
      }
      return jsonResponse(
        {
          ok: false,
          runId: "",
          error: { code: INVALID_JSON, message: `Failed to parse request body: ${err.message}` },
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

    const requestId =
      req.headers.get("Idempotency-Key") ||
      req.headers.get("idempotency-key") ||
      req.headers.get("X-Request-Id") ||
      req.headers.get("x-request-id") ||
      body?.requestId ||
      body?.execution?.requestId ||
      undefined;

    let actionRefObj: ActionRef;
    try {
      actionRefObj = parseActionRef(actionRef);
    } catch {
      actionRefObj = { actionId: actionRef };
    }

    if (isAsync) {
      try {
        const ticket = await service.execution.start(actionRefObj, input, {
          timeoutMs,
          config: configOverrides,
          requestId,
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
        if (err?.code === IDEMPOTENCY_CONFLICT) {
          return jsonResponse(
            {
              ok: false,
              error: {
                code: IDEMPOTENCY_CONFLICT,
                message: err.message,
                details: err.details,
              },
            },
            409,
            corsHeaders
          );
        }
        return jsonResponse(
          {
            ok: false,
            runId: "",
            error: {
              code: ACTION_START_FAILED,
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
      const result = await service.execution.run(actionRefObj, input, {
        signal: req.signal,
        timeoutMs,
        config: configOverrides,
        requestId,
      });

      let status = 200;
      if (!result.ok) {
        if (result.error?.code === INPUT_VALIDATION_FAILED) {
          status = 400;
        } else if (result.error?.code === IDEMPOTENCY_CONFLICT) {
          status = 409;
        } else if (
          result.error?.code === ACTION_NOT_FOUND ||
          result.error?.code === PACKAGE_NOT_FOUND
        ) {
          status = 404;
        } else if (result.error?.code === ACTION_TIMEOUT) {
          status = 504;
        } else {
          status = 500;
        }
      }

      return jsonResponse(result, status, corsHeaders);
    } catch (err: any) {
      if (err?.code === IDEMPOTENCY_CONFLICT) {
        return jsonResponse(
          {
            ok: false,
            error: {
              code: IDEMPOTENCY_CONFLICT,
              message: err.message,
              details: err.details,
            },
          },
          409,
          corsHeaders
        );
      }
      return jsonResponse(
        {
          ok: false,
          runId: "",
          error: {
            code: ACTION_EXECUTION_ERROR,
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
