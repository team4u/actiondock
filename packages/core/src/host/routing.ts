import { existsSync } from "node:fs";
import type { ActionRef, RuntimeError } from "@actiondock/sdk";
import type {
  ActionDockApp,
  ActionSpec,
  PackageInfo,
  PlaybookSpec,
  PlaybookSummary,
} from "../app/types";
import {
  DefaultActionCatalog,
  DefaultPackageGraph,
  parseActionRef,
  resolveAction,
  resolvePlaybook,
  type ActionCatalog,
  type PackageGraph,
  type ResolvedAction,
} from "../catalog";
import type { ActionPackageResolver } from "../project/resolver";
import { InvocationPolicy } from "../invocation/policy";
import { ActionDockError, PACKAGE_NOT_FOUND } from "../errors";

/**
 * 宽松解析引用：优先结构化解析，失败时按对象或裸短标识符回退。
 * 委派纯领域解析 parseActionRef 单一事实源。
 */
export function parseRefLoose(ref: ActionRef | string): ActionRef {
  try {
    return parseActionRef(ref);
  } catch {
    return typeof ref === "object" && ref !== null ? ref : { actionId: String(ref) };
  }
}

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
  return (
    policy.checkRootVisibility(packageId, actionId, {
      hostPublicPackageIds,
      resolver,
    }) === undefined
  );
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
 * 静态查询指定 Playbook 规范：基于 resolvePlaybook 统一纯领域解析。
 */
export async function describeVisiblePlaybook(
  apps: readonly ActionDockApp[],
  id: string,
  visibility: { hostPublicPackageIds: ReadonlySet<string>; resolver?: ActionPackageResolver }
): Promise<PlaybookSpec> {
  const graph: PackageGraph = new DefaultPackageGraph(
    new Map(
      apps.map((a) => [
        a.packageId,
        {
          identity: a.identity,
          root: a.packageRoot || "",
          manifest: a.projectConfig,
          directDependencies: new Set<string>(),
          transitiveDependencies: new Set<string>(),
        },
      ])
    )
  );

  const resolved = resolvePlaybook(id, { graph });
  const isPublic = visibility.hostPublicPackageIds.has(resolved.packageId);
  if (!isPublic && visibility.resolver) {
    const depGraph = visibility.resolver.resolveSync();
    if (!depGraph.directDependencyIds.has(resolved.packageId)) {
      throw new Error(
        `UNDECLARED_ACTION_DEPENDENCY: Playbook '${id}' belongs to undeclared transitive package '${resolved.packageId}'`
      );
    }
  }

  const app = apps.find((a) => a.packageId === resolved.packageId);
  if (!app) {
    throw new Error(`Package '${resolved.packageId}' not found in host`);
  }
  return app.describePlaybook(resolved.playbookId);
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
 * 静态查询指定 Action 规范：基于 resolveAction 统一纯领域解析。
 */
export async function describeActionAcrossApps(
  ref: ActionRef | string,
  apps: readonly ActionDockApp[],
  visibility: { hostPublicPackageIds: ReadonlySet<string>; resolver?: ActionPackageResolver },
  failedLinkedPackages: ReadonlyMap<string, { path: string; error: string }>,
  catalog?: ActionCatalog,
  graph?: PackageGraph
): Promise<ActionSpec> {
  const parsed = parseRefLoose(ref);
  if (parsed.packageId && failedLinkedPackages.has(parsed.packageId)) {
    throw new Error(packageNotFoundMessage(parsed.packageId, failedLinkedPackages));
  }
  const effectiveGraph =
    graph ||
    new DefaultPackageGraph(
      new Map(
        apps.map((a) => [
          a.packageId,
          {
            identity: a.identity,
            root: a.packageRoot || "",
            manifest: a.projectConfig,
            directDependencies: new Set<string>(),
            transitiveDependencies: new Set<string>(),
          },
        ])
      )
    );
  const effectiveCatalog =
    catalog ||
    new DefaultActionCatalog(effectiveGraph, (pkgId) =>
      apps.find((a) => a.packageId === pkgId)?.actionsMap
    );

  let resolved: ResolvedAction;
  try {
    resolved = resolveAction(ref, {
      graph: effectiveGraph,
      catalog: effectiveCatalog,
    });
  } catch (err: any) {
    if (err.code === PACKAGE_NOT_FOUND) {
      const parsed = parseRefLoose(ref);
      if (parsed.packageId) {
        throw new ActionDockError(PACKAGE_NOT_FOUND, packageNotFoundMessage(parsed.packageId, failedLinkedPackages));
      }
    }
    throw err;
  }

  if (
    !isRootCallVisible(
      resolved.package.id,
      resolved.ref.actionId,
      visibility.hostPublicPackageIds,
      visibility.resolver
    )
  ) {
    throw new Error(
      `UNDECLARED_ACTION_DEPENDENCY: Action '${resolved.package.id}/${resolved.ref.actionId}' is not declared as a direct dependency in actiondock.json and is not delegated by a visible playbook`
    );
  }

  const app = apps.find((a) => a.packageId === resolved.package.id);
  if (!app) {
    throw new Error(packageNotFoundMessage(resolved.package.id, failedLinkedPackages));
  }

  const spec = await app.describeAction(resolved.ref.actionId);
  return {
    ...spec,
    packageId: app.packageId,
  };
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
