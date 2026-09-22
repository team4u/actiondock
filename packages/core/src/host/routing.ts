import { existsSync } from "node:fs";
import type { ActionRef, RuntimeError } from "@actiondock/sdk";
import type {
  ActionDockApp,
  ActionSpec,
  PackageInfo,
  PlaybookSpec,
  PlaybookSummary,
} from "../app/types";
import { ActionResolver } from "../catalog/action-resolver";
import type { ActionPackageResolver } from "../project/resolver";

/**
 * 判定异常是否为 not-found 语义（包内确实不存在该 Action）。
 *
 * 遍历匹配短标识符时仅跳过此类错误；存储损坏、模块加载失败等内部错误必须向调用方透传，
 * 严禁被吞没后伪装成 ACTION_NOT_FOUND。
 */
export function isActionNotFoundLikeError(err: any): boolean {
  if (!err) {
    return false;
  }
  if (err.code === "ACTION_NOT_FOUND" || err.code === "NOT_FOUND") {
    return true;
  }
  const message = typeof err.message === "string" ? err.message : String(err);
  return (
    message.startsWith("ACTION_NOT_FOUND:") ||
    /Action '[^']*' not found in package/.test(message)
  );
}

/**
 * 宽松解析引用：优先结构化解析，失败时按对象或裸短标识符回退。
 */
export function parseRefLoose(ref: ActionRef | string): ActionRef {
  try {
    return ActionResolver.parseRef(ref);
  } catch {
    return typeof ref === "object" ? ref : { actionId: ref };
  }
}

import { InvocationPolicy } from "../invocation/policy";

/**
 * 根调用可见性判定：非公开包且存在依赖解析器时，交由解析器委托规则裁决。
 */
export function isRootCallVisible(
  packageId: string,
  actionId: string,
  hostPublicPackageIds: ReadonlySet<string>,
  resolver?: ActionPackageResolver
): boolean {
  const policy = new InvocationPolicy();
  return policy.checkRootVisibility(packageId, actionId, { hostPublicPackageIds, resolver }) === undefined;
}

/**
 * 跨包短标识符歧义消解结果：唯一匹配、歧义多匹配与零匹配三态。
 */
export type ShortRefResolution =
  | { kind: "unique"; app: ActionDockApp }
  | { kind: "ambiguous"; candidates: string[] }
  | { kind: "not_found" };

/**
 * 在全部已注册包中按短标识符解析唯一提供方。
 *
 * 可见性过滤遵循根调用规则（公开包直接可见；传递依赖包仅可见 Playbook 委托项）；
 * 仅 not-found 语义错误被跳过，其余异常向调用方透传。
 */
export async function resolveShortRef(
  apps: readonly ActionDockApp[],
  actionId: string,
  visibility: { hostPublicPackageIds: ReadonlySet<string>; resolver?: ActionPackageResolver }
): Promise<ShortRefResolution> {
  const matches: ActionDockApp[] = [];
  for (const app of apps) {
    try {
      if (!isRootCallVisible(app.packageId, actionId, visibility.hostPublicPackageIds, visibility.resolver)) {
        continue;
      }
      await app.describeAction(actionId);
      matches.push(app);
    } catch (err: any) {
      // 仅将 not-found 语义视为「包内无此 Action」；其余异常必须透传，避免内部错误伪装成 ACTION_NOT_FOUND
      if (!isActionNotFoundLikeError(err)) {
        throw err;
      }
    }
  }

  if (matches.length === 1) {
    return { kind: "unique", app: matches[0] };
  }
  if (matches.length > 1) {
    return { kind: "ambiguous", candidates: matches.map((m) => m.packageId) };
  }
  return { kind: "not_found" };
}

/**
 * 按包标识构造未找到错误信息：优先透传链接包加载失败的精准诊断。
 */
export function packageNotFoundMessage(
  packageId: string,
  failedLinkedPackages: ReadonlyMap<string, { path: string; error: string }>
): string {
  const failed = failedLinkedPackages.get(packageId);
  if (failed) {
    return `Package '${packageId}' not found in host (failed to load from '${failed.path}': ${failed.error})`;
  }
  return `Package '${packageId}' not found in host`;
}

/**
 * 静态查询并聚合可见包的 Playbook 规程摘要（带包前缀限定）。
 */
export async function listVisiblePlaybooks(
  apps: readonly ActionDockApp[],
  visibility: { hostPublicPackageIds: ReadonlySet<string>; resolver?: ActionPackageResolver }
): Promise<PlaybookSummary[]> {
  const results: PlaybookSummary[] = [];
  for (const app of apps) {
    const isPublic = visibility.hostPublicPackageIds.has(app.packageId);
    if (!isPublic && visibility.resolver) {
      const graph = visibility.resolver.resolveSync();
      if (!graph.directDependencyIds.has(app.packageId)) {
        continue;
      }
    }
    const appPlaybooks = await app.listPlaybooks();
    for (const item of appPlaybooks) {
      const qualifiedId =
        apps.length > 1 && !item.id.includes("/")
          ? `${app.packageId}/${item.id}`
          : item.id;
      results.push({
        ...item,
        id: qualifiedId,
        packageId: app.packageId,
      });
    }
  }
  return results;
}

/**
 * 静态查询指定 Playbook 规范：支持「包/规程」限定引用与裸短标识符两级解析。
 * 未声明依赖的传递包、不存在的规程与空匹配分别抛出对应语义错误。
 */
export async function describeVisiblePlaybook(
  apps: readonly ActionDockApp[],
  id: string,
  visibility: { hostPublicPackageIds: ReadonlySet<string>; resolver?: ActionPackageResolver }
): Promise<PlaybookSpec> {
  if (id.includes("/")) {
    const lastSlashIndex = id.lastIndexOf("/");
    const packageId = id.slice(0, lastSlashIndex);
    const playbookId = id.slice(lastSlashIndex + 1);
    const isPublic = visibility.hostPublicPackageIds.has(packageId);
    if (!isPublic && visibility.resolver) {
      const graph = visibility.resolver.resolveSync();
      if (!graph.directDependencyIds.has(packageId)) {
        throw new Error(
          `UNDECLARED_ACTION_DEPENDENCY: Playbook '${id}' belongs to undeclared transitive package '${packageId}'`
        );
      }
    }
    const app = apps.find((a) => a.packageId === packageId);
    if (!app) {
      throw new Error(`Package '${packageId}' not found in host`);
    }
    return app.describePlaybook(playbookId);
  }

  for (const app of apps) {
    try {
      const isPublic = visibility.hostPublicPackageIds.has(app.packageId);
      if (!isPublic && visibility.resolver) {
        const graph = visibility.resolver.resolveSync();
        if (!graph.directDependencyIds.has(app.packageId)) {
          continue;
        }
      }
      return await app.describePlaybook(id);
    } catch {
      // 忽略未匹配的包
    }
  }

  throw new Error(`Playbook '${id}' not found in any registered package`);
}

/**
 * 聚合全部已注册包的元数据信息。
 */
export async function collectPackageInfos(apps: readonly ActionDockApp[]): Promise<PackageInfo[]> {
  return Promise.all(apps.map((app) => app.info()));
}

/**
 * 构造失配类错误响应载荷（ACTION_NOT_FOUND / AMBIGUOUS_ACTION_REF 等）。
 */
export function buildRuntimeError(
  code: string,
  message: string,
  details?: Record<string, unknown>
): RuntimeError {
  const error: RuntimeError = { code, message };
  if (details !== undefined) {
    error.details = details;
  }
  return error;
}

/**
 * 构造短标识符歧义错误消息（供静态查询与启动执行链路复用统一文案）。
 */
export function ambiguousActionMessage(actionId: string, candidates: readonly string[]): string {
  const joined = candidates.map((c) => `${c}/${actionId}`).join(", ");
  return `Action '${actionId}' is ambiguous and provided by multiple packages: ${joined}. Please specify '<package-id>/${actionId}'.`;
}

/**
 * 静态查询指定 Action 规范：包限定引用直查，裸短标识符跨包消歧后返回。
 */
export async function describeActionAcrossApps(
  ref: ActionRef | string,
  apps: readonly ActionDockApp[],
  visibility: { hostPublicPackageIds: ReadonlySet<string>; resolver?: ActionPackageResolver },
  failedLinkedPackages: ReadonlyMap<string, { path: string; error: string }>
): Promise<ActionSpec> {
  const parsed = parseRefLoose(ref);

  if (parsed.packageId) {
    if (!isRootCallVisible(parsed.packageId, parsed.actionId, visibility.hostPublicPackageIds, visibility.resolver)) {
      throw new Error(
        `UNDECLARED_ACTION_DEPENDENCY: Action '${parsed.packageId}/${parsed.actionId}' is not declared as a direct dependency in actiondock.json and is not delegated by a visible playbook`
      );
    }
    const app = apps.find((a) => a.packageId === parsed.packageId);
    if (!app) {
      throw new Error(packageNotFoundMessage(parsed.packageId, failedLinkedPackages));
    }
    const spec = await app.describeAction(parsed.actionId);
    return {
      ...spec,
      packageId: app.packageId,
    };
  }

  const matches: Array<{ app: ActionDockApp; spec: ActionSpec }> = [];
  for (const app of apps) {
    try {
      if (!isRootCallVisible(app.packageId, parsed.actionId, visibility.hostPublicPackageIds, visibility.resolver)) {
        continue;
      }
      const spec = await app.describeAction(parsed.actionId);
      matches.push({ app, spec: { ...spec, packageId: app.packageId } });
    } catch (err: any) {
      // 仅将 not-found 语义视为「包内无此 Action」；其余异常必须透传，避免内部错误伪装成 ACTION_NOT_FOUND
      if (!isActionNotFoundLikeError(err)) {
        throw err;
      }
    }
  }

  if (matches.length === 1) {
    return {
      ...matches[0].spec,
      packageId: matches[0].app.packageId,
    };
  }
  if (matches.length > 1) {
    const err = new Error(
      `INVALID_ACTION_REF: ${ambiguousActionMessage(parsed.actionId, matches.map((m) => m.app.packageId))} (AMBIGUOUS_ACTION_REF)`
    );
    (err as any).code = "INVALID_ACTION_REF";
    (err as any).details = { alias: "AMBIGUOUS_ACTION_REF", candidates: matches.map((m) => m.app.packageId) };
    throw err;
  }

  throw new Error(`ACTION_NOT_FOUND: Action '${parsed.actionId}' not found in any registered package`);
}

/** existsSync 的可注入探测依赖（纯函数模块保持可测试性） */
export type ExistsProbe = (path: string) => boolean;

/**
 * 解析宿主自动加载工程根目录：显式指定优先，其次当前进程工作目录探测。
 */
export function resolveProjectRoot(
  options: { projectRoot?: string },
  detect: () => string | null,
  exists: ExistsProbe = existsSync
): string | null {
  let root = options.projectRoot;
  if (!root) {
    const detected = detect();
    if (detected) {
      root = detected;
    }
  }
  if (!root || !exists(root)) {
    return null;
  }
  return root;
}
