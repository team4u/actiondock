import type { PackageInfo } from "../../package/types";
import type { ActionDockService } from "../../service/types";
import { assertValidPackageId } from "../../utils";
import { parseActionRef } from "../../catalog/resolve-action";
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

import { ActionDockError, ACTION_FORBIDDEN, PACKAGE_NOT_FOUND, PACKAGE_NOT_ALLOWED } from "../../errors";

/**
 * 动作未列入白名单拒绝访问异常。
 */
export class ActionForbiddenError extends ActionDockError {
  status = 403;
  statusCode = 403;

  constructor(actionRef: string) {
    super(ACTION_FORBIDDEN, `Action '${actionRef}' is not in the allowed action list`);
    this.name = "ActionForbiddenError";
    Object.setPrototypeOf(this, ActionForbiddenError.prototype);
  }
}

/**
 * 校验目标动作是否在 actionAllowlist 允许白名单中。
 * 支持短名 actionId 与全限定名 packageId/actionId 匹配：
 * - 白名单项若含 '/'（如 pkg/act），则必须 packageId 与 actionId 同时精确匹配。
 * - 白名单项若不含 '/'（如 act），则只需 actionId 匹配（不限包）。
 *
 * @param action 目标动作对象或引用字符串
 * @param allowlist 允许动作白名单列表
 * @returns 是否允许访问
 */
export function isActionAllowed(
  action:
    | { actionId?: string; id?: string; packageId?: string }
    | string
    | null
    | undefined,
  allowlist?: string[]
): boolean {
  if (!allowlist || !Array.isArray(allowlist) || allowlist.length === 0) {
    return true;
  }
  if (!action) {
    return false;
  }

  let target: { packageId?: string; actionId: string };
  try {
    if (typeof action === "string") {
      target = parseActionRef(action);
    } else {
      const rawId = action.actionId || action.id;
      if (!rawId) return false;
      if (action.packageId) {
        if (rawId.includes("/")) {
          target = parseActionRef(rawId);
        } else {
          target = parseActionRef({
            packageId: action.packageId,
            actionId: rawId,
          });
        }
      } else {
        target = parseActionRef(rawId);
      }
    }
  } catch {
    return false;
  }

  for (const item of allowlist) {
    if (typeof item !== "string") continue;
    const trimmed = item.trim();
    if (!trimmed) continue;

    try {
      const rule = parseActionRef(trimmed);
      if (rule.packageId) {
        if (rule.packageId === target.packageId && rule.actionId === target.actionId) {
          return true;
        }
      } else {
        if (rule.actionId === target.actionId) {
          return true;
        }
      }
    } catch {
      continue;
    }
  }

  return false;
}

/**
 * 校验目标 action 是否属于允许动作白名单。
 * 当 options.actionAllowlist 存在且目标 action 不在白名单中时抛出 403 ACTION_FORBIDDEN 异常。
 */
export function assertActionAllowed(
  action: { actionId?: string; id?: string; packageId?: string } | string,
  options?: ServerOptions
): void {
  if (
    options?.actionAllowlist &&
    Array.isArray(options.actionAllowlist) &&
    options.actionAllowlist.length > 0 &&
    !isActionAllowed(action, options.actionAllowlist)
  ) {
    const actRef =
      typeof action === "string"
        ? action
        : action.packageId
        ? `${action.packageId}/${action.actionId || action.id}`
        : action.actionId || action.id || "unknown";
    throw new ActionForbiddenError(actRef);
  }
}

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
