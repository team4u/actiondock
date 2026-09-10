import { filterByIntent } from "../../filter";
import { getSubPath, jsonResponse, type RouteContext } from "./common";

/**
 * 处理 Playbook 规程相关的 HTTP 路由（列表与 SOP 详情查询）。
 */
export async function handlePlaybooksRoutes(ctx: RouteContext): Promise<Response | null> {
  const { req, url, pathname, corsHeaders, target } = ctx;
  const subpath = getSubPath(pathname);

  // 1. Playbooks List: GET /api/v2/playbooks, GET /playbooks
  if (subpath === "/playbooks" && req.method === "GET") {
    try {
      const intent = url.searchParams.get("intent") || undefined;
      const targetPkg = url.searchParams.get("package") || url.searchParams.get("packageId") || undefined;

      let pbs = await target.listPlaybooks({ intent, package: targetPkg });

      if (targetPkg) {
        pbs = pbs.filter((p) => p.packageId === targetPkg);
      }

      if (intent) {
        pbs = filterByIntent(
          pbs,
          intent,
          [(p) => p.id, (p) => p.description || "", (p) => p.packageId || "", (p) => (p.actions || []).join(" ")],
          false
        );
      }

      return jsonResponse(pbs, 200, corsHeaders);
    } catch (err: any) {
      return jsonResponse(
        { ok: false, error: { code: "PLAYBOOKS_LIST_ERROR", message: err.message } },
        500,
        corsHeaders
      );
    }
  }

  // 2. Multi-package Playbook Show: GET /api/v2/packages/:packageId/playbooks/:playbookId
  const pkgPlaybookMatch = subpath.match(/^\/packages\/([^/]+)\/playbooks\/([^/]+)$/);
  if (pkgPlaybookMatch && req.method === "GET") {
    const packageId = decodeURIComponent(pkgPlaybookMatch[1]);
    const playbookId = decodeURIComponent(pkgPlaybookMatch[2]);
    const ref = `${packageId}/${playbookId}`;
    try {
      const pb = await target.describePlaybook(ref);
      return jsonResponse(pb, 200, corsHeaders);
    } catch (err: any) {
      return jsonResponse(
        {
          ok: false,
          error: {
            code: "PLAYBOOK_NOT_FOUND",
            message: err.message || `Playbook '${playbookId}' not found in package '${packageId}'`,
          },
        },
        404,
        corsHeaders
      );
    }
  }

  // 3. Short Playbook Show: GET /api/v2/playbooks/:id, GET /playbooks/:id
  const playbookMatch = subpath.match(/^\/playbooks\/(.+)$/);
  if (playbookMatch && req.method === "GET") {
    const playbookId = decodeURIComponent(playbookMatch[1]);
    try {
      const pb = await target.describePlaybook(playbookId);
      return jsonResponse(pb, 200, corsHeaders);
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
