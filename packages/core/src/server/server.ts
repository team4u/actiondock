import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { runDoctorChecks } from "../doctor/doctor";
import { filterByIntent, filterWithFallbackInfo } from "../filter";
import {
  findProjectRoot,
  loadActions,
  loadPlaybooks,
  loadProjectConfig,
} from "../project/loader";
import {
  getRegistryStatus,
  listLinkedPackages,
  resolveActionProject,
  resolvePackageRoot,
  resolvePlaybookProject,
} from "../registry/registry";
import { ActionRunner } from "../runtime/runner";
import type { RuntimeStorage } from "../storage/types";
import { createServer as createNodeHttpServer, type IncomingMessage, type ServerResponse } from "node:http";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { InvalidJsonError, readJsonBody, RequestTooLargeError } from "./body";
import { ServerRuntimeRegistry } from "./runtime-registry";
import { isLoopbackHost, resolveCorsHeaders, verifyBearerToken } from "./security";
import type { ActionDockServerInstance, CoreHttpServerFactory, CoreHttpServerInstance, ServerOptions } from "./types";

let customHttpServerFactory: CoreHttpServerFactory | undefined;

/**
 * 注册自定义 HTTP 服务端工厂（用于 Node.js / Bun 运行时环境适配）。
 */
export function setHttpServerFactory(factory: CoreHttpServerFactory): void {
  customHttpServerFactory = factory;
}

/**
 * 根据当前运行时环境启动标准 Web Request/Response 兼容的 HTTP 服务。
 */
function launchHttpServer(
  port: number,
  host: string,
  fetchHandler: (req: Request) => Promise<Response>
): CoreHttpServerInstance {
  if (customHttpServerFactory) {
    return customHttpServerFactory({ port, host, fetch: fetchHandler }) as CoreHttpServerInstance;
  }

  // 若处于原生 Bun 运行时
  if (typeof (globalThis as any).Bun !== "undefined" && typeof (globalThis as any).Bun.serve === "function") {
    const bunServer = (globalThis as any).Bun.serve({
      port,
      hostname: host,
      fetch: fetchHandler,
    });
    return {
      port: bunServer.port,
      stop: (closeActive?: boolean) => bunServer.stop(closeActive),
    };
  }

  // Node.js 原生 node:http 兜底实现
  const srv = createNodeHttpServer(async (req: IncomingMessage, res: ServerResponse) => {
    try {
      const protocol = (req.socket as any)?.encrypted ? "https" : "http";
      const hostHeader = req.headers.host || "127.0.0.1";
      const url = new URL(req.url || "/", `${protocol}://${hostHeader}`).href;

      const headers = new Headers();
      for (const [k, v] of Object.entries(req.headers)) {
        if (v === undefined) continue;
        if (Array.isArray(v)) {
          for (const item of v) headers.append(k, item);
        } else {
          headers.set(k, v);
        }
      }

      const method = (req.method || "GET").toUpperCase();
      const hasBody = method !== "GET" && method !== "HEAD";
      const init: RequestInit = { method, headers };
      if (hasBody) {
        (init as any).body = Readable.toWeb(req);
        (init as any).duplex = "half";
      }

      const webReq = new Request(url, init);
      const webRes = await fetchHandler(webReq);

      res.statusCode = webRes.status;
      if (webRes.statusText) res.statusMessage = webRes.statusText;
      webRes.headers.forEach((v, k) => res.setHeader(k, v));

      if (!webRes.body) {
        res.end();
        return;
      }
      await pipeline(Readable.fromWeb(webRes.body as any), res);
    } catch (err: any) {
      if (!res.headersSent) {
        res.statusCode = 500;
        res.end(JSON.stringify({ error: err?.message || String(err) }));
      } else {
        res.destroy(err);
      }
    }
  });

  srv.listen(port, host);
  const addr = srv.address();
  const actualPort = typeof addr === "object" && addr ? addr.port : port;

  return {
    port: actualPort,
    stop: () => {
      srv.close();
      (srv as any).closeAllConnections?.();
    },
  };
}

/**
 * 辅助函数：快速构造带 CORS 头的 JSON HTTP 响应。
 */
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

/**
 * 跨内存活跃连接与所有已知持久化存储全局检索指定 runId 的运行记录。
 */
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
      // 忽略读取错误
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
    // 忽略读取错误
  }

  return null;
}

/**
 * 辅助函数：依据 package 参数或项目上下文解析目标 Storage 实例与根目录。
 */
function resolveStorageForPackage(
  packageIdOrPath: string | undefined,
  runtimeRegistry: ServerRuntimeRegistry,
  projectRoot?: string | null,
  customHome?: string
): { packageId: string; storage: RuntimeStorage; projectRoot?: string } {
  if (packageIdOrPath) {
    const root = resolvePackageRoot(packageIdOrPath, customHome);
    if (root) {
      const config = loadProjectConfig(root);
      return {
        packageId: config.id,
        storage: runtimeRegistry.getStorage(config.id, root),
        projectRoot: root,
      };
    }
    return {
      packageId: packageIdOrPath,
      storage: runtimeRegistry.getStorage(packageIdOrPath),
    };
  }

  if (projectRoot) {
    const config = loadProjectConfig(projectRoot);
    return {
      packageId: config.id,
      storage: runtimeRegistry.getStorage(config.id, projectRoot),
      projectRoot,
    };
  }

  const linked = listLinkedPackages(customHome);
  if (linked.length > 0) {
    const first = linked[0];
    return {
      packageId: first.id,
      storage: runtimeRegistry.getStorage(first.id, first.path),
      projectRoot: first.path,
    };
  }

  return {
    packageId: "default",
    storage: runtimeRegistry.getStorage("default"),
  };
}

/**
 * 启动 ActionDock 2.0 原生轻量级 HTTP Runner 服务端。
 * 
 * 全面暴露 RESTful 调度与运维接口：
 * - GET  /api/v1/health             : 健康检查与就绪状态
 * - GET  /api/v1/info               : 统一自省探索（支持 ?intent= 智能决议、?package= 详情下钻、?tree=true 工作区拓扑）
 * - GET  /api/v1/doctor             : 深度环境与依赖诊断
 * - GET  /api/v1/actions            : 列出可用 Actions（支持 ?intent= 与 ?package=）
 * - GET  /api/v1/actions/:id        : 查看单个 Action 的 Schema 详情
 * - POST /api/v1/actions/:id/run    : 同步或异步执行 Action
 * - GET  /api/v1/playbooks          : 列出可用 Playbook 工作流
 * - GET  /api/v1/playbooks/:id      : 查看 Playbook 步骤流程与 SOP 规程正文
 * - GET  /api/v1/runs               : 多维检索历史运行记录
 * - POST /api/v1/runs/clear         : 批量清理历史运行记录
 * - GET  /api/v1/runs/:runId        : 查询历史或异步任务运行状态
 * - POST /api/v1/runs/:runId/cancel : 中断在途任务
 * - GET  /api/v1/runs/:runId/stream : 基于 SSE 实时长任务日志与进度流推送
 * - GET  /api/v1/state              : 检索状态键名列表
 * - GET  /api/v1/state/:key         : 获取指定状态值
 * - PUT  /api/v1/state/:key         : 写入持久化状态（支持 TTL）
 * - DELETE /api/v1/state/:key      : 删除指定状态
 * - POST /api/v1/state/clear        : 清空状态数据
 * - GET  /api/v1/config             : 获取配置项规格与当前值（敏感凭证脱敏）
 * - PUT  /api/v1/config             : 持久化更新配置
 * - DELETE /api/v1/config/:key      : 删除配置项
 * - GET  /api/v1/config/env         : 检查环境变量满足率
 * - ALL  /mcp                       : 一体化 MCP Streamable HTTP 协议端点（可选）
 */
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

  // 非回环地址强制要求配置 Token 鉴权（防裸奔）
  if (!isLoopbackHost(host) && !token && !options.allowInsecureNoAuth) {
    throw new Error(
      "Authentication token is required when binding to a non-loopback address. Use --allow-insecure-no-auth to override."
    );
  }

  const runtimeRegistry = new ServerRuntimeRegistry();

  const server = launchHttpServer(port, host, async (req) => {
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

      // 0. Health Check (supports /api/v1/health and /health)
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

      // 1. MCP Unified Gateway: /mcp
      if (
        options.enableMcp !== false &&
        options.mcpHandler &&
        (pathname === "/mcp" || pathname.startsWith("/mcp/"))
      ) {
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
        const mcpRes = await options.mcpHandler(req);
        if (mcpRes) return mcpRes;
      }

      // 鉴权检查（后续所有 /api/v1/* 均要求鉴权）
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

      // 2. Info 自省: GET /api/v1/info
      if (pathname === "/api/v1/info" && req.method === "GET") {
        try {
          const isTree = url.searchParams.get("tree") === "true";
          if (isTree) {
            const status = getRegistryStatus(customHome);
            return jsonResponse(
              { ok: true, type: "tree", ...status },
              200,
              corsHeaders
            );
          }

          const intent = url.searchParams.get("intent") || undefined;
          const targetPkg = url.searchParams.get("package") || undefined;

          // 收集所有候选包全量元数据
          const aggregatedPackages: any[] = [];

          if (projectRoot) {
            try {
              const config = loadProjectConfig(projectRoot);
              const actions = await loadActions(projectRoot, config.actionsDir);
              const playbooks = loadPlaybooks(projectRoot, config.playbooksDir);
              aggregatedPackages.push({
                id: config.id,
                name: config.name,
                version: config.version,
                description: config.description || "",
                path: projectRoot,
                actionsCount: actions.size,
                playbooksCount: playbooks.size,
                actions: Array.from(actions.entries()).map(([id, a]) => ({
                  id,
                  description: a.description || "",
                  inputSchema: a.inputSchema || null,
                  outputSchema: a.outputSchema || null,
                })),
                playbooks: Array.from(playbooks.entries()).map(([id, p]) => ({
                  id,
                  description: p.description || "",
                  actions: p.actions || [],
                })),
                configDeclared: config.config || {},
              });
            } catch {
              // 忽略解析异常
            }
          } else {
            const linked = listLinkedPackages(customHome);
            for (const pkg of linked) {
              if (!existsSync(pkg.path)) continue;
              try {
                const config = loadProjectConfig(pkg.path);
                const actions = await loadActions(pkg.path, config.actionsDir);
                const playbooks = loadPlaybooks(pkg.path, config.playbooksDir);
                aggregatedPackages.push({
                  id: config.id,
                  name: config.name,
                  version: config.version,
                  description: config.description || "",
                  path: pkg.path,
                  actionsCount: actions.size,
                  playbooksCount: playbooks.size,
                  actions: Array.from(actions.entries()).map(([id, a]) => ({
                    id,
                    description: a.description || "",
                    inputSchema: a.inputSchema || null,
                    outputSchema: a.outputSchema || null,
                  })),
                  playbooks: Array.from(playbooks.entries()).map(([id, p]) => ({
                    id,
                    description: p.description || "",
                    actions: p.actions || [],
                  })),
                  configDeclared: config.config || {},
                });
              } catch {
                // 忽略故障包
              }
            }
          }

          // 显式指定 package 详情下钻
          if (targetPkg) {
            const matched = aggregatedPackages.find(
              (p) => p.id === targetPkg || p.path === targetPkg
            );
            if (!matched) {
              return jsonResponse(
                {
                  ok: false,
                  error: {
                    code: "PACKAGE_NOT_FOUND",
                    message: `Package '${targetPkg}' not found on remote server`,
                  },
                },
                404,
                corsHeaders
              );
            }
            return jsonResponse(
              {
                ok: true,
                type: "package_detail",
                ...matched,
                ...(options.exposeDebugInfo ? { projectRoot: matched.path } : {}),
              },
              200,
              corsHeaders
            );
          }

          // 意图过滤与决议
          if (intent) {
            const filterRes = filterWithFallbackInfo(
              aggregatedPackages,
              intent,
              [
                (p) => p.id,
                (p) => p.name,
                (p) => p.description,
                (p) => p.actions.map((a: any) => a.id),
                (p) => p.actions.map((a: any) => a.description),
                (p) => p.playbooks.map((pb: any) => pb.id),
                (p) => p.playbooks.map((pb: any) => pb.description),
              ],
              true
            );

            // 唯一命中智能展开详情
            if (filterRes.matchedCount === 1) {
              const single = filterRes.items[0];
              return jsonResponse(
                {
                  ok: true,
                  type: "package_detail",
                  isSingleMatch: true,
                  ...single,
                  ...(options.exposeDebugInfo ? { projectRoot: single.path } : {}),
                },
                200,
                corsHeaders
              );
            }

            return jsonResponse(
              {
                ok: true,
                type: "package_list",
                isFallback: filterRes.isFallback,
                packages: filterRes.items,
              },
              200,
              corsHeaders
            );
          }

          // 单包模式直接展开详情
          if (projectRoot && aggregatedPackages.length === 1) {
            const p = aggregatedPackages[0];
            return jsonResponse(
              {
                ok: true,
                type: "package_detail",
                id: p.id,
                name: p.name,
                version: p.version,
                description: p.description,
                actionsCount: p.actionsCount,
                playbooksCount: p.playbooksCount,
                actions: p.actions.map((a: any) => a.id),
                actionsDetail: p.actions,
                playbooks: p.playbooks.map((pb: any) => pb.id),
                playbooksDetail: p.playbooks,
                configDeclared: p.configDeclared,
                linkedPackages: listLinkedPackages(customHome),
                ...(options.exposeDebugInfo ? { projectRoot } : {}),
              },
              200,
              corsHeaders
            );
          }

          // 全局注册表概览
          return jsonResponse(
            {
              ok: true,
              type: "package_list",
              version: "2.0.0",
              packages: aggregatedPackages,
              linkedPackages: listLinkedPackages(customHome),
            },
            200,
            corsHeaders
          );
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

      // 3. Doctor 深度体检: GET /api/v1/doctor
      if (pathname === "/api/v1/doctor" && req.method === "GET") {
        try {
          const targetPkg = url.searchParams.get("package") || undefined;
          const report = await runDoctorChecks({
            cwd: projectRoot || process.cwd(),
            packageIdOrPath: targetPkg,
            customHome,
          });
          return jsonResponse({ ok: true, report }, 200, corsHeaders);
        } catch (err: any) {
          return jsonResponse(
            { ok: false, error: { code: "DOCTOR_ERROR", message: err.message } },
            500,
            corsHeaders
          );
        }
      }

      // 4. Actions List: GET /api/v1/actions
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

      // 5. Action Show: GET /api/v1/actions/:id
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

      // 6. Action Run: POST /api/v1/actions/:id/run
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
          const actions = await loadActions(resolved.projectRoot, config.actionsDir);
          const storage = runtimeRegistry.getStorage(config.id, resolved.projectRoot);

          const runner = new ActionRunner({
            packageId: config.id,
            storage,
            projectConfig: config,
            configOverrides: body?.config || {},
            actions,
          });

          const isAsync = body?.execution?.mode === "async" || body?.async === true;
          const timeoutMs =
            typeof body?.execution?.timeoutMs === "number" && body.execution.timeoutMs > 0
              ? body.execution.timeoutMs
              : undefined;

          if (isAsync) {
            const handle = runner.start(resolved.actionId, body?.input || {}, {
              timeoutMs,
            });
            runtimeRegistry.executionManager.register(handle);

            // 监听结算以广播 SSE 完成事件
            handle.result
              .then((res) => {
                runtimeRegistry.emit(handle.runId, { type: "finish", data: res });
              })
              .catch((err) => {
                runtimeRegistry.emit(handle.runId, {
                  type: "finish",
                  data: {
                    ok: false,
                    error: {
                      code: "ACTION_EXECUTION_ERROR",
                      message: err?.message || String(err),
                    },
                  },
                });
              });

            return jsonResponse(
              {
                ok: true,
                runId: handle.runId,
                status: "running",
                streamUrl: `/api/v1/runs/${handle.runId}/stream`,
              },
              202,
              corsHeaders
            );
          }

          // 同步执行模式
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

      // 7. Playbooks List: GET /api/v1/playbooks
      if (pathname === "/api/v1/playbooks" && req.method === "GET") {
        try {
          const pbList: Array<{
            id: string;
            description: string;
            actions: string[];
            packageId: string;
            filePath: string;
          }> = [];

          const targetPkg = url.searchParams.get("package");
          const intent = url.searchParams.get("intent");

          const roots: Array<{ root: string; packageId: string }> = [];
          if (projectRoot) {
            const cfg = loadProjectConfig(projectRoot);
            roots.push({ root: projectRoot, packageId: cfg.id });
          }
          const linked = listLinkedPackages(customHome);
          for (const pkg of linked) {
            if (projectRoot && pkg.path === projectRoot) continue;
            if (!existsSync(pkg.path)) continue;
            roots.push({ root: pkg.path, packageId: pkg.id });
          }

          for (const item of roots) {
            if (targetPkg && item.packageId !== targetPkg && item.root !== targetPkg) continue;
            try {
              const cfg = loadProjectConfig(item.root);
              const pbs = loadPlaybooks(item.root, cfg.playbooksDir);
              for (const [id, pb] of pbs.entries()) {
                pbList.push({
                  id,
                  description: pb.description || "",
                  actions: pb.actions || [],
                  packageId: item.packageId,
                  filePath: pb.filePath,
                });
              }
            } catch {}
          }

          const filtered = intent
            ? filterByIntent(
                pbList,
                intent,
                [(p) => p.id, (p) => p.description, (p) => p.packageId, (p) => p.actions],
                false
              )
            : pbList;

          return jsonResponse(filtered, 200, corsHeaders);
        } catch (err: any) {
          return jsonResponse(
            { ok: false, error: { code: "PLAYBOOKS_LIST_ERROR", message: err.message } },
            500,
            corsHeaders
          );
        }
      }

      // 8. Playbook Show: GET /api/v1/playbooks/:id
      const pbShowMatch = pathname.match(/^\/api\/v1\/playbooks\/([^/]+)$/);
      if (pbShowMatch && req.method === "GET") {
        const pbId = decodeURIComponent(pbShowMatch[1]);
        try {
          const resolved = resolvePlaybookProject(
            pbId,
            projectRoot || process.cwd(),
            customHome
          );
          const pb = resolved.playbook;
          return jsonResponse(
            {
              ok: true,
              id: pb.id,
              packageId: resolved.packageId,
              description: pb.description || "",
              actions: pb.actions || [],
              filePath: pb.filePath,
              content: pb.content,
            },
            200,
            corsHeaders
          );
        } catch (err: any) {
          return jsonResponse(
            { ok: false, error: { code: "PLAYBOOK_NOT_FOUND", message: err.message } },
            404,
            corsHeaders
          );
        }
      }

      // 9. Runs List: GET /api/v1/runs
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

      // 10. Runs Clear: POST /api/v1/runs/clear or DELETE /api/v1/runs
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

      // 11. Run Stream (SSE): GET /api/v1/runs/:runId/stream
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

        const stream = new ReadableStream({
          start(controller) {
            const encoder = new TextEncoder();
            const sendEvent = (event: string, data: any) => {
              try {
                controller.enqueue(
                  encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
                );
              } catch {}
            };

            if (activeHandle) {
              sendEvent("status", { runId, status: "running" });
              const unsubscribe = runtimeRegistry.subscribe(runId, (evt) => {
                sendEvent(evt.type, evt.data);
                if (evt.type === "finish") {
                  try { controller.close(); } catch {}
                }
              });

              activeHandle.result.then(
                (res) => {
                  sendEvent("finish", res);
                  try { controller.close(); } catch {}
                },
                (err) => {
                  sendEvent("finish", {
                    ok: false,
                    error: { message: err?.message || String(err) },
                  });
                  try { controller.close(); } catch {}
                }
              );

              req.signal.addEventListener("abort", () => {
                unsubscribe();
                try { controller.close(); } catch {}
              });
            } else if (found) {
              sendEvent("finish", found.run);
              controller.close();
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

      // 12. Run Show: GET /api/v1/runs/:runId
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

      // 13. Run Cancel: POST /api/v1/runs/:runId/cancel
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

      // 14. State List: GET /api/v1/state
      if (pathname === "/api/v1/state" && req.method === "GET") {
        try {
          const pkgParam = url.searchParams.get("package") || undefined;
          const nsParam = url.searchParams.get("namespace") ?? undefined;
          const prefix = url.searchParams.get("prefix") || "";

          const { packageId, storage } = resolveStorageForPackage(
            pkgParam,
            runtimeRegistry,
            projectRoot,
            customHome
          );
          const keys = await storage.listStateKeys(nsParam !== undefined ? nsParam : null, prefix);
          return jsonResponse({ ok: true, packageId, keys }, 200, corsHeaders);
        } catch (err: any) {
          return jsonResponse(
            { ok: false, error: { code: "STATE_LIST_ERROR", message: err.message } },
            500,
            corsHeaders
          );
        }
      }

      // 15. State Clear: POST /api/v1/state/clear
      if (pathname === "/api/v1/state/clear" && req.method === "POST") {
        try {
          const body = await readJsonBody(req, { maxBytes: options.maxBodyBytes }).catch(() => ({}));
          const pkgParam = url.searchParams.get("package") || body.package || undefined;
          const { packageId, storage } = resolveStorageForPackage(
            pkgParam,
            runtimeRegistry,
            projectRoot,
            customHome
          );
          const clearedCount = await storage.clearState({
            namespace: body.namespace ?? (url.searchParams.get("namespace") || undefined),
            all: Boolean(body.all ?? url.searchParams.get("all") === "true"),
            prefix: body.prefix ?? (url.searchParams.get("prefix") || undefined),
          });
          return jsonResponse({ ok: true, packageId, clearedCount }, 200, corsHeaders);
        } catch (err: any) {
          return jsonResponse(
            { ok: false, error: { code: "STATE_CLEAR_ERROR", message: err.message } },
            500,
            corsHeaders
          );
        }
      }

      // 16. State Key CRUD: GET / PUT / POST / DELETE /api/v1/state/:key
      const stateKeyMatch = pathname.match(/^\/api\/v1\/state\/([^/]+)$/);
      if (stateKeyMatch) {
        const key = decodeURIComponent(stateKeyMatch[1]);
        const pkgParam = url.searchParams.get("package") || undefined;
        const nsParam = url.searchParams.get("namespace") || undefined;

        const { packageId, storage } = resolveStorageForPackage(
          pkgParam,
          runtimeRegistry,
          projectRoot,
          customHome
        );

        if (req.method === "GET") {
          const entry = await storage.findState(key, nsParam);
          if (!entry || entry.value === undefined) {
            return jsonResponse(
              { ok: false, error: { code: "STATE_KEY_NOT_FOUND", message: `State key '${key}' not found` } },
              404,
              corsHeaders
            );
          }
          return jsonResponse(
            {
              ok: true,
              packageId,
              key: entry.key,
              namespace: entry.namespace,
              value: entry.value,
              expiresAt: entry.expiresAt,
            },
            200,
            corsHeaders
          );
        }

        if (req.method === "PUT" || req.method === "POST") {
          const body = await readJsonBody(req, { maxBytes: options.maxBodyBytes });
          const val = body.value !== undefined ? body.value : body;
          const ttl = typeof body.ttl === "number" ? body.ttl : undefined;
          const namespace = body.namespace || nsParam || "";

          let actualKey = key;
          let ns = namespace;
          if (!ns && key.includes(":")) {
            const idx = key.indexOf(":");
            ns = key.slice(0, idx);
            actualKey = key.slice(idx + 1);
          }

          await storage.setState(ns, actualKey, val, ttl);
          return jsonResponse(
            { ok: true, packageId, key: actualKey, namespace: ns, message: "updated" },
            200,
            corsHeaders
          );
        }

        if (req.method === "DELETE") {
          const deleted = await storage.deleteStateSmart(key, nsParam);
          if (!deleted) {
            return jsonResponse(
              { ok: false, error: { code: "STATE_KEY_NOT_FOUND", message: `State key '${key}' not found` } },
              404,
              corsHeaders
            );
          }
          return jsonResponse({ ok: true, packageId, key, deleted: true }, 200, corsHeaders);
        }
      }

      // 17. Config Env Check: GET /api/v1/config/env
      if (pathname === "/api/v1/config/env" && req.method === "GET") {
        try {
          const pkgParam = url.searchParams.get("package") || undefined;
          const { packageId, projectRoot: root } = resolveStorageForPackage(
            pkgParam,
            runtimeRegistry,
            projectRoot,
            customHome
          );
          if (!root) {
            return jsonResponse({ ok: true, packageId, envChecks: [] }, 200, corsHeaders);
          }
          const cfg = loadProjectConfig(root);
          const declared = cfg.config || {};
          const envChecks: any[] = [];
          for (const [k, def] of Object.entries(declared)) {
            const envKeys = [
              k,
              `ACTIONDOCK_${k}`,
              `${packageId.toUpperCase().replace(/[^A-Z0-9]/g, "_")}_${k}`,
            ];
            const foundEnv = envKeys.find((ek) => process.env[ek] !== undefined);
            envChecks.push({
              key: k,
              required: def.default === undefined,
              satisfied: Boolean(foundEnv || def.default !== undefined),
              matchedEnv: foundEnv || null,
              hasDefault: def.default !== undefined,
              secret: Boolean(def.secret),
            });
          }
          return jsonResponse({ ok: true, packageId, envChecks }, 200, corsHeaders);
        } catch (err: any) {
          return jsonResponse(
            { ok: false, error: { code: "CONFIG_ENV_ERROR", message: err.message } },
            500,
            corsHeaders
          );
        }
      }

      // 18. Config Query: GET /api/v1/config
      if (pathname === "/api/v1/config" && req.method === "GET") {
        try {
          const pkgParam = url.searchParams.get("package") || undefined;
          const { packageId, storage, projectRoot: root } = resolveStorageForPackage(
            pkgParam,
            runtimeRegistry,
            projectRoot,
            customHome
          );
          const stored = storage.listConfig();
          let declared: Record<string, any> = {};
          if (root) {
            try {
              const cfg = loadProjectConfig(root);
              declared = cfg.config || {};
            } catch {}
          }
          const maskedValues: Record<string, any> = {};
          for (const [k, v] of Object.entries(stored)) {
            if (declared[k]?.secret) {
              maskedValues[k] = "******";
            } else {
              maskedValues[k] = v;
            }
          }
          return jsonResponse(
            { ok: true, packageId, declared, values: maskedValues },
            200,
            corsHeaders
          );
        } catch (err: any) {
          return jsonResponse(
            { ok: false, error: { code: "CONFIG_LIST_ERROR", message: err.message } },
            500,
            corsHeaders
          );
        }
      }

      // 19. Config Update: PUT / POST /api/v1/config
      if (pathname === "/api/v1/config" && (req.method === "PUT" || req.method === "POST")) {
        try {
          const body = await readJsonBody(req, { maxBytes: options.maxBodyBytes });
          const pkgParam = url.searchParams.get("package") || body.package || undefined;
          const { packageId, storage } = resolveStorageForPackage(
            pkgParam,
            runtimeRegistry,
            projectRoot,
            customHome
          );
          const key = body.key;
          if (!key) {
            return jsonResponse(
              { ok: false, error: { code: "INVALID_ARGUMENT", message: "Config 'key' is required" } },
              400,
              corsHeaders
            );
          }
          storage.setConfig(key, body.value);
          return jsonResponse({ ok: true, packageId, key, message: "updated" }, 200, corsHeaders);
        } catch (err: any) {
          return jsonResponse(
            { ok: false, error: { code: "CONFIG_SET_ERROR", message: err.message } },
            500,
            corsHeaders
          );
        }
      }

      // 20. Config Delete: DELETE /api/v1/config/:key
      const configKeyMatch = pathname.match(/^\/api\/v1\/config\/([^/]+)$/);
      if (configKeyMatch && req.method === "DELETE") {
        try {
          const key = decodeURIComponent(configKeyMatch[1]);
          const pkgParam = url.searchParams.get("package") || undefined;
          const { packageId, storage } = resolveStorageForPackage(
            pkgParam,
            runtimeRegistry,
            projectRoot,
            customHome
          );
          const deleted = storage.deleteConfig(key);
          return jsonResponse({ ok: true, packageId, key, deleted }, 200, corsHeaders);
        } catch (err: any) {
          return jsonResponse(
            { ok: false, error: { code: "CONFIG_DELETE_ERROR", message: err.message } },
            500,
            corsHeaders
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
        404,
        corsHeaders
      );
    }
  );

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
