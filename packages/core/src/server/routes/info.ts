import { filterWithFallbackInfo } from "../../utils/intent";
import { INFO_ERROR, PACKAGE_NOT_ALLOWED, PACKAGE_NOT_FOUND, PACKAGES_INFO_ERROR } from "../../errors";
import { ACTIONDOCK_VERSION } from "../../version";
import { sanitizeConfigDefinitions } from "../../storage";
import { parseActionRef } from "../../catalog/resolve-action";
import {
  assertPackageVisible,
  filterPackagesByPolicy,
  getSubPath,
  jsonResponse,
  requiresMinimalPackageProjection,
  type RouteContext,
} from "./common";

function sanitizePackage<T extends { config?: any }>(pkg: T, exposeDebugInfo?: boolean): T {
  if (!pkg) return pkg;
  const sanitized: any = {
    ...pkg,
    ...(pkg.config ? { config: sanitizeConfigDefinitions(pkg.config) } : {}),
  };
  if (exposeDebugInfo !== true) {
    delete sanitized.packageRoot;
    delete sanitized.path;
  }
  return sanitized;
}

/**
 * 仅在部分授权包缺少动作清单时补查目录；已有真实清单时不增加查询。
 */
function requiresCatalogForMinimalProjection(
  packages: Array<{ id: string; actions?: string[] }>,
  policy: RouteContext["activePolicy"]
): boolean {
  return packages.some((p) =>
    requiresMinimalPackageProjection(p.id, policy) && !Array.isArray(p.actions)
  );
}

/**
 * 拉取真实动作目录并按包分组，查询失败交由路由返回错误，不能伪造发现结果。
 */
async function listCatalogActionIds(
  service: RouteContext["service"]
): Promise<Map<string, string[]>> {
  const actions = await service.discovery.listActions();
  const byPackage = new Map<string, string[]>();
  for (const act of actions) {
    const parsed = parseActionRef(act.id);
    const pkgId = act.packageId || parsed.packageId;
    if (!pkgId) continue;
    const bucket = byPackage.get(pkgId) || [];
    if (!bucket.includes(parsed.actionId)) {
      bucket.push(parsed.actionId);
    }
    byPackage.set(pkgId, bucket);
  }
  return byPackage;
}

/**
 * 按当前生效策略统一投影包信息。
 * 整包授权与全量授权沿用安全脱敏后的完整结构；
 * 仅持有单动作授权的包收缩为最小身份元数据：
 * 仅保留 id、name、version、description 与已授权动作列表信息，
 * 不泄露 actionsDir/playbooksDir/config/actions 完整清单/playbooks/packageRoot 等结构。
 * 授权动作引用统一经 core parseActionRef 单一事实源归一化
 * （兼容 @scope/pkg/read 形态与前后空白），与鉴权判定同源；
 * 返回的已授权动作与真实包清单取交集并去重，
 * 不把不存在的声明动作当成已发现能力，真实清单查询失败时透明返回错误。
 * 统一投影单点收敛，避免各响应分支复制裁剪逻辑。
 */
function projectPackageForPolicy<
  T extends {
    id: string;
    config?: any;
    name?: string;
    version?: string;
    description?: string;
    actions?: string[];
    actionsCount?: number;
    playbooks?: string[];
    playbooksCount?: number;
  }
>(
  pkg: T,
  policy: RouteContext["activePolicy"],
  exposeDebugInfo?: boolean,
  realActionIds?: Map<string, string[]>
): T {
  const sanitized = sanitizePackage(pkg, exposeDebugInfo);
  if (!requiresMinimalPackageProjection(pkg.id, policy)) {
    return sanitized;
  }
  // 授权引用统一归一化，支持带作用域的包标识和引用两端的空白。
  const grantedRefs = new Set<string>();
  for (const ref of policy.actionAllowlist || []) {
    const parsed = parseActionRef(ref);
    if (parsed.packageId === pkg.id) {
      grantedRefs.add(parsed.actionId);
    }
  }
  // 授权声明只用于过滤真实清单，不能替代已注册能力。
  const declaredRealActions = Array.isArray(sanitized.actions)
    ? sanitized.actions
    : realActionIds?.get(pkg.id) || [];
  const grantedActionIds = Array.from(new Set(
    declaredRealActions
      .map((id) => parseActionRef(id).actionId)
      .filter((id) => grantedRefs.has(id))
  ));
  const minimal: any = {
    id: sanitized.id,
    ...(sanitized.name !== undefined ? { name: sanitized.name } : {}),
    ...(sanitized.version !== undefined ? { version: sanitized.version } : {}),
    ...(sanitized.description !== undefined ? { description: sanitized.description } : {}),
    actions: grantedActionIds,
    actionsCount: grantedActionIds.length,
  };
  return minimal;
}

/**
 * 处理系统自省与包信息接口：
 * - GET /api/v2/info 与 GET /info -> 委托 service.info()
 * - GET /api/v2/packages 与 GET /packages -> 委托 service.discovery.listPackages()
 */
export async function handleInfoRoute(ctx: RouteContext): Promise<Response | null> {
  const { req, url, pathname, corsHeaders, options, service, projectRoot, activePolicy: policy } = ctx;
  const subpath = getSubPath(pathname);

  // 1. Packages List: GET /api/v2/packages, /packages
  if ((subpath === "/packages" || pathname === "/api/v2/packages" || pathname === "/packages") && req.method === "GET") {
    try {
      const targetPkg = url.searchParams.get("package") || url.searchParams.get("packageId") || undefined;
      if (targetPkg) {
        assertPackageVisible(targetPkg, policy);
      }

      const rawPackages = await service.discovery.listPackages();
      // 缺少包内清单时补查真实目录，查询失败不得伪造已发现能力。
      const realActionIds = requiresCatalogForMinimalProjection(rawPackages, policy)
        ? await listCatalogActionIds(service)
        : undefined;
      const packages = filterPackagesByPolicy(
        rawPackages.map((p) =>
          projectPackageForPolicy(
            p,
            policy,
            options.exposeDebugInfo,
            realActionIds
          )
        ),
        policy
      );
      return jsonResponse(
        {
          ok: true,
          packages,
        },
        200,
        corsHeaders
      );
    } catch (err: any) {
      if (err.code === PACKAGE_NOT_ALLOWED || err.status === 403) {
        return jsonResponse(
          {
            ok: false,
            error: {
              code: PACKAGE_NOT_ALLOWED,
              message: err.message || "Package is not in the allowed package list",
            },
          },
          403,
          corsHeaders
        );
      }
      return jsonResponse(
        {
          ok: false,
          error: { code: PACKAGES_INFO_ERROR, message: err.message },
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

      if (targetPkg) {
        assertPackageVisible(targetPkg, policy);
      }

      const rawPackages = await service.info();
      const realActionIds = requiresCatalogForMinimalProjection(rawPackages, policy)
        ? await listCatalogActionIds(service)
        : undefined;
      const packages = filterPackagesByPolicy(
        rawPackages.map((p) =>
          projectPackageForPolicy(
            p,
            policy,
            options.exposeDebugInfo,
            realActionIds
          )
        ),
        policy
      );

      if (isTree) {
        return jsonResponse(
          { ok: true, type: "tree", packages },
          200,
          corsHeaders
        );
      }

      // 显式指定 package 详情下钻：最小投影包仅返回最小身份元数据，
      // 不能借单动作授权展开完整包结构
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
        const isMinimal = requiresMinimalPackageProjection(matched.id, policy);
        if (isMinimal) {
          return jsonResponse(
            {
              ok: true,
              type: "package_detail",
              ...matched,
            },
            200,
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
          const isMinimal = requiresMinimalPackageProjection(single.id, policy);
          return jsonResponse(
            {
              ok: true,
              type: "package_detail",
              isSingleMatch: true,
              ...single,
              ...(options.exposeDebugInfo && !isMinimal
                ? { projectRoot: (single as any).packageRoot || projectRoot }
                : {}),
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

      // 单包模式下展开详情：最小投影包不展开 projectRoot 等调试信息
      if (packages.length === 1) {
        const p = packages[0];
        const isMinimal = requiresMinimalPackageProjection(p.id, policy);
        return jsonResponse(
          {
            ok: true,
            type: "package_detail",
            ...p,
            packages,
            ...(options.exposeDebugInfo && !isMinimal
              ? { projectRoot: (p as any).packageRoot || projectRoot }
              : {}),
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
      if (err.code === PACKAGE_NOT_ALLOWED || err.status === 403) {
        return jsonResponse(
          {
            ok: false,
            error: {
              code: PACKAGE_NOT_ALLOWED,
              message: err.message || "Package is not in the allowed package list",
            },
          },
          403,
          corsHeaders
        );
      }
      return jsonResponse(
        { ok: false, error: { code: INFO_ERROR, message: err.message } },
        500,
        corsHeaders
      );
    }
  }

  return null;
}
