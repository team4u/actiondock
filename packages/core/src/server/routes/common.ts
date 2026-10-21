import type { PackageInfo } from "../../package/types";
import { assertValidPackageId } from "../../utils";
import { ActionDockError, PACKAGE_NOT_ALLOWED, PACKAGE_NOT_FOUND } from "../../errors";
import type { EffectiveServerPolicy, RouteContext, ServerOptions } from "../types";
import {
  ActionForbiddenError,
  assertActionAllowedByPolicy,
  assertPackageAllowedByPolicy,
  filterActionsByPolicy,
  filterPackagesByPolicy,
  isActionAllowed,
  isActionAllowedByPolicy,
  isFullAccessGranted,
  isManagementAllowedByPolicy,
  isPackageAllowedByPolicy,
  isPackageVisibleByPolicy,
  PackageNotAllowedError,
  requiresMinimalPackageProjection,
} from "../policy";

export type { RouteContext };
export {
  ActionForbiddenError,
  PackageNotAllowedError,
  isActionAllowed,
  isActionAllowedByPolicy,
  isFullAccessGranted,
  isPackageAllowedByPolicy,
  isPackageVisibleByPolicy,
  isManagementAllowedByPolicy,
  requiresMinimalPackageProjection,
  filterActionsByPolicy,
  filterPackagesByPolicy,
  assertActionAllowedByPolicy,
  assertPackageAllowedByPolicy,
};

export function jsonResponse(data: unknown, status = 200, corsHeaders: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders },
  });
}

export function getSubPath(pathname: string): string {
  return pathname.startsWith("/api/v2/") ? pathname.slice(7) : pathname;
}

export function assertActionAllowed(
  action: { actionId?: string; id?: string; packageId?: string } | string,
  options?: ServerOptions | EffectiveServerPolicy
): void {
  assertActionAllowedByPolicy(action, options);
}

export function assertPackageAllowed(packageId: string, options?: ServerOptions | EffectiveServerPolicy): void {
  assertPackageAllowedByPolicy(packageId, options);
}

/** 包发现可见性与整包能力分开判断，不能因单动作授权开放包级管理。 */
export function assertPackageVisible(packageId: string, options?: ServerOptions | EffectiveServerPolicy): void {
  if (!isPackageVisibleByPolicy(packageId, options)) throw new PackageNotAllowedError(packageId);
}

/** 管理接口只能选取整包授权目标；全局管理必须显式拥有全部授权。 */
export function resolveTargetPackageId(
  packages: PackageInfo[],
  requestedPackageId?: string,
  options?: ServerOptions | EffectiveServerPolicy
): string {
  if (requestedPackageId) {
    if (requestedPackageId === "global") {
      if (options && !isFullAccessGranted(options)) {
        throw new ActionDockError(PACKAGE_NOT_ALLOWED, "Global management requires explicit full package authorization");
      }
      return "global";
    }
    assertValidPackageId(requestedPackageId);
    assertPackageAllowed(requestedPackageId, options);
    const matched = packages.find((pkg) => pkg.id === requestedPackageId || pkg.packageRoot === requestedPackageId);
    if (!matched) {
      throw new ActionDockError(PACKAGE_NOT_FOUND, `Unknown or unregistered package: '${requestedPackageId}'`);
    }
    return matched.id;
  }
  if (packages.length === 0) throw new ActionDockError(PACKAGE_NOT_FOUND, "No registered package found in service");
  const target = packages.find((pkg) => isPackageAllowedByPolicy(pkg.id, options));
  if (!target) throw new PackageNotAllowedError("No fully authorized package available for management");
  return target.id;
}
