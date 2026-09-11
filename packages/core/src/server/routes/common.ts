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
 * 从 Host 或 Target 中依据 packageId 解析对应的 ActionDockApp 实例。
 */
export function resolveAppForPackage(
  packageIdOrPath: string | undefined,
  host?: ActionDockHost,
  target?: ActionDockTarget
): ActionDockApp {
  if (packageIdOrPath) {
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
    if (apps.length > 0) return apps[0];
  }

  const innerTarget = target?.unwrap?.();
  if (innerTarget && "listApps" in innerTarget) {
    const apps = innerTarget.listApps();
    if (apps.length > 0) return apps[0];
  }
  if (innerTarget && "packageId" in innerTarget) {
    return innerTarget;
  }

  throw new Error("No registered package found in host or target");
}
