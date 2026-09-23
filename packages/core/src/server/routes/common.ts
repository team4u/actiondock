import type { PackageInfo } from "../../app/types";
import type { ActionDockHost } from "../../host/types";
import type { ActionDockService } from "../../service/types";
import { assertValidPackageId } from "../../utils";
import type { ServerOptions } from "../types";

/**
 * 路由处理统一上下文对象。
 */
export interface RouteContext {
  req: Request;
  url: URL;
  pathname: string;
  corsHeaders: Record<string, string>;
  projectRoot: string | null;
  customHome?: string;
  service: ActionDockService;
  host?: ActionDockHost;
  options: ServerOptions;
}

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

import { ActionDockError, PACKAGE_NOT_FOUND, PACKAGE_NOT_ALLOWED } from "../../errors";

/**
 * 包未列入白名单拒绝访问异常。
 */
export class PackageNotAllowedError extends ActionDockError {
  status = 403;
  statusCode = 403;

  constructor(packageId: string) {
    super(PACKAGE_NOT_ALLOWED, `Package '${packageId}' is not in the allowed package list`);
    this.name = "PackageNotAllowedError";
    Object.setPrototypeOf(this, PackageNotAllowedError.prototype);
  }
}

/**
 * 校验目标 packageId 是否属于允许包白名单。
 * 当 options.packageAllowlist 存在且目标 packageId 不在白名单中时抛出 403 PACKAGE_NOT_ALLOWED 异常。
 */
export function assertPackageAllowed(
  packageId: string,
  options?: ServerOptions
): void {
  if (
    options?.packageAllowlist &&
    Array.isArray(options.packageAllowlist) &&
    options.packageAllowlist.length > 0 &&
    !options.packageAllowlist.includes(packageId)
  ) {
    throw new PackageNotAllowedError(packageId);
  }
}

/**
 * 解析并确定生效的目标 packageId。
 * 遵循严格的解析规则与白名单检查。
 */
export function resolveTargetPackageId(
  packages: PackageInfo[],
  requestedPackageId?: string,
  options?: ServerOptions
): string {
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
    options?.packageAllowlist &&
    Array.isArray(options.packageAllowlist) &&
    options.packageAllowlist.length > 0
  ) {
    const allowed = packages.find((p) => options.packageAllowlist!.includes(p.id));
    targetId = allowed ? allowed.id : (packages[0]?.id || "");
  } else if (packages.length > 0) {
    targetId = packages[0].id;
  } else {
    throw new ActionDockError(PACKAGE_NOT_FOUND, "No registered package found in service");
  }

  assertPackageAllowed(targetId, options);
  return targetId;
}
