import { existsSync } from "node:fs";
import { filterByIntent } from "../../filter";
import { loadPlaybooks, loadProjectConfig } from "../../project/loader";
import { listLinkedPackages, resolvePlaybookProject } from "../../registry/registry";
import { type RouteContext, jsonResponse } from "./common";

/**
 * 处理 Playbook 列表与 SOP 详情接口。
 */
export async function handlePlaybooksRoutes(ctx: RouteContext): Promise<Response | null> {
  const { req, url, pathname, corsHeaders, projectRoot, customHome } = ctx;

  // 1. Playbooks List: GET /api/v1/playbooks
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

  // 2. Playbook Show: GET /api/v1/playbooks/:id
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

  return null;
}
