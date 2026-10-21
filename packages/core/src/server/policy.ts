import type { RunOrigin } from "@actiondock/sdk";
import { snapshotRunOrigin } from "../runtime/run-origin";
import { parseActionRef } from "../catalog/resolve-action";
import { ActionDockError, ACTION_FORBIDDEN, INVALID_ARGUMENT, PACKAGE_NOT_ALLOWED } from "../errors";
import { assertValidPackageId } from "../utils";
import type { McpEndpointHandler } from "./mcp-endpoint";
import { safeEqual } from "./security";
import type { EffectiveServerPolicy, ServerOptions, ServerViewOptions } from "./types";

export { extractBearerToken } from "./security";

type PolicyAction = { actionId?: string; id?: string; packageId?: string } | string;

/** 校验两类白名单授权；省略或空数组不增加授权，包列表中的独立 * 显式授予全部权限。 */
export function assertServerPolicyValid(
  item: { packageAllowlist?: unknown; actionAllowlist?: unknown },
  scope = "server options"
): void {
  for (const field of ["packageAllowlist", "actionAllowlist"] as const) {
    const list = item[field];
    if (list === undefined) continue;
    if (!Array.isArray(list)) {
      throw new ActionDockError(INVALID_ARGUMENT, `Invalid ${scope}.${field}: expected an array`);
    }
    for (const entry of list) {
      if (typeof entry !== "string" || !entry.trim()) {
        throw new ActionDockError(INVALID_ARGUMENT, `Invalid ${scope}.${field}: entries must be non-empty strings`);
      }
      try {
        if (field === "packageAllowlist") {
          if (entry !== "*") assertValidPackageId(entry);
        } else {
          if (entry.includes("*") || entry.includes("?")) {
            throw new Error("wildcards are not supported in action references");
          }
          const ref = parseActionRef(entry);
          if (!ref.packageId) {
            throw new Error("action references must be fully qualified packageId/actionId references");
          }
          assertValidPackageId(ref.packageId);
        }
      } catch (error) {
        throw new ActionDockError(
          INVALID_ARGUMENT,
          `Invalid ${scope}.${field}: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }
  }
}

/** 是否显式授予全部包与动作；不替代独立的管理能力门禁。 */
export function isFullAccessGranted(policy?: EffectiveServerPolicy | null): boolean {
  return policy?.packageAllowlist?.includes("*") === true;
}

export class ActionForbiddenError extends ActionDockError {
  status = 403;
  statusCode = 403;

  constructor(actionRef: string) {
    super(ACTION_FORBIDDEN, `Action '${actionRef}' is not in the allowed action list`);
    this.name = "ActionForbiddenError";
    Object.setPrototypeOf(this, ActionForbiddenError.prototype);
  }
}

export class PackageNotAllowedError extends ActionDockError {
  status = 403;
  statusCode = 403;

  constructor(packageId: string) {
    super(PACKAGE_NOT_ALLOWED, `Package '${packageId}' is not in the allowed package list`);
    this.name = "PackageNotAllowedError";
    Object.setPrototypeOf(this, PackageNotAllowedError.prototype);
  }
}

export interface NormalizedServerView {
  name: string;
  policy: EffectiveServerPolicy;
  enableMcp: boolean;
  rawOptions: ServerViewOptions;
  mcpEndpointHandler?: McpEndpointHandler;
}

/** 遍历全部视图并以常数时间比较令牌，避免提前退出泄露匹配位置。 */
export function matchViewByToken(
  token: string,
  views: Iterable<NormalizedServerView>
): NormalizedServerView | undefined {
  const trimmed = token.trim();
  if (!trimmed) return undefined;
  let matched: NormalizedServerView | undefined;
  for (const view of views) {
    const candidateToken = view.policy.token?.trim();
    if (candidateToken) {
      const isMatch = safeEqual(trimmed, candidateToken);
      if (isMatch && !matched) matched = view;
    }
  }
  return matched;
}

function normalizeView(item: ServerViewOptions, name: string): NormalizedServerView {
  assertServerPolicyValid(item, `view '${name}'`);
  return {
    name,
    policy: {
      viewName: name,
      token: item.token,
      packageAllowlist: item.packageAllowlist?.slice(),
      actionAllowlist: item.actionAllowlist?.map((entry) => {
        const ref = parseActionRef(entry);
        return `${ref.packageId}/${ref.actionId}`;
      }),
      enableManagement: item.enableManagement,
    },
    enableMcp: item.enableMcp !== false,
    rawOptions: item,
  };
}

/** 全局选项仅配置默认视图；命名视图独立授权，缺少授权的视图默认拒绝全部。 */
export function normalizeServerViews(options: ServerOptions): {
  defaultView: NormalizedServerView;
  views: Map<string, NormalizedServerView>;
} {
  assertServerPolicyValid(options);
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
  const entries = Array.isArray(options.views)
    ? options.views.map((item, index) => [`view_${index}`, item] as const)
    : Object.entries(options.views || {});
  for (const [key, item] of entries) {
    if (!item || typeof item !== "object") continue;
    const name = item.name?.trim() || key.trim();
    if (!name || name === "." || name === "..") continue;
    if (name === "default") {
      Object.assign(defaultRawOptions, item);
    } else {
      customViews.set(name, normalizeView(item, name));
    }
  }
  const defaultView = normalizeView(defaultRawOptions, "default");
  const views = new Map<string, NormalizedServerView>([["default", defaultView], ...customViews]);
  return { defaultView, views };
}

/** 目标引用格式错误或包身份不一致时返回未命中，不能猜测其所属包。 */
function parsePolicyAction(action: PolicyAction | null | undefined): { packageId?: string; actionId: string } | undefined {
  if (!action) return undefined;
  try {
    if (typeof action === "string") return parseActionRef(action);
    const rawId = action.actionId || action.id;
    if (!rawId) return undefined;
    const ref = parseActionRef(rawId);
    if (action.packageId && ref.packageId && action.packageId !== ref.packageId) return undefined;
    return { packageId: action.packageId || ref.packageId, actionId: ref.actionId };
  } catch {
    return undefined;
  }
}

/** 动作列表仅按全限定引用匹配；省略或空列表不会授予任何动作。 */
export function isActionAllowed(
  action: PolicyAction | null | undefined,
  allowlist?: string[]
): boolean {
  const target = parsePolicyAction(action);
  if (!target?.packageId) return false;
  return (allowlist || []).some((entry) => {
    const rule = parsePolicyAction(entry);
    return Boolean(rule?.packageId && rule.packageId === target.packageId && rule.actionId === target.actionId);
  });
}

/** 整包授权与全限定单动作授权取并集；仅缺少策略对象的内部调用不执行过滤。 */
export function isActionAllowedByPolicy(
  action: PolicyAction | null | undefined,
  policy?: EffectiveServerPolicy
): boolean {
  if (!policy) return true;
  const target = parsePolicyAction(action);
  if (!target) return false;
  if (isFullAccessGranted(policy)) return true;
  if (!target.packageId) return false;
  return Boolean(
    policy.packageAllowlist?.includes(target.packageId) ||
    isActionAllowed(target, policy.actionAllowlist)
  );
}

/** 整包能力授权，不从某个动作的授权推导配置、状态、规程或诊断权限。 */
export function isPackageAllowedByPolicy(
  packageId?: string | null,
  policy?: EffectiveServerPolicy
): boolean {
  if (!policy || isFullAccessGranted(policy)) return true;
  return Boolean(packageId && policy.packageAllowlist?.includes(packageId));
}

/** 单动作授权的包可发现必要身份信息，但不因此获得整包能力。 */
export function isPackageVisibleByPolicy(
  packageId?: string | null,
  policy?: EffectiveServerPolicy
): boolean {
  if (isPackageAllowedByPolicy(packageId, policy)) return true;
  if (!packageId) return false;
  return (policy?.actionAllowlist || []).some((entry) => parsePolicyAction(entry)?.packageId === packageId);
}

export function requiresMinimalPackageProjection(
  packageId?: string | null,
  policy?: EffectiveServerPolicy
): boolean {
  return isPackageVisibleByPolicy(packageId, policy) && !isPackageAllowedByPolicy(packageId, policy);
}

export function isManagementAllowedByPolicy(policy?: EffectiveServerPolicy): boolean {
  return policy?.enableManagement === true;
}

export function filterActionsByPolicy<T extends { id: string; packageId?: string; actionId?: string }>(
  actions: T[],
  policy?: EffectiveServerPolicy
): T[] {
  if (!policy) return actions;
  return actions.filter((action) => isActionAllowedByPolicy(action, policy));
}

export function filterPackagesByPolicy<T extends { id: string }>(
  packages: T[],
  policy?: EffectiveServerPolicy
): T[] {
  if (!policy) return packages;
  return packages.filter((pkg) => isPackageVisibleByPolicy(pkg.id, policy));
}

export function assertActionAllowedByPolicy(action: PolicyAction, policy?: EffectiveServerPolicy): void {
  if (!isActionAllowedByPolicy(action, policy)) {
    const ref = typeof action === "string"
      ? action
      : action.packageId
        ? `${action.packageId}/${action.actionId || action.id}`
        : action.actionId || action.id || "unknown";
    throw new ActionForbiddenError(ref);
  }
}

export function assertPackageAllowedByPolicy(packageId: string, policy?: EffectiveServerPolicy): void {
  if (!isPackageAllowedByPolicy(packageId, policy)) throw new PackageNotAllowedError(packageId);
}

/** 只记录受信任的执行来源，不能包含令牌原文、片段或摘要。 */
export function createServerRunOrigin(
  policy: Pick<EffectiveServerPolicy, "viewName" | "token">,
  channel: RunOrigin["channel"]
): RunOrigin {
  return snapshotRunOrigin({
    channel,
    viewName: policy.viewName || "default",
    authenticated: Boolean(policy.token?.trim()),
  })!;
}
