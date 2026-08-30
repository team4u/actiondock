import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { filterByIntent } from "../filter";
import {
  findProjectRoot,
  loadActions,
  loadPlaybooks,
  loadProjectConfig,
} from "../project/loader";
import { listLinkedPackages, resolveActionProject } from "../registry/registry";
import { ActionRunner } from "../runtime/runner";
import { InvalidJsonError, readJsonBody, RequestTooLargeError } from "./body";
import { ServerRuntimeRegistry } from "./runtime-registry";
import { isLoopbackHost, resolveCorsHeaders, verifyBearerToken } from "./security";
import type { ActionDockServerInstance, ServerOptions } from "./types";

function jsonResponse(
  data: unknown,
  status = 200,
  corsHeaders: Record<string, string> = {}
): Response {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...corsHeaders,
    },
  });
}

function findRunAcrossStorages(
  runId: string,
  runtimeRegistry: ServerRuntimeRegistry,
  projectRoot?: string | null,
  customHome?: string
) {
  const inMemory = runtimeRegistry.findRun(runId);
  if (inMemory) return inMemory;

  if (projectRoot) {
    try {
      const config = loadProjectConfig(projectRoot);
      const storage = runtimeRegistry.getStorage(config.id, projectRoot);
      const run = storage.getRun(runId);
      if (run) return { storage, run };
    } catch {
      // ignore
    }
  }

  try {
    const linked = listLinkedPackages(customHome);
    for (const pkg of linked) {
      if (!existsSync(pkg.path)) continue;
      const storage = runtimeRegistry.getStorage(pkg.id, pkg.path);
      const run = storage.getRun(runId);
      if (run) return { storage, run };
    }
  } catch {
    // ignore
  }

  return null;
}

export function startActionDockServer(
  options: ServerOptions = {}
): ActionDockServerInstance {
  const port = options.port ?? 5177;
  const host = options.host ?? "127.0.0.1";
  const token = options.token;
  const customHome = options.customHome;
  const projectRoot = options.projectRoot
    ? resolve(options.projectRoot)
    : findProjectRoot(process.cwd());

  // Non-loopback address requires token authentication by default
  if (!isLoopbackHost(host) && !token && !options.allowInsecureNoAuth) {
    throw new Error(
      "Authentication token is required when binding to a non-loopback address. Use --allow-insecure-no-auth to override."
    );
  }

  const runtimeRegistry = new ServerRuntimeRegistry();

  const server = Bun.serve({
    port,
    hostname: host,
    async fetch(req) {
      const origin = req.headers.get("origin");
      const corsHeaders = resolveCorsHeaders(origin, options.corsOrigins);

      if (req.method === "OPTIONS") {
        return new Response(null, {
          status: 204,
          headers: corsHeaders,
        });
      }

      const url = new URL(req.url);
      const pathname = url.pathname;

      // 1. Health Check (supports /api/v1/health and /health)
      if (pathname === "/api/v1/health" || pathname === "/health") {
        if (!verifyBearerToken(req, token)) {
          return jsonResponse(
            {
              ok: false,
              error: {
                code: "UNAUTHORIZED",
                message: "Invalid or missing Bearer token",
              },
            },
            401,
            corsHeaders
          );
        }
        const healthData: Record<string, unknown> = {
          status: "ok",
          version: "2.0.0",
          timestamp: new Date().toISOString(),
          uptime: process.uptime(),
        };
        if (options.exposeDebugInfo && projectRoot) {
          healthData.projectRoot = projectRoot;
        }
        return jsonResponse(healthData, 200, corsHeaders);
      }

      // Check authentication for remaining endpoints
      if (!verifyBearerToken(req, token)) {
        return jsonResponse(
          {
            ok: false,
            error: {
              code: "UNAUTHORIZED",
              message: "Invalid or missing Bearer token",
            },
          },
          401,
          corsHeaders
        );
      }

      // 2. Info: GET /api/v1/info
      if (pathname === "/api/v1/info" && req.method === "GET") {
        try {
          if (projectRoot) {
            const config = loadProjectConfig(projectRoot);
            const actions = await loadActions(projectRoot, config.actionsDir);
            const playbooks = loadPlaybooks(projectRoot, config.playbooksDir);
            const infoData: Record<string, unknown> = {
              ok: true,
              id: config.id,
              name: config.name,
              version: config.version,
              description: config.description,
              actionsCount: actions.size,
              playbooksCount: playbooks.size,
              actions: Array.from(actions.keys()),
              playbooks: Array.from(playbooks.keys()),
            };
            if (options.exposeDebugInfo) {
              infoData.projectRoot = projectRoot;
            }
            return jsonResponse(infoData, 200, corsHeaders);
          } else {
            const linked = listLinkedPackages(customHome);
            return jsonResponse(
              {
                ok: true,
                version: "2.0.0",
                linkedPackages: linked,
              },
              200,
              corsHeaders
            );
          }
        } catch (err: any) {
          return jsonResponse(
            {
              ok: false,
              error: { code: "INFO_ERROR", message: err.message },
            },
            500,
            corsHeaders
          );
        }
      }

      // 3. Actions List: GET /api/v1/actions
      if (pathname === "/api/v1/actions" && req.method === "GET") {
        try {
          const actionList: Array<{
            id: string;
            description: string;
            packageId?: string;
          }> = [];

          if (projectRoot) {
            const config = loadProjectConfig(projectRoot);
            const actions = await loadActions(projectRoot, config.actionsDir);
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
              const actions = await loadActions(pkg.path, config.actionsDir);
              for (const [id, a] of actions.entries()) {
                actionList.push({
                  id,
                  description: a.description || "",
                  packageId: pkg.id,
                });
              }
            } catch {
              // Ignore broken package
            }
          }

          const intent = url.searchParams.get("intent");
          const filtered = intent
            ? filterByIntent(
                actionList,
                intent,
                [(a) => a.id, (a) => a.description, (a) => a.packageId],
                false
              )
            : actionList;

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

      // 4. Action Show: GET /api/v1/actions/:id
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
          const actions = await loadActions(resolved.projectRoot, config.actionsDir);
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

      // 5. Action Run: POST /api/v1/actions/:id/run
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
                error: {
                  code: "REQUEST_TOO_LARGE",
                  message: err.message,
                },
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
                error: {
                  code: "INVALID_JSON",
                  message: err.message,
                },
              },
              400,
              corsHeaders
            );
          }
          return jsonResponse(
            {
              ok: false,
              runId: randomUUID(),
              error: {
                code: "INVALID_JSON",
                message: `Failed to parse request body: ${err.message}`,
              },
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
          const actions = await loadActions(resolved.projectRoot, config.actionsDir);
          const storage = runtimeRegistry.getStorage(config.id, resolved.projectRoot);

          const runner = new ActionRunner({
            packageId: config.id,
            storage,
            projectConfig: config,
            configOverrides: body?.config || {},
            actions,
          });

          const executionMode = body?.execution?.mode || "sync";
          const timeoutMs =
            typeof body?.execution?.timeoutMs === "number" && body.execution.timeoutMs > 0
              ? body.execution.timeoutMs
              : undefined;

          if (executionMode === "async") {
            const handle = runner.start(resolved.actionId, body?.input || {}, {
              timeoutMs,
            });
            runtimeRegistry.executionManager.register(handle);

            return jsonResponse(
              {
                ok: true,
                runId: handle.runId,
                status: "running",
              },
              202,
              corsHeaders
            );
          }

          // Sync execution mode
          const handle = runner.start(resolved.actionId, body?.input || {}, {
            signal: req.signal,
            timeoutMs,
          });
          runtimeRegistry.executionManager.register(handle);
          const result = await handle.result;

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

      // 6. Run Show: GET /api/v1/runs/:runId
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

      // 7. Run Cancel: POST /api/v1/runs/:runId/cancel
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

        // 1. Try cancelling in-memory active handle
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

        // 2. Check storage for run status
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

        // Running in storage but no longer in memory
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

      // 404 Not Found
      return jsonResponse(
        {
          ok: false,
          error: {
            code: "NOT_FOUND",
            message: `Route not found: ${req.method} ${pathname}`,
          },
        },
        404,
        corsHeaders
      );
    },
  });

  const actualHost = host === "0.0.0.0" ? "127.0.0.1" : host;
  const url = `http://${actualHost}:${server.port}`;

  return {
    port: server.port ?? port,
    host,
    url,
    runtimeRegistry,
    stop: () => {
      runtimeRegistry.close();
      server.stop(true);
    },
  };
}
