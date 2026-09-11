import { filterWithFallbackInfo } from "../../filter";
import { PACKAGE_NOT_FOUND } from "../../errors";
import { ACTIONDOCK_VERSION } from "../../version";
import { getSubPath, jsonResponse, type RouteContext } from "./common";

/**
 * 处理系统自省与包信息接口：
 * - GET /api/v2/info 与 GET /info -> 委托 target.info()
 * - GET /api/v2/packages 与 GET /packages -> 委托 host.info() 或 target.info()
 */
export async function handleInfoRoute(ctx: RouteContext): Promise<Response | null> {
  const { req, url, pathname, corsHeaders, options, target, host, projectRoot } = ctx;
  const subpath = getSubPath(pathname);

  // 1. Packages List: GET /api/v2/packages, /packages
  if ((subpath === "/packages" || pathname === "/api/v2/packages" || pathname === "/packages") && req.method === "GET") {
    try {
      const packages = target ? await target.listPackages() : (host ? await host.info() : []);
      return jsonResponse(
        {
          ok: true,
          packages,
        },
        200,
        corsHeaders
      );
    } catch (err: any) {
      return jsonResponse(
        {
          ok: false,
          error: { code: "PACKAGES_INFO_ERROR", message: err.message },
        },
        500,
        corsHeaders
      );
    }
  }

  // 2. Info: GET /api/v2/info, /info
  if ((subpath === "/info" || pathname === "/api/v2/info" || pathname === "/info") && req.method === "GET") {
    try {
      const isTree = url.searchParams.get("tree") === "true";
      const intent = url.searchParams.get("intent") || undefined;
      const targetPkg = url.searchParams.get("package") || url.searchParams.get("packageId") || undefined;

      const targetInfo = await target.info();
      const packages = targetInfo.packages || [];

      if (isTree) {
        return jsonResponse(
          { ok: true, type: "tree", packages },
          200,
          corsHeaders
        );
      }

      // 显式指定 package 详情下钻
      if (targetPkg) {
        const matched = packages.find(
          (p) => p.id === targetPkg || (p as any).packageRoot === targetPkg || (p as any).path === targetPkg
        );
        if (!matched) {
          return jsonResponse(
            {
              ok: false,
              error: {
                code: PACKAGE_NOT_FOUND,
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
            ...(options.exposeDebugInfo ? { projectRoot: (matched as any).packageRoot || projectRoot } : {}),
          },
          200,
          corsHeaders
        );
      }

      // 意图过滤
      if (intent) {
        const filterRes = filterWithFallbackInfo(
          packages,
          intent,
          [
            (p: any) => p.id,
            (p: any) => p.name,
            (p: any) => p.description,
          ],
          true
        );

        if (filterRes.matchedCount === 1) {
          const single = filterRes.items[0];
          return jsonResponse(
            {
              ok: true,
              type: "package_detail",
              isSingleMatch: true,
              ...single,
              ...(options.exposeDebugInfo ? { projectRoot: (single as any).packageRoot || projectRoot } : {}),
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

      // 单包模式下展开详情
      if (packages.length === 1) {
        const p = packages[0];
        return jsonResponse(
          {
            ok: true,
            type: "package_detail",
            ...p,
            packages,
            ...(options.exposeDebugInfo ? { projectRoot: (p as any).packageRoot || projectRoot } : {}),
          },
          200,
          corsHeaders
        );
      }

      // 多包列表概览
      return jsonResponse(
        {
          ok: true,
          type: "package_list",
          version: ACTIONDOCK_VERSION,
          packages,
          ...(options.exposeDebugInfo ? { projectRoot } : {}),
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

  return null;
}
