import { parseActionRef } from "../catalog/resolve-action";
import { ActionDockError, ACTION_FORBIDDEN, PACKAGE_NOT_ALLOWED } from "../errors";
import type { McpEndpointHandler } from "./mcp-endpoint";
import { extractBearerToken, safeEqual } from "./security";
import type { EffectiveServerPolicy, ServerOptions, ServerViewOptions } from "./types";

export { extractBearerToken } from "./security";

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
 * 归一化后的单个服务视图结构。
 */
export interface NormalizedServerView {
  /** 视图唯一标识名称 */
  name: string;
  /** 该视图生效的统一安全策略 */
  policy: EffectiveServerPolicy;
  /** 该视图是否启用 MCP 端点 */
  enableMcp: boolean;
  /** 原始配置选项 */
  rawOptions: ServerViewOptions;
  /** 为该视图独立装配的 MCP 端点处理器 */
  mcpEndpointHandler?: McpEndpointHandler;
}

/**
 * 根据客户端携带的 Token 智能匹配已注册的视图。
 * 使用 safeEqual 进行恒定时间比较以防范时序攻击。
 * 
 * @param token 客户端提供的 Bearer Token
 * @param views 可遍历的视图集合
 * @returns 匹配成功的视图对象，未命中返回 undefined
 */
export function matchViewByToken(
  token: string,
  views: Iterable<NormalizedServerView>
): NormalizedServerView | undefined {
  const trimmed = token.trim();
  if (!trimmed) {
    return undefined;
  }

  let matched: NormalizedServerView | undefined = undefined;
  for (const view of views) {
    const candidateToken = view.policy.token?.trim();
    if (candidateToken) {
      const isMatch = safeEqual(trimmed, candidateToken);
      if (isMatch && !matched) {
        matched = view;
      }
    }
  }

  return matched;
}

/**
 * 归一化解析服务端配置的所有视图集合。
 * 保证默认视图与显式自定义视图具有统一的数据结构。
 * 
 * @param options 服务端配置选项
 * @returns 默认视图与全部视图 Map 映射
 */
export function normalizeServerViews(
  options: ServerOptions
): {
  defaultView: NormalizedServerView;
  views: Map<string, NormalizedServerView>;
} {
  const views = new Map<string, NormalizedServerView>();

  // 1. 初始化基于全局配置的默认视图
  const defaultRawOptions: ServerViewOptions = {
    name: "default",
    token: options.token,
    packageAllowlist: options.packageAllowlist,
    actionAllowlist: options.actionAllowlist,
    enableManagement: options.enableManagement,
    enableMcp: options.enableMcp !== false,
    mcpHandler: options.mcpHandler,
  };

  const customViews = new Map<string, NormalizedServerView>();

  // 2. 解析 options.views 自定义视图
  if (options.views) {
    if (Array.isArray(options.views)) {
      for (let i = 0; i < options.views.length; i++) {
        const item = options.views[i];
        if (!item || typeof item !== "object") continue;
        const name = item.name?.trim() || `view_${i}`;
        if (!name || name === "." || name === "..") {
          continue;
        }
        if (name === "default") {
          Object.assign(defaultRawOptions, item);
        } else {
          customViews.set(name, {
            name,
            policy: {
              viewName: name,
              token: item.token,
              packageAllowlist: item.packageAllowlist,
              actionAllowlist: item.actionAllowlist,
              enableManagement: item.enableManagement,
            },
            enableMcp: item.enableMcp !== false,
            rawOptions: item,
          });
        }
      }
    } else if (typeof options.views === "object") {
      for (const [key, item] of Object.entries(options.views)) {
        if (!item || typeof item !== "object") continue;
        const name = item.name?.trim() || key.trim();
        if (!name || name === "." || name === "..") {
          continue;
        }
        if (name === "default") {
          Object.assign(defaultRawOptions, item);
        } else {
          customViews.set(name, {
            name,
            policy: {
              viewName: name,
              token: item.token,
              packageAllowlist: item.packageAllowlist,
              actionAllowlist: item.actionAllowlist,
              enableManagement: item.enableManagement,
            },
            enableMcp: item.enableMcp !== false,
            rawOptions: item,
          });
        }
      }
    }
  }

  const defaultView: NormalizedServerView = {
    name: "default",
    policy: {
      viewName: "default",
      token: defaultRawOptions.token,
      packageAllowlist: defaultRawOptions.packageAllowlist,
      actionAllowlist: defaultRawOptions.actionAllowlist,
      enableManagement: defaultRawOptions.enableManagement,
    },
    enableMcp: defaultRawOptions.enableMcp !== false,
    rawOptions: defaultRawOptions,
  };

  // 默认视图置于首位，随后装载自定义视图
  views.set("default", defaultView);
  for (const [k, v] of customViews) {
    views.set(k, v);
  }

  return { defaultView, views };
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
 * 根据生效策略统一判定目标动作是否允许访问。
 * 同时综合校验策略中的 packageAllowlist 与 actionAllowlist 约束。
 * 
 * @param action 目标动作对象或引用字符串
 * @param policy 当前生效的服务端策略
 * @returns 是否允许访问
 */
export function isActionAllowedByPolicy(
  action:
    | { actionId?: string; id?: string; packageId?: string }
    | string
    | null
    | undefined,
  policy?: EffectiveServerPolicy
): boolean {
  if (!policy) {
    return true;
  }
  if (!action) {
    return false;
  }

  let pkgId: string | undefined;
  let actId: string | undefined;

  try {
    if (typeof action === "string") {
      const parsed = parseActionRef(action);
      pkgId = parsed.packageId;
      actId = parsed.actionId;
    } else {
      pkgId = action.packageId;
      const rawId = action.actionId || action.id;
      if (!rawId) return false;
      if (rawId.includes("/")) {
        const parsed = parseActionRef(rawId);
        pkgId = parsed.packageId || pkgId;
        actId = parsed.actionId;
      } else {
        actId = rawId;
      }
    }
  } catch {
    return false;
  }

  // 1. 若配置了 packageAllowlist，校验所属包白名单
  if (policy.packageAllowlist && policy.packageAllowlist.length > 0) {
    if (pkgId) {
      if (!policy.packageAllowlist.includes(pkgId)) {
        return false;
      }
    } else {
      // 未指明所属包时，仅当其动作标识明确列入 actionAllowlist 时才允许放行
      if (
        !policy.actionAllowlist ||
        policy.actionAllowlist.length === 0 ||
        !isActionAllowed({ actionId: actId }, policy.actionAllowlist)
      ) {
        return false;
      }
    }
  }

  // 2. 若配置了 actionAllowlist，校验动作白名单
  if (policy.actionAllowlist && policy.actionAllowlist.length > 0) {
    if (!isActionAllowed({ packageId: pkgId, actionId: actId }, policy.actionAllowlist)) {
      return false;
    }
  }

  return true;
}

/**
 * 根据生效策略统一判定目标包标识是否允许访问。
 * 
 * @param packageId 目标包 ID
 * @param policy 当前生效的服务端策略
 * @returns 是否允许访问
 */
export function isPackageAllowedByPolicy(
  packageId?: string | null,
  policy?: EffectiveServerPolicy
): boolean {
  if (!policy?.packageAllowlist || policy.packageAllowlist.length === 0) {
    return true;
  }
  if (!packageId) {
    return false;
  }
  return policy.packageAllowlist.includes(packageId);
}

/**
 * 根据生效策略统一判定配置与状态管理路由是否开启。
 * 
 * @param policy 当前生效的服务端策略
 * @returns 是否允许管理操作
 */
export function isManagementAllowedByPolicy(
  policy?: EffectiveServerPolicy
): boolean {
  return policy?.enableManagement === true;
}

/**
 * 根据生效策略对动作列表进行统一过滤。
 * 
 * @param actions 待过滤的动作列表
 * @param policy 当前生效的服务端策略
 * @returns 过滤后允许访问的动作列表
 */
export function filterActionsByPolicy<T extends { id: string; packageId?: string; actionId?: string }>(
  actions: T[],
  policy?: EffectiveServerPolicy
): T[] {
  if (!policy) {
    return actions;
  }
  const hasPkg = policy.packageAllowlist && policy.packageAllowlist.length > 0;
  const hasAct = policy.actionAllowlist && policy.actionAllowlist.length > 0;
  if (!hasPkg && !hasAct) {
    return actions;
  }
  return actions.filter((a) =>
    isActionAllowedByPolicy(
      { packageId: a.packageId, actionId: a.actionId || a.id },
      policy
    )
  );
}

/**
 * 根据生效策略对包列表进行统一过滤。
 * 
 * @param packages 待过滤的包列表
 * @param policy 当前生效的服务端策略
 * @returns 过滤后允许访问的包列表
 */
export function filterPackagesByPolicy<T extends { id: string }>(
  packages: T[],
  policy?: EffectiveServerPolicy
): T[] {
  if (!policy?.packageAllowlist || policy.packageAllowlist.length === 0) {
    return packages;
  }
  return packages.filter((p) => p.id && policy.packageAllowlist!.includes(p.id));
}

/**
 * 校验目标动作是否属于允许白名单，不符合则抛出 403 异常。
 * 
 * @param action 目标动作对象或引用
 * @param policy 当前生效的服务端策略
 */
export function assertActionAllowedByPolicy(
  action: { actionId?: string; id?: string; packageId?: string } | string,
  policy?: EffectiveServerPolicy
): void {
  if (!isActionAllowedByPolicy(action, policy)) {
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
 * 校验目标包是否属于允许白名单，不符合则抛出 403 异常。
 * 
 * @param packageId 目标包 ID
 * @param policy 当前生效的服务端策略
 */
export function assertPackageAllowedByPolicy(
  packageId: string,
  policy?: EffectiveServerPolicy
): void {
  if (!isPackageAllowedByPolicy(packageId, policy)) {
    throw new PackageNotAllowedError(packageId);
  }
}
