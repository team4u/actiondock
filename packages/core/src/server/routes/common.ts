import type { ActionDockApp } from "../../app/types";
import type { ActionDockHost } from "../../host/types";
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
  host?: ActionDockHost;
  target: ActionDockTarget;
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
  if (options?.packageAllowlist && Array.isArray(options.packageAllowlist)) {
    if (!packageId || !options.packageAllowlist.includes(packageId)) {
      throw new PackageNotAllowedError(packageId || "");
    }
  }
}

/**
 * 从 Host 或 Target 中依据 packageId 解析对应的 ActionDockApp 实例。
 * 若提供了 options，过滤或优先选择白名单内的 app。
 */
export function resolveAppForPackage(
  packageIdOrPath: string | undefined,
  host?: ActionDockHost,
  target?: ActionDockTarget,
  options?: ServerOptions
): ActionDockApp {
  if (packageIdOrPath) {
    assertPackageAllowed(packageIdOrPath, options);
    assertValidPackageId(packageIdOrPath);
    if (host) {
      const app = host.getApp(packageIdOrPath);
      if (app) return app;
    }
    const innerTarget = target?.unwrap?.();
    if (innerTarget && "packageId" in innerTarget && innerTarget.packageId === packageIdOrPath) {
      return innerTarget;
    }
    if (innerTarget && "getApp" in innerTarget) {
      const app = innerTarget.getApp(packageIdOrPath);
      if (app) return app;
    }
    throw new Error(`Unknown or unregistered package: '${packageIdOrPath}'`);
  }

  if (host) {
    const apps = host.listApps();
    if (options?.packageAllowlist && Array.isArray(options.packageAllowlist)) {
      const allowedApp = apps.find((a) => options.packageAllowlist!.includes(a.packageId));
      if (allowedApp) return allowedApp;
    }
    if (apps.length > 0) return apps[0];
  }

  const innerTarget = target?.unwrap?.();
  if (innerTarget && "listApps" in innerTarget) {
    const apps = innerTarget.listApps();
    if (options?.packageAllowlist && Array.isArray(options.packageAllowlist)) {
      const allowedApp = apps.find((a: any) => options.packageAllowlist!.includes(a.packageId));
      if (allowedApp) return allowedApp;
    }
    if (apps.length > 0) return apps[0];
  }
  if (innerTarget && "packageId" in innerTarget) {
    return innerTarget;
  }

  throw new Error("No registered package found in host or target");
}
