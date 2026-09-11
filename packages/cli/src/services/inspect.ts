import { existsSync } from "node:fs";
import {
  findProjectRoot,
  listLinkedPackages,
  loadManifest,
  loadPlaybooks,
  loadProjectConfig,
} from "@actiondock/core";
import type { AggregatedPackage, CliContext, ProjectDetailInfo } from "../types";

/**
 * 装配单个工程的详情自省信息（清单、动作映射与 Playbook 映射）。
 *
 * @param root 工程根目录
 */
export async function getProjectDetailInfo(root: string): Promise<ProjectDetailInfo> {
  const config = loadProjectConfig(root);
  const manifest = loadManifest(root);
  const actionsMap = new Map<string, { id: string; description?: string }>();
  if (manifest?.actions) {
    for (const [id, item] of Object.entries(manifest.actions)) {
      actionsMap.set(id, {
        id,
        description: item.description,
      });
    }
  }
  const playbooks = loadPlaybooks(root, config.playbooksDir);

  return {
    id: config.id,
    name: config.name || config.id,
    version: config.version || "0.0.0",
    description: config.description,
    projectRoot: root,
    actionsDir: config.actionsDir || "actions",
    playbooksDir: config.playbooksDir || "playbooks",
    actionsCount: actionsMap.size,
    playbooksCount: playbooks.size,
    actions: Array.from(actionsMap.keys()),
    playbooks: Array.from(playbooks.keys()),
    configDeclared: config.config ? Object.keys(config.config) : [],
    configDef: config.config,
    actionsMap,
    playbooksMap: playbooks,
  };
}

/**
 * 装配单个包的摘要聚合信息（不含动作与 Playbook 明细映射）。
 *
 * @param root 包根目录
 */
export function getPackageSummary(root: string): AggregatedPackage {
  const config = loadProjectConfig(root);
  const manifest = loadManifest(root);
  const manifestActionIds = manifest?.actions ? Object.keys(manifest.actions) : [];
  const playbooks = loadPlaybooks(root, config.playbooksDir);

  return {
    id: config.id,
    name: config.name || config.id,
    version: config.version || "0.0.0",
    description: config.description,
    path: root,
    actionsCount: manifestActionIds.length,
    playbooksCount: playbooks.size,
    actions: manifestActionIds,
    playbooks: Array.from(playbooks.keys()),
    configDeclared: config.config ? Object.keys(config.config) : [],
  };
}

/**
 * 扫描本地候选包集合（当前工程根目录优先，叠加全局已链接包，按物理路径去重）。
 * 清单损坏或磁盘失效的候选项跳过，不影响其余条目聚合。
 *
 * @param context CLI 上下文（提供 customHome 定位全局注册表）
 */
export function scanLocalAggregatedPackages(context?: CliContext): {
  currentRoot: string | null;
  aggregated: AggregatedPackage[];
} {
  const currentRoot = findProjectRoot();
  const linkedList = listLinkedPackages(context?.customHome);
  const aggregated: AggregatedPackage[] = [];
  const seenPaths = new Set<string>();

  if (currentRoot) {
    try {
      aggregated.push(getPackageSummary(currentRoot));
      seenPaths.add(currentRoot);
    } catch {
      // 忽略异常工程根目录（清单损坏）
    }
  }

  for (const pkg of linkedList) {
    if (!existsSync(pkg.path)) continue;
    if (seenPaths.has(pkg.path)) continue;
    try {
      aggregated.push(getPackageSummary(pkg.path));
      seenPaths.add(pkg.path);
    } catch {
      // 忽略失效链接（清单损坏或磁盘异常）
    }
  }

  return { currentRoot, aggregated };
}
