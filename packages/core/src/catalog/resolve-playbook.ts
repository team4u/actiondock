import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { loadPlaybooks } from "../project/loader";
import type { PlaybookDefinition } from "../project/types";
import { getPackageSlug } from "../utils";
import type { PackageGraph, PackageNode } from "./graph";

function getNodePlaybooks(node: PackageNode): Map<string, PlaybookDefinition> {
  const map = new Map<string, PlaybookDefinition>();
  if (node.root && existsSync(node.root)) {
    try {
      const diskPlaybooks = loadPlaybooks(node.root, node.manifest?.playbooksDir);
      for (const [k, v] of diskPlaybooks) {
        map.set(k, v);
      }
    } catch {
      // 忽略磁盘规程目录扫描异常
    }
  }
  if (node.manifest?.playbooks && typeof node.manifest.playbooks === "object") {
    for (const [id, item] of Object.entries(node.manifest.playbooks as Record<string, any>)) {
      const existing = map.get(id);
      let content = item.content ?? existing?.content ?? "";
      let filePath = item.entry && node.root
        ? resolve(node.root, item.entry)
        : existing?.filePath;
      if (!content && filePath && existsSync(filePath)) {
        try {
          content = readFileSync(filePath, "utf-8");
        } catch {}
      }
      map.set(id, {
        id,
        description: item.description ?? existing?.description,
        actions: item.actions ?? existing?.actions ?? [],
        content,
        filePath: filePath || "",
      });
    }
  }
  return map;
}

/**
 * Playbook 解析结果。
 */
export interface ResolvedPlaybook {
  /** 所属包标识 */
  readonly packageId: string;
  /** 项目物理根目录绝对路径 */
  readonly projectRoot: string;
  /** 规程标识 */
  readonly playbookId: string;
  /** 规程定义实体 */
  readonly playbook: PlaybookDefinition;
}

export interface ResolvePlaybookContext {
  /** 包拓扑图单一事实源 */
  readonly graph: PackageGraph;
  /** 调用方所在包标识（可选） */
  readonly caller?: string;
}

/**
 * 纯领域规程解析函数 resolvePlaybook。
 * 基于 PackageGraph 替代原 registry 内部的 resolvePlaybookProject 启发式搜索。
 */
export function resolvePlaybook(
  identifier: string,
  context: ResolvePlaybookContext
): ResolvedPlaybook {
  const str = identifier.trim();

  // 1. scoped 形式解析：<package-id>/<playbook-id>
  if (str.includes("/")) {
    const lastSlashIndex = str.lastIndexOf("/");
    const targetPackage = str.slice(0, lastSlashIndex);
    const playbookId = str.slice(lastSlashIndex + 1);

    const node =
      context.graph.packages.get(targetPackage) ||
      Array.from(context.graph.packages.values()).find(
        (n) => getPackageSlug(n.identity.id) === targetPackage
      );

    if (!node) {
      throw new Error(`Package '${targetPackage}' not found`);
    }

    const playbooks = getNodePlaybooks(node);
    const playbook = playbooks.get(playbookId);
    if (!playbook) {
      throw new Error(
        `Playbook '${playbookId}' not found in package '${node.identity.id}' (${node.root})`
      );
    }

    return {
      packageId: node.identity.id,
      projectRoot: node.root,
      playbookId,
      playbook,
    };
  }

  // 2. 优先在 caller 调用方包中匹配
  if (context.caller) {
    const callerNode = context.graph.packages.get(context.caller);
    if (callerNode) {
      const playbooks = getNodePlaybooks(callerNode);
      const pb = playbooks.get(str);
      if (pb) {
        return {
          packageId: callerNode.identity.id,
          projectRoot: callerNode.root,
          playbookId: str,
          playbook: pb,
        };
      }
    }
  }

  // 3. 全局搜索
  const matches: Array<{
    packageId: string;
    projectRoot: string;
    playbookId: string;
    playbook: PlaybookDefinition;
  }> = [];

  for (const node of context.graph.packages.values()) {
    try {
      const playbooks = getNodePlaybooks(node);
      const pb = playbooks.get(str);
      if (pb) {
        matches.push({
          packageId: node.identity.id,
          projectRoot: node.root,
          playbookId: str,
          playbook: pb,
        });
      }
    } catch {
      // 忽略单个包加载异常
    }
  }

  if (matches.length === 1) {
    return matches[0];
  }

  if (matches.length > 1) {
    const pkgList = matches.map((m) => `'${m.packageId}'`).join(", ");
    throw new Error(
      `Playbook '${str}' is provided by multiple linked packages: ${pkgList}. Please specify using '<package-id>/${str}'.`
    );
  }

  throw new Error(`Playbook '${str}' not found in any registered package`);
}
