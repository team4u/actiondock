import type { PackageInfo } from "../../package/types";
import { assertValidPackageId } from "../../utils";
import { ActionDockError, PACKAGE_NOT_FOUND } from "../../errors";
import type { EffectiveServerPolicy, RouteContext, ServerOptions } from "../types";
import {
  ActionForbiddenError,
  assertActionAllowedByPolicy,
  assertPackageAllowedByPolicy,
  filterActionsByPolicy,
  filterPackagesByPolicy,
  isActionAllowed,
  isActionAllowedByPolicy,
  isManagementAllowedByPolicy,
  isPackageAllowedByPolicy,
  PackageNotAllowedError,
} from "../policy";

export type { RouteContext };

export {
  ActionForbiddenError,
  PackageNotAllowedError,
  isActionAllowed,
  isActionAllowedByPolicy,
  isPackageAllowedByPolicy,
  isManagementAllowedByPolicy,
  filterActionsByPolicy,
  filterPackagesByPolicy,
  assertActionAllowedByPolicy,
  assertPackageAllowedByPolicy,
};

/**
 * 构造带 CORS 头的标准 JSON HTTP 响应。
 */
export function jsonResponse(
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
 * 剥离标准版本前缀 (/api/v2/)，获取相对路由子路径。
 */
export function getSubPath(pathname: string): string {
  if (pathname.startsWith("/api/v2/")) {
    return pathname.slice(7);
  }
  return pathname;
}

/**
 * 校验目标 action 是否属于允许动作白名单。
 * 当 options 或 policy 中的 actionAllowlist 存在且目标 action 不在白名单中时抛出 403 ACTION_FORBIDDEN 异常。
 */
export function assertActionAllowed(
  action: { actionId?: string; id?: string; packageId?: string } | string,
  options?: ServerOptions | EffectiveServerPolicy
): void {
  const policy: EffectiveServerPolicy | undefined = options
    ? {
        packageAllowlist: options.packageAllowlist,
        actionAllowlist: options.actionAllowlist,
      }
    : undefined;
  assertActionAllowedByPolicy(action, policy);
}

/**
 * 校验目标 packageId 是否属于允许包白名单。
 * 当 options 或 policy 中的 packageAllowlist 存在且目标 packageId 不在白名单中时抛出 403 PACKAGE_NOT_ALLOWED 异常。
 */
export function assertPackageAllowed(
  packageId: string,
  options?: ServerOptions | EffectiveServerPolicy
): void {
  const policy: EffectiveServerPolicy | undefined = options
    ? {
        packageAllowlist: options.packageAllowlist,
      }
    : undefined;
  assertPackageAllowedByPolicy(packageId, policy);
}

/**
 * 解析并确定生效的目标 packageId。
 * 遵循严格的解析规则与白名单检查。
 */
export function resolveTargetPackageId(
  packages: PackageInfo[],
  requestedPackageId?: string,
  options?: ServerOptions | EffectiveServerPolicy
): string {
  const allowlist = options?.packageAllowlist;
  if (requestedPackageId) {
    if (requestedPackageId === "global") {
      return "global";
    }
    assertValidPackageId(requestedPackageId);
    assertPackageAllowed(requestedPackageId, options);
    const matched = packages.find(
      (p) => p.id === requestedPackageId || p.packageRoot === requestedPackageId
    );
    if (!matched) {
      throw new ActionDockError(
        PACKAGE_NOT_FOUND,
        `Unknown or unregistered package: '${requestedPackageId}'`
      );
    }
    return matched.id;
  }

  let targetId: string;
  if (
    allowlist &&
    Array.isArray(allowlist) &&
    allowlist.length > 0
  ) {
    const allowed = packages.find((p) => allowlist.includes(p.id));
    targetId = allowed ? allowed.id : (packages[0]?.id || "");
  } else if (packages.length > 0) {
    targetId = packages[0].id;
  } else {
    throw new ActionDockError(PACKAGE_NOT_FOUND, "No registered package found in service");
  }

  assertPackageAllowed(targetId, options);
  return targetId;
}
