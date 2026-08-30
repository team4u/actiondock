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
import { createStorage } from "../storage";
import type { ActionDockServerInstance, ServerOptions } from "./types";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...CORS_HEADERS,
    },
  });
}

function checkAuthorization(req: Request, expectedToken?: string): boolean {
  if (!expectedToken || !expectedToken.trim()) {
    return true;
  }
  const authHeader = req.headers.get("authorization");
  if (authHeader && authHeader.startsWith("Bearer ")) {
    const token = authHeader.slice(7).trim();
    if (token === expectedToken.trim()) {
      return true;
    }
  }

  const url = new URL(req.url);
  const tokenParam = url.searchParams.get("token");
  if (tokenParam && tokenParam.trim() === expectedToken.trim()) {
    return true;
  }

  return false;
}

export function startActionDockServer(
  options: ServerOptions = {}
): ActionDockServerInstance {
  const port = options.port ?? 5177;
  const host = options.host ?? "0.0.0.0";
  const token = options.token;
  const customHome = options.customHome;
  const projectRoot = options.projectRoot
    ? resolve(options.projectRoot)
    : findProjectRoot(process.cwd());

  const server = Bun.serve({
    port,
    hostname: host,
    async fetch(req) {
      if (req.method === "OPTIONS") {
        return new Response(null, {
          status: 204,
          headers: CORS_HEADERS,
        });
      }

      const url = new URL(req.url);
      const pathname = url.pathname;

      // 1. Health Check (supports /api/v1/health and /health)
      if (pathname === "/api/v1/health" || pathname === "/health") {
        if (!checkAuthorization(req, token)) {
          return jsonResponse(
            {
              ok: false,
              error: {
                code: "UNAUTHORIZED",
                message: "Invalid or missing Bearer token",
              },
            },
            401
          );
        }
        return jsonResponse({
          status: "ok",
          version: "2.0.0",
          timestamp: new Date().toISOString(),
          uptime: process.uptime(),
          projectRoot: projectRoot || null,
        });
      }

      // Check authentication for remaining endpoints
      if (!checkAuthorization(req, token)) {
        return jsonResponse(
          {
            ok: false,
            error: {
              code: "UNAUTHORIZED",
              message: "Invalid or missing Bearer token",
            },
          },
          401
        );
      }

      // 2. Info: GET /api/v1/info
      if (pathname === "/api/v1/info" && req.method === "GET") {
        try {
          if (projectRoot) {
            const config = loadProjectConfig(projectRoot);
            const actions = await loadActions(projectRoot, config.actionsDir);
            const playbooks = loadPlaybooks(projectRoot, config.playbooksDir);
            return jsonResponse({
              ok: true,
              id: config.id,
              name: config.name,
              version: config.version,
              description: config.description,
              projectRoot,
              actionsCount: actions.size,
              playbooksCount: playbooks.size,
              actions: Array.from(actions.keys()),
              playbooks: Array.from(playbooks.keys()),
            });
          } else {
            const linked = listLinkedPackages(customHome);
            return jsonResponse({
              ok: true,
              version: "2.0.0",
              linkedPackages: linked,
            });
          }
        } catch (err: any) {
          return jsonResponse(
            {
              ok: false,
              error: { code: "INFO_ERROR", message: err.message },
            },
            500
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

          return jsonResponse(filtered);
        } catch (err: any) {

          return jsonResponse(
            {
              ok: false,
              error: { code: "ACTIONS_LIST_ERROR", message: err.message },
            },
            500
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
              404
            );
          }

          return jsonResponse({
            id: action.id,
            packageId: resolved.packageId,
            description: action.description || "",
            inputSchema: action.inputSchema || null,
            outputSchema: action.outputSchema || null,
          });
        } catch (err: any) {
          return jsonResponse(
            {
              ok: false,
              error: { code: "ACTION_NOT_FOUND", message: err.message },
            },
            404
          );
        }
      }

      // 5. Action Run: POST /api/v1/actions/:id/run
      const actionRunMatch = pathname.match(/^\/api\/v1\/actions\/([^/]+)\/run$/);
      if (actionRunMatch && req.method === "POST") {
        const actionId = decodeURIComponent(actionRunMatch[1]);
        let body: any = {};
        try {
          const raw = await req.text();
          if (raw && raw.trim()) {
            body = JSON.parse(raw);
          }
        } catch (err: any) {
          return jsonResponse(
            {
              ok: false,
              runId: randomUUID(),
              error: {
                code: "INVALID_JSON",
                message: `Failed to parse request body: ${err.message}`,
              },
            },
            400
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
          const storage = createStorage(config.id, {
            projectRoot: resolved.projectRoot,
          });

          const runner = new ActionRunner({
            packageId: config.id,
            storage,
            projectConfig: config,
            configOverrides: body.config || {},
            actions,
          });

          const result = await runner.execute(resolved.actionId, body.input || {});
          storage.close();

          return jsonResponse(result, result.ok ? 200 : 200);
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
            500
          );
        }
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
        404
      );
    },
  });

  const actualHost = host === "0.0.0.0" ? "127.0.0.1" : host;
  const url = `http://${actualHost}:${server.port}`;

  return {
    port: server.port ?? port,
    host,
    url,
    stop: () => {
      server.stop(true);
    },
  };
}
