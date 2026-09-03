import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { findProjectRoot, loadActions, loadPlaybooks, loadProjectConfig } from "../project/loader";
import { getActionDockHome, getPackageSlug } from "../utils";
import type {
  GlobalRegistryData,
  LinkedPackageEntry,
  LinkedWorkspaceEntry,
  LinkResult,
  PruneResult,
  RegistryStatusReport,
  RegistryTreeItem,
  ResolvedActionProject,
  ResolvedPlaybookProject,
  UnlinkResult,
} from "./types";

const IGNORED_SCAN_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  ".gemini",
  ".actiondock",
  ".claude",
  ".idea",
  ".vscode",
]);

/**
 * 递归扫描包含 actiondock.json 的子项目根目录
 */
export function discoverProjects(dir: string, maxDepth: number = 3): string[] {
  const results: string[] = [];
  const resolvedDir = resolve(dir);

  function walk(currentDir: string, currentDepth: number) {
    if (currentDepth > maxDepth) return;
    try {
      const entries = readdirSync(currentDir, { withFileTypes: true });
      const hasActiondock = entries.some((e) => e.isFile() && e.name === "actiondock.json");

      if (hasActiondock && currentDir !== resolvedDir) {
        results.push(currentDir);
        return; // 不再向项目内部子目录递归
      }

      for (const entry of entries) {
        if (entry.isDirectory() && !IGNORED_SCAN_DIRS.has(entry.name)) {
          walk(join(currentDir, entry.name), currentDepth + 1);
        }
      }
    } catch {
      // 忽略无法读取的目录
    }
  }

  walk(resolvedDir, 1);
  return results;
}

export function getRegistryFilePath(customHome?: string): string {
  const baseDir = getActionDockHome(customHome);
  return join(baseDir, ".actiondock", "registry.json");
}

export function loadRegistry(customHome?: string): GlobalRegistryData {
  const filePath = getRegistryFilePath(customHome);
  if (!existsSync(filePath)) {
    return { version: "2.0.0", packages: {}, workspaces: {} };
  }
  try {
    const raw = readFileSync(filePath, "utf-8");
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || !parsed.packages) {
      return { version: "2.0.0", packages: {}, workspaces: {} };
    }
    return {
      version: "2.0.0",
      packages: parsed.packages || {},
      workspaces: parsed.workspaces || {},
    };
  } catch {
    return { version: "2.0.0", packages: {}, workspaces: {} };
  }
}

export function saveRegistry(data: GlobalRegistryData, customHome?: string): void {
  const filePath = getRegistryFilePath(customHome);
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, JSON.stringify(data, null, 2) + "\n", "utf-8");
}

export function linkPackage(
  targetPath: string = process.cwd(),
  customHome?: string,
  options?: { recursive?: boolean }
): LinkResult {
  const absPath = resolve(targetPath);
  const directHasConfig = existsSync(join(absPath, "actiondock.json"));

  // 1. 如果当前目录直接包含 actiondock.json 且未强制递归，按单包链接
  if (directHasConfig && !options?.recursive) {
    const config = loadProjectConfig(absPath);
    const registry = loadRegistry(customHome);

    const entry: LinkedPackageEntry = {
      id: config.id,
      name: config.name,
      version: config.version,
      path: absPath,
      linkedAt: new Date().toISOString(),
    };

    registry.packages[config.id] = entry;
    saveRegistry(registry, customHome);

    return {
      id: config.id,
      name: config.name,
      version: config.version,
      path: absPath,
      linkedAt: entry.linkedAt,
      isWorkspace: false,
      entries: [entry],
    };
  }

  // 2. 尝试扫描子目录发现多个 ActionDock 子项目（Workspace 模式）
  const discoveredRoots = discoverProjects(absPath);

  if (discoveredRoots.length > 0) {
    const registry = loadRegistry(customHome);
    const now = new Date().toISOString();
    const wsEntry: LinkedWorkspaceEntry = {
      path: absPath,
      linkedAt: now,
    };

    registry.workspaces = registry.workspaces || {};
    registry.workspaces[absPath] = wsEntry;

    const linkedEntries: LinkedPackageEntry[] = [];

    for (const root of discoveredRoots) {
      try {
        const config = loadProjectConfig(root);
        const entry: LinkedPackageEntry = {
          id: config.id,
          name: config.name,
          version: config.version,
          path: root,
          linkedAt: now,
          workspaceRoot: absPath,
        };
        registry.packages[config.id] = entry;
        linkedEntries.push(entry);
      } catch {
        // 忽略异常项目
      }
    }

    saveRegistry(registry, customHome);

    const wsName = basename(absPath);
    return {
      id: wsName,
      name: wsName,
      version: "2.0.0",
      path: absPath,
      linkedAt: now,
      isWorkspace: true,
      entries: linkedEntries,
      workspace: wsEntry,
    };
  }

  // 3. 回退检查：如果在子目录执行（例如在 package 的 actions/ 目录下），查找父级项目根目录
  const parentRoot = findProjectRoot(absPath);
  if (parentRoot) {
    const config = loadProjectConfig(parentRoot);
    const registry = loadRegistry(customHome);

    const entry: LinkedPackageEntry = {
      id: config.id,
      name: config.name,
      version: config.version,
      path: parentRoot,
      linkedAt: new Date().toISOString(),
    };

    registry.packages[config.id] = entry;
    saveRegistry(registry, customHome);

    return {
      id: config.id,
      name: config.name,
      version: config.version,
      path: parentRoot,
      linkedAt: entry.linkedAt,
      isWorkspace: false,
      entries: [entry],
    };
  }

  throw new Error(`Cannot link: actiondock.json not found in '${absPath}' or its subdirectories`);
}

export function unlinkPackage(
  identifier: string = process.cwd(),
  customHome?: string
): UnlinkResult | null {
  const registry = loadRegistry(customHome);
  const absPath = resolve(identifier);

  // 1. 检查是否匹配 Workspace 绝对路径
  if (registry.workspaces && registry.workspaces[absPath]) {
    const removedWs = registry.workspaces[absPath];
    delete registry.workspaces[absPath];

    let removedCount = 0;
    for (const [id, entry] of Object.entries(registry.packages)) {
      if (entry.workspaceRoot === absPath || entry.path.startsWith(absPath)) {
        delete registry.packages[id];
        removedCount++;
      }
    }
    saveRegistry(registry, customHome);
    return {
      type: "workspace",
      id: basename(absPath),
      path: absPath,
      packagesCount: removedCount,
      removedWorkspace: removedWs,
    };
  }

  // 2. 检查是否匹配 Workspace 目录别名
  if (registry.workspaces) {
    for (const [wsPath, wsEntry] of Object.entries(registry.workspaces)) {
      if (basename(wsPath) === identifier) {
        delete registry.workspaces[wsPath];
        let removedCount = 0;
        for (const [id, entry] of Object.entries(registry.packages)) {
          if (entry.workspaceRoot === wsPath || entry.path.startsWith(wsPath)) {
            delete registry.packages[id];
            removedCount++;
          }
        }
        saveRegistry(registry, customHome);
        return {
          type: "workspace",
          id: basename(wsPath),
          path: wsPath,
          packagesCount: removedCount,
          removedWorkspace: wsEntry,
        };
      }
    }
  }

  // 3. 检查是否直接匹配 Package ID
  let targetKey: string | undefined;
  if (registry.packages[identifier]) {
    targetKey = identifier;
  } else {
    // 匹配路径或短 slug
    for (const [id, entry] of Object.entries(registry.packages)) {
      if (
        entry.path === absPath ||
        entry.id === identifier ||
        getPackageSlug(entry.id) === identifier
      ) {
        targetKey = id;
        break;
      }
    }
  }

  if (!targetKey) {
    return null;
  }

  const removed = registry.packages[targetKey];
  delete registry.packages[targetKey];
  saveRegistry(registry, customHome);
  return {
    type: "package",
    id: removed.id,
    path: removed.path,
    packagesCount: 1,
    removedPackage: removed,
  };
}

export function listLinkedPackages(customHome?: string): LinkedPackageEntry[] {
  const registry = loadRegistry(customHome);
  const result: Record<string, LinkedPackageEntry> = { ...registry.packages };

  // 动态扫描已挂载的 Workspace 目录，确保新拉取/新建的子包即时感知
  if (registry.workspaces) {
    for (const ws of Object.values(registry.workspaces)) {
      if (!existsSync(ws.path)) continue;
      const discovered = discoverProjects(ws.path);
      for (const root of discovered) {
        try {
          const config = loadProjectConfig(root);
          if (!result[config.id] || result[config.id].workspaceRoot === ws.path) {
            result[config.id] = {
              id: config.id,
              name: config.name,
              version: config.version,
              path: root,
              linkedAt: ws.linkedAt,
              workspaceRoot: ws.path,
            };
          }
        } catch {
          // 忽略异常项目
        }
      }
    }
  }

  return Object.values(result);
}

export function listLinkedWorkspaces(customHome?: string): LinkedWorkspaceEntry[] {
  const registry = loadRegistry(customHome);
  return Object.values(registry.workspaces || {});
}

export async function resolveActionProject(
  actionIdentifier: string,
  cwd: string = process.cwd(),
  customHome?: string
): Promise<ResolvedActionProject> {
  // 1. Check current directory / parent project
  const currentRoot = findProjectRoot(cwd);
  if (currentRoot) {
    try {
      const config = loadProjectConfig(currentRoot);
      const actions = await loadActions(currentRoot, config.actionsDir);
      if (actions.has(actionIdentifier)) {
        return {
          projectRoot: currentRoot,
          packageId: config.id,
          actionId: actionIdentifier,
        };
      }
    } catch {
      // Ignore and proceed to registry lookup
    }
  }

  // 2. Check if scoped format: <package-id>/<action-id> or <package-id>:<action-id>
  let targetPackage: string | undefined;
  let pureActionId = actionIdentifier;

  if (actionIdentifier.includes("/")) {
    const slashIdx = actionIdentifier.indexOf("/");
    targetPackage = actionIdentifier.slice(0, slashIdx);
    pureActionId = actionIdentifier.slice(slashIdx + 1);
  } else if (actionIdentifier.includes(":")) {
    const colonIdx = actionIdentifier.indexOf(":");
    targetPackage = actionIdentifier.slice(0, colonIdx);
    pureActionId = actionIdentifier.slice(colonIdx + 1);
  }

  const linkedList = listLinkedPackages(customHome);

  if (targetPackage) {
    const pkg = linkedList.find(
      (p) => p.id === targetPackage || getPackageSlug(p.id) === targetPackage
    );

    if (!pkg || !existsSync(pkg.path)) {
      throw new Error(
        `Linked package '${targetPackage}' not found or path no longer exists (${pkg?.path || "unregistered"}). Run 'ad link' in the package directory.`
      );
    }

    const config = loadProjectConfig(pkg.path);
    const actions = await loadActions(pkg.path, config.actionsDir);
    if (!actions.has(pureActionId)) {
      throw new Error(`Action '${pureActionId}' not found in package '${pkg.id}' (${pkg.path})`);
    }

    return {
      projectRoot: pkg.path,
      packageId: pkg.id,
      actionId: pureActionId,
    };
  }

  // 3. Search across all linked packages
  const matches: Array<{ entry: LinkedPackageEntry; actionId: string }> = [];

  for (const pkg of linkedList) {
    if (!existsSync(pkg.path)) continue;
    try {
      const config = loadProjectConfig(pkg.path);
      const actions = await loadActions(pkg.path, config.actionsDir);
      if (actions.has(actionIdentifier)) {
        matches.push({ entry: pkg, actionId: actionIdentifier });
      }
    } catch {
      // Ignore invalid linked package
    }
  }

  if (matches.length === 1) {
    return {
      projectRoot: matches[0].entry.path,
      packageId: matches[0].entry.id,
      actionId: matches[0].actionId,
    };
  }

  if (matches.length > 1) {
    const pkgList = matches.map((m) => `'${m.entry.id}'`).join(", ");
    throw new Error(
      `Action '${actionIdentifier}' is provided by multiple linked packages: ${pkgList}. Please specify using '<package-id>/${actionIdentifier}'.`
    );
  }

  if (currentRoot) {
    throw new Error(`Action '${actionIdentifier}' not found in current project or any linked packages`);
  } else {
    throw new Error(
      `Action '${actionIdentifier}' not found. You are not in an ActionDock project, and no linked package provides '${actionIdentifier}'. Use 'ad link' to register your package.`
    );
  }
}

export function resolvePackageRoot(
  packageIdOrPath?: string,
  cwd?: string,
  customHome?: string
): string | null {
  if (packageIdOrPath) {
    const directRoot = findProjectRoot(packageIdOrPath);
    if (directRoot) return directRoot;

    const linkedList = listLinkedPackages(customHome);
    const found = linkedList.find(
      (p) =>
        p.id === packageIdOrPath ||
        getPackageSlug(p.id) === packageIdOrPath ||
        p.path === resolve(packageIdOrPath)
    );
    if (found) {
      return found.path;
    }
    return null;
  }

  return findProjectRoot(cwd);
}

export function resolvePlaybookProject(
  playbookIdentifier: string,
  cwd: string = process.cwd(),
  customHome?: string
): ResolvedPlaybookProject {
  // 1. Check current directory / parent project
  const currentRoot = findProjectRoot(cwd);
  if (currentRoot) {
    try {
      const config = loadProjectConfig(currentRoot);
      const playbooks = loadPlaybooks(currentRoot, config.playbooksDir);
      if (playbooks.has(playbookIdentifier)) {
        return {
          projectRoot: currentRoot,
          packageId: config.id,
          playbookId: playbookIdentifier,
          playbook: playbooks.get(playbookIdentifier)!,
        };
      }
    } catch {
      // Ignore and proceed to registry lookup
    }
  }

  // 2. Check if scoped format: <package-id>/<playbook-id> or <package-id>:<playbook-id>
  let targetPackage: string | undefined;
  let purePlaybookId = playbookIdentifier;

  if (playbookIdentifier.includes("/")) {
    const slashIdx = playbookIdentifier.indexOf("/");
    targetPackage = playbookIdentifier.slice(0, slashIdx);
    purePlaybookId = playbookIdentifier.slice(slashIdx + 1);
  } else if (playbookIdentifier.includes(":")) {
    const colonIdx = playbookIdentifier.indexOf(":");
    targetPackage = playbookIdentifier.slice(0, colonIdx);
    purePlaybookId = playbookIdentifier.slice(colonIdx + 1);
  }

  const linkedList = listLinkedPackages(customHome);

  if (targetPackage) {
    const pkg = linkedList.find(
      (p) => p.id === targetPackage || getPackageSlug(p.id) === targetPackage
    );

    if (!pkg || !existsSync(pkg.path)) {
      throw new Error(
        `Linked package '${targetPackage}' not found or path no longer exists (${pkg?.path || "unregistered"}). Run 'ad link' in the package directory.`
      );
    }

    const config = loadProjectConfig(pkg.path);
    const playbooks = loadPlaybooks(pkg.path, config.playbooksDir);
    const pb = playbooks.get(purePlaybookId);
    if (!pb) {
      throw new Error(`Playbook '${purePlaybookId}' not found in package '${pkg.id}' (${pkg.path})`);
    }

    return {
      projectRoot: pkg.path,
      packageId: pkg.id,
      playbookId: purePlaybookId,
      playbook: pb,
    };
  }

  // 3. Search across all linked packages
  const matches: Array<{ entry: LinkedPackageEntry; playbookId: string; playbook: import("../project/types").PlaybookDefinition }> = [];

  for (const pkg of linkedList) {
    if (!existsSync(pkg.path)) continue;
    try {
      const config = loadProjectConfig(pkg.path);
      const playbooks = loadPlaybooks(pkg.path, config.playbooksDir);
      if (playbooks.has(playbookIdentifier)) {
        matches.push({
          entry: pkg,
          playbookId: playbookIdentifier,
          playbook: playbooks.get(playbookIdentifier)!,
        });
      }
    } catch {
      // Ignore invalid linked package
    }
  }

  if (matches.length === 1) {
    return {
      projectRoot: matches[0].entry.path,
      packageId: matches[0].entry.id,
      playbookId: matches[0].playbookId,
      playbook: matches[0].playbook,
    };
  }

  if (matches.length > 1) {
    const pkgList = matches.map((m) => `'${m.entry.id}'`).join(", ");
    throw new Error(
      `Playbook '${playbookIdentifier}' is provided by multiple linked packages: ${pkgList}. Please specify using '<package-id>/${playbookIdentifier}'.`
    );
  }

  if (currentRoot) {
    throw new Error(`Playbook '${playbookIdentifier}' not found in current project or any linked packages`);
  } else {
    throw new Error(
      `Playbook '${playbookIdentifier}' not found. You are not in an ActionDock project, and no linked package provides '${playbookIdentifier}'. Use 'ad link' to register your package.`
    );
  }
}

export function getRegistryStatus(customHome?: string): RegistryStatusReport {
  const registry = loadRegistry(customHome);
  const workspaces: RegistryTreeItem[] = [];
  const packages: RegistryTreeItem[] = [];
  let staleCount = 0;
  const seenPackageIds = new Set<string>();

  // 1. Process workspaces
  if (registry.workspaces) {
    for (const [wsPath, wsEntry] of Object.entries(registry.workspaces)) {
      const isWsActive = existsSync(wsPath);
      if (!isWsActive) {
        staleCount++;
        workspaces.push({
          type: "workspace",
          id: basename(wsPath),
          path: wsPath,
          status: "stale",
          packagesCount: 0,
          children: [],
        });
        continue;
      }

      const discoveredRoots = discoverProjects(wsPath);
      const children: NonNullable<RegistryTreeItem["children"]> = [];

      for (const root of discoveredRoots) {
        try {
          const config = loadProjectConfig(root);
          seenPackageIds.add(config.id);
          children.push({
            id: config.id,
            name: config.name,
            version: config.version,
            path: root,
            status: "active",
          });
        } catch {
          // ignore broken project
        }
      }

      workspaces.push({
        type: "workspace",
        id: basename(wsPath),
        path: wsPath,
        status: "active",
        packagesCount: children.length,
        children,
      });
    }
  }

  // 2. Process standalone packages (not part of an active workspace)
  for (const [pkgId, pkgEntry] of Object.entries(registry.packages)) {
    if (pkgEntry.workspaceRoot && registry.workspaces && registry.workspaces[pkgEntry.workspaceRoot]) {
      continue;
    }
    if (seenPackageIds.has(pkgId)) {
      continue;
    }

    const isPkgActive = existsSync(pkgEntry.path);
    if (!isPkgActive) {
      staleCount++;
      packages.push({
        type: "package",
        id: pkgEntry.id,
        name: pkgEntry.name,
        version: pkgEntry.version,
        path: pkgEntry.path,
        status: "stale",
      });
    } else {
      packages.push({
        type: "package",
        id: pkgEntry.id,
        name: pkgEntry.name,
        version: pkgEntry.version,
        path: pkgEntry.path,
        status: "active",
      });
    }
  }

  const totalPackagesCount =
    workspaces.reduce((acc, ws) => acc + (ws.children?.length || 0), 0) +
    packages.filter((p) => p.status === "active").length;

  return {
    workspaces,
    packages,
    staleCount,
    totalPackagesCount,
  };
}

export function pruneRegistry(customHome?: string): PruneResult {
  const registry = loadRegistry(customHome);
  const prunedWorkspaces: LinkedWorkspaceEntry[] = [];
  const prunedPackages: LinkedPackageEntry[] = [];

  // 1. Prune workspaces
  if (registry.workspaces) {
    for (const [wsPath, wsEntry] of Object.entries(registry.workspaces)) {
      if (!existsSync(wsPath)) {
        prunedWorkspaces.push(wsEntry);
        delete registry.workspaces[wsPath];
      }
    }
  }

  // 2. Prune packages
  for (const [pkgId, pkgEntry] of Object.entries(registry.packages)) {
    if (!existsSync(pkgEntry.path)) {
      prunedPackages.push(pkgEntry);
      delete registry.packages[pkgId];
    }
  }

  if (prunedWorkspaces.length > 0 || prunedPackages.length > 0) {
    saveRegistry(registry, customHome);
  }

  return {
    prunedPackages,
    prunedWorkspaces,
  };
}


