import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { filterByIntent } from "../../filter";
import { loadActions, loadProjectConfig } from "../../project/loader";
import { listLinkedPackages, resolveActionProject } from "../../registry/registry";
import { ActionRunner } from "../../runtime/runner";
import { InvalidJsonError, readJsonBody, RequestTooLargeError } from "../body";
import { type RouteContext, jsonResponse } from "./common";

/**
 * 处理 Action 列表、详情查询及同步/异步运行接口。
 */
export async function handleActionsRoutes(ctx: RouteContext): Promise<Response | null> {
  const { req, url, pathname, corsHeaders, projectRoot, customHome, runtimeRegistry, options } = ctx;

  // 1. Actions List: GET /api/v1/actions
  if (pathname === "/api/v1/actions" && req.method === "GET") {
    try {
      const actionList: Array<{
        id: string;
        description: string;
        packageId?: string;
      }> = [];

      if (projectRoot) {
        const config = loadProjectConfig(projectRoot);
        const actions = await loadActions(projectRoot, config.actionsDir, { autoInstall: false });
        for (const [id, a] of actions.entries()) {
          actionList.push({
            id,
            description: a.description || "",
            packageId: config.id,
          });
        }
      }

      const linked = listLinkedPackages(customHome);
      for (const pkg of linked) {
        if (projectRoot && pkg.path === projectRoot) continue;
        if (!existsSync(pkg.path)) continue;
        try {
          const config = loadProjectConfig(pkg.path);
          const actions = await loadActions(pkg.path, config.actionsDir, { autoInstall: false });
          for (const [id, a] of actions.entries()) {
            actionList.push({
              id,
              description: a.description || "",
              packageId: pkg.id,
            });
          }
        } catch {
          // 忽略故障包
        }
      }

      const intent = url.searchParams.get("intent");
      const targetPkg = url.searchParams.get("package");

      let filtered = targetPkg
        ? actionList.filter((a) => a.packageId === targetPkg)
        : actionList;

      if (intent) {
        filtered = filterByIntent(
          filtered,
          intent,
          [(a) => a.id, (a) => a.description, (a) => a.packageId],
          false
        );
      }

      return jsonResponse(filtered, 200, corsHeaders);
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

  // 2. Action Show: GET /api/v1/actions/:id
  const actionShowMatch = pathname.match(/^\/api\/v1\/actions\/([^/]+)$/);
  if (actionShowMatch && req.method === "GET") {
    const actionId = decodeURIComponent(actionShowMatch[1]);
    try {
      const resolved = await resolveActionProject(
        actionId,
        projectRoot || process.cwd(),
        customHome
      );
      const config = loadProjectConfig(resolved.projectRoot);
      const actions = await loadActions(resolved.projectRoot, config.actionsDir, { autoInstall: false });
      const action = actions.get(resolved.actionId);
      if (!action) {
        return jsonResponse(
          {
            ok: false,
            error: {
              code: "ACTION_NOT_FOUND",
              message: `Action '${resolved.actionId}' not found in package '${resolved.packageId}'`,
            },
          },
          404,
          corsHeaders
        );
      }

      return jsonResponse(
        {
          id: action.id,
          packageId: resolved.packageId,
          description: action.description || "",
          inputSchema: action.inputSchema || null,
          outputSchema: action.outputSchema || null,
        },
        200,
        corsHeaders
      );
    } catch (err: any) {
      return jsonResponse(
        {
          ok: false,
          error: { code: "ACTION_NOT_FOUND", message: err.message },
        },
        404,
        corsHeaders
      );
    }
  }

  // 3. Action Run: POST /api/v1/actions/:id/run
  const actionRunMatch = pathname.match(/^\/api\/v1\/actions\/([^/]+)\/run$/);
  if (actionRunMatch && req.method === "POST") {
    const actionId = decodeURIComponent(actionRunMatch[1]);
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

    try {
      const resolved = await resolveActionProject(
        actionId,
        projectRoot || process.cwd(),
        customHome
      );
      const config = loadProjectConfig(resolved.projectRoot);

      // 校验 Package 允许列表（若配置白名单限制）
      if (options.packageAllowlist && options.packageAllowlist.length > 0) {
        if (!options.packageAllowlist.includes(config.id)) {
          return jsonResponse(
            {
              ok: false,
              runId: randomUUID(),
              error: {
                code: "PACKAGE_FORBIDDEN",
                message: `Package '${config.id}' is not in the allowed package list`,
              },
            },
            403,
            corsHeaders
          );
        }
      }

      const actions = await loadActions(resolved.projectRoot, config.actionsDir, { autoInstall: false });
      const executionService = runtimeRegistry.getExecutionService(config.id, resolved.projectRoot, config);
      for (const a of actions.values()) {
        executionService.registerAction(a);
      }

      const isAsync = body?.execution?.mode === "async" || body?.async === true;
      const timeoutMs =
        typeof body?.execution?.timeoutMs === "number" && body.execution.timeoutMs > 0
          ? body.execution.timeoutMs
          : undefined;

      // 严格保留 body.input 为 false、0、"" 或 null 的合法值，仅在 undefined 时使用空对象
      const input = body && "input" in body ? body.input : {};
      const configOverrides = body?.config;

      if (isAsync) {
        const ticket = await executionService.start(
          { packageId: config.id, actionId: resolved.actionId },
          input,
          { timeoutMs, config: configOverrides }
        );

        return jsonResponse(
          {
            ok: true,
            runId: ticket.runId,
            status: ticket.status,
            streamUrl: `/api/v1/runs/${ticket.runId}/stream`,
          },
          202,
          corsHeaders
        );
      }

      // 同步执行模式
      const result = await executionService.execute(
        { packageId: config.id, actionId: resolved.actionId },
        input,
        {
          signal: req.signal,
          timeoutMs,
          config: configOverrides,
        }
      );

      return jsonResponse(result, 200, corsHeaders);
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
