import { filterByIntent } from "../../filter";
import { assertPackageAllowed, getSubPath, jsonResponse, type RouteContext } from "./common";

/**
 * 处理 Playbook 规程相关的 HTTP 路由（列表与 SOP 详情查询）。
 */
export async function handlePlaybooksRoutes(ctx: RouteContext): Promise<Response | null> {
  const { req, url, pathname, corsHeaders, target, host, options } = ctx;
  const subpath = getSubPath(pathname);

  // 1. Playbooks List: GET /api/v2/playbooks, GET /playbooks
  if (subpath === "/playbooks" && req.method === "GET") {
    try {
      const intent = url.searchParams.get("intent") || undefined;
      const targetPkg = url.searchParams.get("package") || url.searchParams.get("packageId") || undefined;

      if (targetPkg) {
        assertPackageAllowed(targetPkg, options);
      }

      let pbs = await target.listPlaybooks({ intent, package: targetPkg });

      if (targetPkg) {
        pbs = pbs.filter((p) => p.packageId === targetPkg);
      }

      if (options.packageAllowlist && Array.isArray(options.packageAllowlist) && options.packageAllowlist.length > 0) {
        pbs = pbs.filter((p) => p.packageId && options.packageAllowlist!.includes(p.packageId));
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
      if (err.code === "PACKAGE_NOT_ALLOWED" || err.status === 403) {
        return jsonResponse(
          {
            ok: false,
            error: {
              code: "PACKAGE_NOT_ALLOWED",
              message: err.message || "Package is not in the allowed package list",
            },
          },
          403,
          corsHeaders
        );
      }
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
    try {
      assertPackageAllowed(packageId, options);
    } catch (err: any) {
      return jsonResponse(
        {
          ok: false,
          error: {
            code: "PACKAGE_NOT_ALLOWED",
            message: err.message || `Package '${packageId}' is not in the allowed package list`,
          },
        },
        403,
        corsHeaders
      );
    }

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
    if (playbookId.includes("/")) {
      const pkgFromRef = playbookId.slice(0, playbookId.lastIndexOf("/"));
      try {
        assertPackageAllowed(pkgFromRef, options);
      } catch (err: any) {
        return jsonResponse(
          {
            ok: false,
            error: {
              code: "PACKAGE_NOT_ALLOWED",
              message: err.message || `Package '${pkgFromRef}' is not in the allowed package list`,
            },
          },
          403,
          corsHeaders
        );
      }
    }

    try {
      const pb = await target.describePlaybook(playbookId);
      let pkgId = (pb as any).packageId;
      if (!pkgId && host) {
        for (const app of host.listApps()) {
          try {
            const map = (app as any).getStaticPlaybookMap?.();
            const cleanId = playbookId.replace(/\.md$/, "");
            if (map?.has(cleanId) || map?.has(playbookId)) {
              pkgId = app.packageId;
              break;
            }
          } catch {}
        }
      }
      if (!pkgId) {
        const allPbs = await target.listPlaybooks().catch(() => []);
        const matched = allPbs.find((p) => p.id === playbookId || p.id.endsWith(`/${playbookId}`));
        if (matched?.packageId) {
          pkgId = matched.packageId;
        }
      }
      if (pkgId) {
        assertPackageAllowed(pkgId, options);
      }
      return jsonResponse(pb, 200, corsHeaders);
    } catch (err: any) {
      if (err.code === "PACKAGE_NOT_ALLOWED" || err.status === 403) {
        return jsonResponse(
          {
            ok: false,
            error: {
              code: "PACKAGE_NOT_ALLOWED",
              message: err.message || "Package is not in the allowed package list",
            },
          },
          403,
          corsHeaders
        );
      }
      return jsonResponse(
        { ok: false, error: { code: "PLAYBOOK_NOT_FOUND", message: err.message } },
        404,
        corsHeaders
      );
    }
  }

  return null;
}
