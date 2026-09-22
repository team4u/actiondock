import type { PackageInfo } from "../../app/types";
import type { ActionDockHost } from "../../host/types";
import type { ActionDockService } from "../../service/types";
import type { ActionDockTarget } from "../../target/types";
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
  target?: ActionDockTarget;
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
 * 剥离标准版本前缀 (/api/v2/ 与兼容的 /api/v1/)，获取相对路由子路径。
 */
export function getSubPath(pathname: string): string {
  if (pathname.startsWith("/api/v2/")) {
    return pathname.slice(7);
  }
  if (pathname.startsWith("/api/v1/")) {
    return pathname.slice(7);
  }
  return pathname;
}

/**
 * 包未列入白名单拒绝访问异常。
 */
export class PackageNotAllowedError extends Error {
  status = 403;
  statusCode = 403;
  code = "PACKAGE_NOT_ALLOWED";

  constructor(packageId: string) {
    super(`Package '${packageId}' is not in the allowed package list`);
    this.name = "PackageNotAllowedError";
  }
}

/**
 * 校验目标 packageId 是否属于允许包白名单。
 * 当 options.packageAllowlist 存在且目标 packageId 不在白名单中时抛出 403 PACKAGE_NOT_ALLOWED 异常。
 */
export function assertPackageAllowed(
  packageId: string | undefined | null,
  options?: { packageAllowlist?: string[] }
): void {
  if (
    options?.packageAllowlist &&
    Array.isArray(options.packageAllowlist) &&
    options.packageAllowlist.length > 0
  ) {
    if (!packageId || !options.packageAllowlist.includes(packageId)) {
      throw new PackageNotAllowedError(packageId || "");
    }
  }
}

/**
 * 基于已发现的包清单解析目标包唯一标识。
 * 纯粹面向 PackageInfo 元数据，彻底去除对 App 实例的依赖与穿透。
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
      throw new Error(`Unknown or unregistered package: '${requestedPackageId}'`);
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
    throw new Error("No registered package found in service");
  }

  assertPackageAllowed(targetId, options);
  return targetId;
}
