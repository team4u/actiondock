import { resolve } from "node:path";
import type { ActionRef } from "@actiondock/sdk";
import { ActionResolver } from "../catalog/action-resolver";
import { resolvePackageRoot } from "../registry/registry";
import { ensureProjectDependencies } from "./loader";
import { loadManifest } from "./manifest";

export interface EnsureDependencyClosureOptions {
  /**
   * 自定义依赖安装回调函数（便于单测 Mock 与自定义扩展）
   */
  ensure?: (root: string) => boolean | Promise<boolean>;
  /**
   * 自定义 ActionDock 家目录
   */
  customHome?: string;
}

export interface DependencyClosureResult {
  /** 成功执行依赖安装或更新的项目根路径列表 */
  installed: string[];
  /** 无法在注册表中解析包引用的警告列表 */
  warnings: string[];
}

/**
 * 广度优先遍历 (BFS) uses 声明的跨包依赖闭包，对涉及的每个项目包逐一执行依赖预装（ensureProjectDependencies）。
 * 内部已尊重 ACTIONDOCK_AUTO_INSTALL=false 环境变量。
 *
 * @param roots 根项目目录列表
 * @param opts 选项参数
 * @returns 安装成功的路径列表及警告信息
 */
export async function ensureDependencyClosure(
  roots: string[],
  opts: EnsureDependencyClosureOptions = {}
): Promise<DependencyClosureResult> {
  const seen = new Set<string>();
  const queue = [...roots];
  const installed: string[] = [];
  const warnings: string[] = [];

  while (queue.length > 0) {
    const rawRoot = queue.shift()!;
    if (!rawRoot) continue;
    const root = resolve(rawRoot);
    if (seen.has(root)) continue;
    seen.add(root);

    const ensureFn = opts.ensure ?? ensureProjectDependencies;
    const wasInstalled = await ensureFn(root);
    if (wasInstalled) {
      installed.push(root);
    }

    let manifest;
    try {
      manifest = loadManifest(root);
    } catch {
      continue;
    }

    if (!manifest || !manifest.actions) continue;

    for (const actionEntry of Object.values(manifest.actions)) {
      if (!Array.isArray(actionEntry.uses)) continue;
      for (const rawRef of actionEntry.uses) {
        if (typeof rawRef !== "string" || !rawRef.trim()) continue;
        let parsed: ActionRef;
        try {
          parsed = ActionResolver.parseRef(rawRef);
        } catch {
          warnings.push(`uses 声明 '${rawRef}' 未在注册表中解析到包`);
          continue;
        }

        if (parsed.packageId) {
          const depRoot = resolvePackageRoot(parsed.packageId, root, opts.customHome);
          if (depRoot) {
            queue.push(resolve(depRoot));
          } else {
            warnings.push(`uses 声明 '${rawRef}' 未在注册表中解析到包`);
          }
        }
      }
    }
  }

  return { installed, warnings };
}
