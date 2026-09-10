import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { findProjectRoot, loadActions, loadPlaybooks, loadProjectConfig } from "../project/loader";
import { loadManifest } from "../project/manifest";
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
 * 跨平台注册表写锁控制函数（防止多进程并发读写导致 registry.json 损坏）。
 */
export function withRegistryLock<T>(filePath: string, fn: () => T): T {
  const lockDir = `${filePath}.lock`;
  const timeoutMs = 5000;
  const startTime = Date.now();

  while (true) {
    try {
      mkdirSync(lockDir);
      break;
    } catch (err: any) {
      if (err.code === "EEXIST") {
        try {
          const stat = statSync(lockDir);
          if (Date.now() - stat.mtimeMs > 10000) {
            rmSync(lockDir, { recursive: true, force: true });
            continue;
          }
        } catch {}

        if (Date.now() - startTime > timeoutMs) {
          rmSync(lockDir, { recursive: true, force: true });
          mkdirSync(lockDir);
          break;
        }

        const waitTill = Date.now() + 25;
        while (Date.now() < waitTill) {}
      } else {
        throw err;
      }
    }
  }

  try {
    return fn();
  } finally {
    try {
      rmSync(lockDir, { recursive: true, force: true });
    } catch {}
  }
}

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
    if (!parsed || typeof parsed !== "object") {
      return { version: "2.0.0", packages: {}, workspaces: {} };
    }

    const packages: Record<string, LinkedPackageEntry> = parsed.packages || {};
    const workspaces: Record<string, LinkedWorkspaceEntry> = parsed.workspaces || {};

    // 格式兼容与迁移：如果包含 schemaVersion: 1 的 links 但缺少 packages/workspaces
    if (Array.isArray(parsed.links) && Object.keys(packages).length === 0 && Object.keys(workspaces).length === 0) {
      for (const link of parsed.links) {
        if (!link.path || !existsSync(link.path)) continue;
        if (link.type === "workspace") {
          workspaces[link.path] = {
            path: resolve(link.path),
            linkedAt: link.linkedAt || new Date().toISOString(),
          };
        } else {
          try {
            const config = loadProjectConfig(link.path);
            packages[config.id] = {
              id: config.id,
              name: config.name || config.id,
              version: config.version || "0.0.0",
              path: resolve(link.path),
              linkedAt: link.linkedAt || new Date().toISOString(),
            };
          } catch {}
        }
      }
    }

    return {
      version: "2.0.0",
      packages,
      workspaces,
    };
  } catch {
    return { version: "2.0.0", packages: {}, workspaces: {} };
  }
}

export function saveRegistry(data: GlobalRegistryData, customHome?: string): void {
  const filePath = getRegistryFilePath(customHome);
  const dir = dirname(filePath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  // 统一输出包含 schemaVersion: 1 与 links 的复合格式，保障双向兼容
  const links: Array<{ type: "package" | "workspace"; path: string; linkedAt: string; depth?: number }> = [];
  if (data.workspaces) {
    for (const [wsPath, ws] of Object.entries(data.workspaces)) {
      links.push({
        type: "workspace",
        path: resolve(ws.path || wsPath),
        linkedAt: ws.linkedAt || new Date().toISOString(),
        depth: 3,
      });
    }
  }
  if (data.packages) {
    for (const pkg of Object.values(data.packages)) {
      if (!pkg.workspaceRoot && pkg.path) {
        links.push({
          type: "package",
          path: resolve(pkg.path),
          linkedAt: pkg.linkedAt || new Date().toISOString(),
        });
      }
    }
  }

  const unifiedData = {
    version: "2.0.0",
    schemaVersion: 1,
    packages: data.packages || {},
    workspaces: data.workspaces || {},
    links,
  };

  withRegistryLock(filePath, () => {
    const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
    writeFileSync(tempPath, JSON.stringify(unifiedData, null, 2) + "\n", "utf-8");
    renameSync(tempPath, filePath);
  });
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

    const pkgName = config.name || config.id;
    const pkgVersion = config.version || "0.0.0";
    const entry: LinkedPackageEntry = {
      id: config.id,
      name: pkgName,
      version: pkgVersion,
      path: absPath,
      linkedAt: new Date().toISOString(),
    };

    registry.packages[config.id] = entry;
    saveRegistry(registry, customHome);

    return {
      id: config.id,
      name: pkgName,
      version: pkgVersion,
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
          name: config.name || config.id,
          version: config.version || "0.0.0",
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

    const pkgName = config.name || config.id;
    const pkgVersion = config.version || "0.0.0";
    const entry: LinkedPackageEntry = {
      id: config.id,
      name: pkgName,
      version: pkgVersion,
      path: parentRoot,
      linkedAt: new Date().toISOString(),
    };

    registry.packages[config.id] = entry;
    saveRegistry(registry, customHome);

    return {
      id: config.id,
      name: pkgName,
      version: pkgVersion,
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
              name: config.name || config.id,
              version: config.version || "0.0.0",
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

async function projectHasAction(
  projectRoot: string,
  actionsDir: string | undefined,
  actionId: string
): Promise<boolean> {
  const manifest = loadManifest(projectRoot);
  if (manifest?.actions && actionId in manifest.actions) {
    return true;
  }
  try {
    const actions = await loadActions(projectRoot, actionsDir, { autoInstall: false });
    return actions.has(actionId);
  } catch {
    return projectHasActionSync(projectRoot, actionsDir, actionId);
  }
}

function projectHasActionSync(
  projectRoot: string,
  actionsDir: string | undefined,
  actionId: string
): boolean {
  const manifest = loadManifest(projectRoot);
  if (manifest?.actions && actionId in manifest.actions) {
    return true;
  }
  const dir = join(projectRoot, actionsDir || "actions");
  if (!existsSync(dir)) {
    return false;
  }
  if (actionId.includes("..") || actionId.startsWith("/") || actionId.startsWith("\\")) {
    return false;
  }
  if (existsSync(join(dir, `${actionId}.ts`)) || existsSync(join(dir, `${actionId}.js`))) {
    return true;
  }
  const relFile = actionId.replace(/\./g, "/");
  if (existsSync(join(dir, `${relFile}.ts`)) || existsSync(join(dir, `${relFile}.js`))) {
    return true;
  }
  return false;
}

export function resolveActionProjectSync(
  actionIdentifier: string,
  cwd: string = process.cwd(),
  customHome?: string
): ResolvedActionProject {
  // 1. Check current directory / parent project
  const currentRoot = findProjectRoot(cwd);
  if (currentRoot) {
    try {
      const config = loadProjectConfig(currentRoot);
      if (projectHasActionSync(currentRoot, config.actionsDir, actionIdentifier)) {
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
    const slashIdx = actionIdentifier.lastIndexOf("/");
    targetPackage = actionIdentifier.slice(0, slashIdx);
    pureActionId = actionIdentifier.slice(slashIdx + 1);
  } else if (actionIdentifier.includes(":")) {
    const colonIdx = actionIdentifier.lastIndexOf(":");
    targetPackage = actionIdentifier.slice(0, colonIdx);
    pureActionId = actionIdentifier.slice(colonIdx + 1);
  }

  const linkedList = listLinkedPackages(customHome);

  if (targetPackage) {
    let targetRoot: string | undefined;
    let targetPkgId = targetPackage;

    if (currentRoot) {
      try {
        const config = loadProjectConfig(currentRoot);
        if (config.id === targetPackage || getPackageSlug(config.id) === targetPackage) {
          targetRoot = currentRoot;
          targetPkgId = config.id;
        }
      } catch {
        // Ignore
      }
    }

    let pkg: LinkedPackageEntry | undefined;
    if (!targetRoot) {
      pkg = linkedList.find(
        (p) => p.id === targetPackage || getPackageSlug(p.id) === targetPackage
      );
      if (pkg && existsSync(pkg.path)) {
        targetRoot = pkg.path;
        targetPkgId = pkg.id;
      }
    }

    if (!targetRoot || !existsSync(targetRoot)) {
      throw new Error(
        `Linked package '${targetPackage}' not found or path no longer exists (${pkg?.path || "unregistered"}). Run 'ad link' in the package directory.`
      );
    }

    const config = loadProjectConfig(targetRoot);
    if (!projectHasActionSync(targetRoot, config.actionsDir, pureActionId)) {
      throw new Error(`Action '${pureActionId}' not found in package '${targetPkgId}' (${targetRoot})`);
    }

    return {
      projectRoot: targetRoot,
      packageId: targetPkgId,
      actionId: pureActionId,
    };
  }

  // 3. Search across all linked packages
  const matches: Array<{ entry: LinkedPackageEntry; actionId: string }> = [];

  for (const pkg of linkedList) {
    if (!existsSync(pkg.path)) continue;
    try {
      const config = loadProjectConfig(pkg.path);
      if (projectHasActionSync(pkg.path, config.actionsDir, actionIdentifier)) {
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
      if (await projectHasAction(currentRoot, config.actionsDir, actionIdentifier)) {
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
    const slashIdx = actionIdentifier.lastIndexOf("/");
    targetPackage = actionIdentifier.slice(0, slashIdx);
    pureActionId = actionIdentifier.slice(slashIdx + 1);
  } else if (actionIdentifier.includes(":")) {
    const colonIdx = actionIdentifier.lastIndexOf(":");
    targetPackage = actionIdentifier.slice(0, colonIdx);
    pureActionId = actionIdentifier.slice(colonIdx + 1);
  }

  const linkedList = listLinkedPackages(customHome);

  if (targetPackage) {
    let targetRoot: string | undefined;
    let targetPkgId = targetPackage;

    if (currentRoot) {
      try {
        const config = loadProjectConfig(currentRoot);
        if (config.id === targetPackage || getPackageSlug(config.id) === targetPackage) {
          targetRoot = currentRoot;
          targetPkgId = config.id;
        }
      } catch {
        // Ignore
      }
    }

    let pkg: LinkedPackageEntry | undefined;
    if (!targetRoot) {
      pkg = linkedList.find(
        (p) => p.id === targetPackage || getPackageSlug(p.id) === targetPackage
      );
      if (pkg && existsSync(pkg.path)) {
        targetRoot = pkg.path;
        targetPkgId = pkg.id;
      }
    }

    if (!targetRoot || !existsSync(targetRoot)) {
      throw new Error(
        `Linked package '${targetPackage}' not found or path no longer exists (${pkg?.path || "unregistered"}). Run 'ad link' in the package directory.`
      );
    }

    const config = loadProjectConfig(targetRoot);
    if (!(await projectHasAction(targetRoot, config.actionsDir, pureActionId))) {
      throw new Error(`Action '${pureActionId}' not found in package '${targetPkgId}' (${targetRoot})`);
    }

    return {
      projectRoot: targetRoot,
      packageId: targetPkgId,
      actionId: pureActionId,
    };
  }

  // 3. Search across all linked packages
  const matches: Array<{ entry: LinkedPackageEntry; actionId: string }> = [];

  for (const pkg of linkedList) {
    if (!existsSync(pkg.path)) continue;
    try {
      const config = loadProjectConfig(pkg.path);
      if (await projectHasAction(pkg.path, config.actionsDir, actionIdentifier)) {
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
  if (!packageIdOrPath) {
    return findProjectRoot(cwd);
  }

  const baseDir = cwd || process.cwd();
  const resolvedPath = resolve(baseDir, packageIdOrPath);

  // 1. Check if packageIdOrPath is an existing directory or file path on disk
  if (existsSync(resolvedPath)) {
    try {
      const stat = statSync(resolvedPath);
      const targetDir = stat.isDirectory() ? resolvedPath : dirname(resolvedPath);
      if (existsSync(join(targetDir, "actiondock.json"))) {
        return targetDir;
      }
      const parentRoot = findProjectRoot(targetDir);
      if (parentRoot) {
        return parentRoot;
      }
    } catch {
      // ignore
    }
  }

  // If it was explicitly a path (starts with . or / or ~ or contains / or \), and did not resolve above:
  // Scoped package identifiers (e.g. @team/tools) contain '/' but are package IDs, not file paths.
  const isScopedPackage = packageIdOrPath.startsWith("@");
  const isExplicitPath =
    !isScopedPackage &&
    (packageIdOrPath.startsWith(".") ||
      packageIdOrPath.startsWith("/") ||
      packageIdOrPath.startsWith("~") ||
      packageIdOrPath.includes("/") ||
      packageIdOrPath.includes("\\"));

  if (isExplicitPath) {
    // An explicit path that does not exist or is not an ActionDock project must fail
    return null;
  }

  // 2. Check current project (from cwd)
  const currentRoot = findProjectRoot(cwd);
  if (currentRoot) {
    try {
      const config = loadProjectConfig(currentRoot);
      if (config.id === packageIdOrPath || getPackageSlug(config.id) === packageIdOrPath) {
        return currentRoot;
      }
    } catch {
      // ignore broken config
    }
  }

  // 3. Check linked packages in registry
  const linkedList = listLinkedPackages(customHome);
  const found = linkedList.find(
    (p) =>
      p.id === packageIdOrPath ||
      getPackageSlug(p.id) === packageIdOrPath ||
      p.path === resolvedPath
  );
  if (found) {
    return found.path;
  }

  return null;
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
    const slashIdx = playbookIdentifier.lastIndexOf("/");
    targetPackage = playbookIdentifier.slice(0, slashIdx);
    purePlaybookId = playbookIdentifier.slice(slashIdx + 1);
  } else if (playbookIdentifier.includes(":")) {
    const colonIdx = playbookIdentifier.lastIndexOf(":");
    targetPackage = playbookIdentifier.slice(0, colonIdx);
    purePlaybookId = playbookIdentifier.slice(colonIdx + 1);
  }

  const linkedList = listLinkedPackages(customHome);

  if (targetPackage) {
    let targetRoot: string | undefined;
    let targetPkgId = targetPackage;

    if (currentRoot) {
      try {
        const config = loadProjectConfig(currentRoot);
        if (config.id === targetPackage || getPackageSlug(config.id) === targetPackage) {
          targetRoot = currentRoot;
          targetPkgId = config.id;
        }
      } catch {
        // Ignore
      }
    }

    let pkg: LinkedPackageEntry | undefined;
    if (!targetRoot) {
      pkg = linkedList.find(
        (p) => p.id === targetPackage || getPackageSlug(p.id) === targetPackage
      );
      if (pkg && existsSync(pkg.path)) {
        targetRoot = pkg.path;
        targetPkgId = pkg.id;
      }
    }

    if (!targetRoot || !existsSync(targetRoot)) {
      throw new Error(
        `Linked package '${targetPackage}' not found or path no longer exists (${pkg?.path || "unregistered"}). Run 'ad link' in the package directory.`
      );
    }

    const config = loadProjectConfig(targetRoot);
    const playbooks = loadPlaybooks(targetRoot, config.playbooksDir);
    const pb = playbooks.get(purePlaybookId);
    if (!pb) {
      throw new Error(`Playbook '${purePlaybookId}' not found in package '${targetPkgId}' (${targetRoot})`);
    }

    return {
      projectRoot: targetRoot,
      packageId: targetPkgId,
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
    for (const wsPath of Object.keys(registry.workspaces)) {
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
            name: config.name || config.id,
            version: config.version || "0.0.0",
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


