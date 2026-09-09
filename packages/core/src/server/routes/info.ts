import { existsSync } from "node:fs";
import { filterWithFallbackInfo } from "../../filter";
import { loadActions, loadPlaybooks, loadProjectConfig } from "../../project/loader";
import { getRegistryStatus, listLinkedPackages } from "../../registry/registry";
import { ACTIONDOCK_VERSION } from "../../version";
import { type RouteContext, jsonResponse } from "./common";

/**
 * 处理系统探索与自省接口（GET /api/v1/info）。
 */
export async function handleInfoRoute(ctx: RouteContext): Promise<Response | null> {
  const { req, url, pathname, corsHeaders, projectRoot, customHome, options } = ctx;

  if (pathname !== "/api/v1/info" || req.method !== "GET") {
    return null;
  }

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
        const actions = await loadActions(projectRoot, config.actionsDir, { autoInstall: false });
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
          const actions = await loadActions(pkg.path, config.actionsDir, { autoInstall: false });
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
        version: ACTIONDOCK_VERSION,
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
