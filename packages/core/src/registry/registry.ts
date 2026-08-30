import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { findProjectRoot, loadActions, loadProjectConfig } from "../project/loader";
import { getActionDockHome, getPackageSlug } from "../utils";
import type { GlobalRegistryData, LinkedPackageEntry, ResolvedActionProject } from "./types";

export function getRegistryFilePath(customHome?: string): string {
  const baseDir = getActionDockHome(customHome);
  return join(baseDir, ".actiondock", "registry.json");
}

export function loadRegistry(customHome?: string): GlobalRegistryData {
  const filePath = getRegistryFilePath(customHome);
  if (!existsSync(filePath)) {
    return { version: "2.0.0", packages: {} };
  }
  try {
    const raw = readFileSync(filePath, "utf-8");
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || !parsed.packages) {
      return { version: "2.0.0", packages: {} };
    }
    return parsed as GlobalRegistryData;
  } catch {
    return { version: "2.0.0", packages: {} };
  }
}

export function saveRegistry(data: GlobalRegistryData, customHome?: string): void {
  const filePath = getRegistryFilePath(customHome);
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, JSON.stringify(data, null, 2) + "\n", "utf-8");
}

export function linkPackage(
  targetPath: string = process.cwd(),
  customHome?: string
): LinkedPackageEntry {
  const absPath = resolve(targetPath);
  const root = findProjectRoot(absPath);
  if (!root) {
    throw new Error(`Cannot link: actiondock.json not found in '${absPath}' or its parent directories`);
  }

  const config = loadProjectConfig(root);
  const registry = loadRegistry(customHome);

  const entry: LinkedPackageEntry = {
    id: config.id,
    name: config.name,
    version: config.version,
    path: root,
    linkedAt: new Date().toISOString(),
  };

  registry.packages[config.id] = entry;
  saveRegistry(registry, customHome);
  return entry;
}

export function unlinkPackage(
  identifier: string = process.cwd(),
  customHome?: string
): LinkedPackageEntry | null {
  const registry = loadRegistry(customHome);
  const absPath = resolve(identifier);

  let targetKey: string | undefined;

  // Direct package ID match
  if (registry.packages[identifier]) {
    targetKey = identifier;
  } else {
    // Match by path or short slug
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
  return removed;
}

export function listLinkedPackages(customHome?: string): LinkedPackageEntry[] {
  const registry = loadRegistry(customHome);
  return Object.values(registry.packages);
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

  const registry = loadRegistry(customHome);
  const linkedList = Object.values(registry.packages);

  if (targetPackage) {
    const pkg =
      registry.packages[targetPackage] ||
      linkedList.find(
        (p) => p.id === targetPackage || getPackageSlug(p.id) === targetPackage
      );

    if (!pkg || !existsSync(pkg.path)) {
      throw new Error(
        `Linked package '${targetPackage}' not found or path no longer exists (${pkg?.path || "unregistered"}). Run 'ac link' in the package directory.`
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
      `Action '${actionIdentifier}' not found. You are not in an ActionDock project, and no linked package provides '${actionIdentifier}'. Use 'ac link' to register your package.`
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

    const registry = loadRegistry(customHome);
    if (registry.packages[packageIdOrPath]) {
      return registry.packages[packageIdOrPath].path;
    }
    for (const [id, entry] of Object.entries(registry.packages)) {
      if (id === packageIdOrPath || getPackageSlug(id) === packageIdOrPath) {
        return entry.path;
      }
    }
  }

  return findProjectRoot(cwd);
}
