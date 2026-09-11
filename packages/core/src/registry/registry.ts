import { existsSync, mkdirSync, readFileSync, renameSync, statSync } from "node:fs";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { findProjectRoot, loadProjectConfig } from "../project/loader";
import { getActionDockHome, getPackageSlug } from "../utils";
import { withRegistryLock } from "./lock";
import {
  buildLinkedPackageEntry,
  discoverProjectConfigs,
  discoverProjectConfigsAsync,
  discoverProjects,
  pathExistsAsync,
} from "./scan";
import {
  probeActionAsync,
  probeActionSync,
  probePlaybook,
  resolveEntityFlow,
  runFlowAsync,
  runFlowSync,
} from "./resolve";
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

/**
 * 空注册表初始结构。
 */
function emptyRegistry(): GlobalRegistryData {
  return { version: "2.0.0", packages: {}, workspaces: {} };
}

/**
 * 注册表内容解析与 links 迁移（纯函数，同步与异步加载共享的唯一事实源）。
 *
 * @param raw 文件原始文本
 * @param filePath 注册表文件路径（用于错误信息定位）
 * @returns 解析后的注册表数据
 * @throws JSON 非法或顶层非对象时抛出带恢复指引的错误（调用方负责留档原文件）
 */
export function parseRegistryContent(raw: string, filePath: string): GlobalRegistryData {
  let parsed: any;
  try {
    parsed = JSON.parse(raw);
  } catch (err: any) {
    throw new Error(
      `Registry file '${filePath}' is corrupted (invalid JSON: ${err.message}). ` +
        `The original data has been preserved as '${filePath}.corrupt' and can be restored manually. ` +
        `Fix or restore the file, or remove it to start with an empty registry.`
    );
  }

  if (!parsed || typeof parsed !== "object") {
    throw new Error(
      `Registry file '${filePath}' is corrupted (top-level value is not an object). ` +
        `The original data has been preserved as '${filePath}.corrupt' and can be restored manually. ` +
        `Fix or restore the file, or remove it to start with an empty registry.`
    );
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
          packages[config.id] = buildLinkedPackageEntry(config, resolve(link.path), link.linkedAt || new Date().toISOString());
        } catch {
          // 迁移时项目已损坏或配置非法：跳过该条 link，避免迁移整体失败
        }
      }
    }
  }

  return {
    version: "2.0.0",
    packages,
    workspaces,
  };
}

export function getRegistryFilePath(customHome?: string): string {
  const baseDir = getActionDockHome(customHome);
  return join(baseDir, ".actiondock", "registry.json");
}

/**
 * 同步加载注册表（保留同步签名供 CLI 与诊断路径使用）。
 *
 * @throws 注册表文件损坏时抛出带恢复指引的错误，绝不静默返回空表，
 * 否则下次 save 会用空数据覆盖原文件导致全部链接记录丢失
 */
export function loadRegistry(customHome?: string): GlobalRegistryData {
  const filePath = getRegistryFilePath(customHome);
  if (!existsSync(filePath)) {
    return emptyRegistry();
  }

  let raw: string;
  try {
    raw = readFileSync(filePath, "utf-8");
  } catch (err: any) {
    if (err.code === "ENOENT") {
      return emptyRegistry();
    }
    throw err;
  }

  try {
    return parseRegistryContent(raw, filePath);
  } catch (err) {
    archiveCorruptFile(filePath);
    throw err;
  }
}

/**
 * 异步加载注册表（损坏语义与同步版一致：留档后抛错，不静默清空）。
 */
export async function loadRegistryAsync(customHome?: string): Promise<GlobalRegistryData> {
  const filePath = getRegistryFilePath(customHome);

  let raw: string;
  try {
    raw = await readFile(filePath, "utf-8");
  } catch (err: any) {
    if (err.code === "ENOENT") {
      return emptyRegistry();
    }
    throw err;
  }

  try {
    return parseRegistryContent(raw, filePath);
  } catch (err) {
    archiveCorruptFile(filePath);
    throw err;
  }
}

/**
 * 将损坏的注册表文件原子留档为 `${filePath}.corrupt`，
 * 后续 save 的临时文件 rename 不会覆盖留档（文件名不同）。
 */
function archiveCorruptFile(filePath: string): void {
  try {
    renameSync(filePath, `${filePath}.corrupt`);
  } catch {
    // 留档失败（如文件被其他进程先行移动）时仅放弃留档：错误仍会向上抛出，
    // 不会出现静默清空
  }
}

/**
 * 由结构化数据构造统一落盘载荷（schemaVersion 1 复合格式，保障双向兼容）。
 */
function buildUnifiedPayload(data: GlobalRegistryData): object {
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

  return {
    version: "2.0.0",
    schemaVersion: 1,
    packages: data.packages || {},
    workspaces: data.workspaces || {},
    links,
  };
}

let tmpFileSeq = 0;

/**
 * 原子写入注册表：临时文件写盘后 rename，持锁执行，避免并发撕裂。
 */
export async function saveRegistry(data: GlobalRegistryData, customHome?: string): Promise<void> {
  const filePath = getRegistryFilePath(customHome);
  ensureRegistryDir(filePath);

  const unifiedData = buildUnifiedPayload(data);
  const payload = JSON.stringify(unifiedData, null, 2) + "\n";

  await withRegistryLock(filePath, async () => {
    await writeRegistryPayloadLocked(filePath, payload);
  });
}

/**
 * 在已持有注册表锁的上下文中直接原子落盘（供复合读改写流程使用，
 * 避免与 saveRegistry 的锁重入死等）；调用方必须已持有对应锁。
 */
export async function writeRegistryLocked(data: GlobalRegistryData, customHome?: string): Promise<void> {
  const filePath = getRegistryFilePath(customHome);
  ensureRegistryDir(filePath);
  const payload = JSON.stringify(buildUnifiedPayload(data), null, 2) + "\n";
  await writeRegistryPayloadLocked(filePath, payload);
}

/**
 * 原子落盘单次写入：临时文件写盘后 rename；文件名含进程号与自增序号，
 * 确保同一进程内多次保存也不会冲突。
 */
async function writeRegistryPayloadLocked(filePath: string, payload: string): Promise<void> {
  const tempPath = `${filePath}.${process.pid}.${++tmpFileSeq}.tmp`;
  await writeFile(tempPath, payload, "utf-8");
  await rename(tempPath, filePath);
}

function ensureRegistryDir(filePath: string): void {
  const dir = dirname(filePath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

export async function linkPackage(
  targetPath: string = process.cwd(),
  customHome?: string,
  options?: { recursive?: boolean }
): Promise<LinkResult> {
  const filePath = getRegistryFilePath(customHome);
  ensureRegistryDir(filePath);
  const absPath = resolve(targetPath);
  const directHasConfig = existsSync(join(absPath, "actiondock.json"));

  // 如果当前目录直接包含 actiondock.json 且未强制递归，按单包链接
  if (directHasConfig && !options?.recursive) {
    const config = loadProjectConfig(absPath);
    return await withRegistryLock(filePath, async () => {
      const registry = await loadRegistryAsync(customHome);
      const entry = buildLinkedPackageEntry(config, absPath, new Date().toISOString());

      registry.packages[config.id] = entry;
      await writeRegistryLocked(registry, customHome);

      return {
        id: config.id,
        name: entry.name,
        version: entry.version,
        path: absPath,
        linkedAt: entry.linkedAt,
        isWorkspace: false,
        entries: [entry],
      };
    });
  }

  // 尝试扫描子目录发现多个 ActionDock 子项目（Workspace 模式）；
  // 门槛以「发现子项目根目录」为准而非「配置可加载」，即使全部子项目配置损坏
  // 也仍注册 workspace（与旧版行为一致，避免边缘场景下静默落入父级回退分支）
  const discoveredRoots = discoverProjects(absPath);

  if (discoveredRoots.length > 0) {
    return await withRegistryLock(filePath, async () => {
      const registry = await loadRegistryAsync(customHome);
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
          const entry = buildLinkedPackageEntry(config, root, now, absPath);
          registry.packages[config.id] = entry;
          linkedEntries.push(entry);
        } catch {
          // 子项目配置损坏：跳过该子项目条目，不影响 workspace 注册本身
        }
      }

      await writeRegistryLocked(registry, customHome);

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
    });
  }

  // 回退检查：如果在子目录执行（例如在 package 的 actions/ 目录下），查找父级项目根目录
  const parentRoot = findProjectRoot(absPath);
  if (parentRoot) {
    const config = loadProjectConfig(parentRoot);
    return await withRegistryLock(filePath, async () => {
      const registry = await loadRegistryAsync(customHome);
      const entry = buildLinkedPackageEntry(config, parentRoot, new Date().toISOString());

      registry.packages[config.id] = entry;
      await writeRegistryLocked(registry, customHome);

      return {
        id: config.id,
        name: entry.name,
        version: entry.version,
        path: parentRoot,
        linkedAt: entry.linkedAt,
        isWorkspace: false,
        entries: [entry],
      };
    });
  }

  throw new Error(`Cannot link: actiondock.json not found in '${absPath}' or its subdirectories`);
}

export async function unlinkPackage(
  identifier: string = process.cwd(),
  customHome?: string
): Promise<UnlinkResult | null> {
  const filePath = getRegistryFilePath(customHome);
  ensureRegistryDir(filePath);

  return await withRegistryLock(filePath, async () => {
    const registry = await loadRegistryAsync(customHome);
    const absPath = resolve(identifier);

    // 检查是否匹配 Workspace 绝对路径
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
      await writeRegistryLocked(registry, customHome);
      return {
        type: "workspace",
        id: basename(absPath),
        path: absPath,
        packagesCount: removedCount,
        removedWorkspace: removedWs,
      };
    }

    // 检查是否匹配 Workspace 目录别名
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
          await writeRegistryLocked(registry, customHome);
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

    // 检查是否直接匹配 Package ID
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
    await writeRegistryLocked(registry, customHome);
    return {
      type: "package",
      id: removed.id,
      path: removed.path,
      packagesCount: 1,
      removedPackage: removed,
    };
  });
}

export function listLinkedPackages(customHome?: string): LinkedPackageEntry[] {
  const registry = loadRegistry(customHome);
  const result: Record<string, LinkedPackageEntry> = { ...registry.packages };

  // 动态扫描已挂载的 Workspace 目录，确保新拉取/新建的子包即时感知
  if (registry.workspaces) {
    for (const ws of Object.values(registry.workspaces)) {
      if (!existsSync(ws.path)) continue;
      for (const { root, config } of discoverProjectConfigs(ws.path)) {
        if (!result[config.id] || result[config.id].workspaceRoot === ws.path) {
          result[config.id] = buildLinkedPackageEntry(config, root, ws.linkedAt, ws.path);
        }
      }
    }
  }

  return Object.values(result);
}

export async function listLinkedPackagesAsync(customHome?: string): Promise<LinkedPackageEntry[]> {
  const registry = await loadRegistryAsync(customHome);
  const result: Record<string, LinkedPackageEntry> = { ...registry.packages };

  if (registry.workspaces) {
    for (const ws of Object.values(registry.workspaces)) {
      if (!(await pathExistsAsync(ws.path))) continue;
      for (const { root, config } of await discoverProjectConfigsAsync(ws.path)) {
        if (!result[config.id] || result[config.id].workspaceRoot === ws.path) {
          result[config.id] = buildLinkedPackageEntry(config, root, ws.linkedAt, ws.path);
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

export function resolveActionProjectSync(
  actionIdentifier: string,
  cwd: string = process.cwd(),
  customHome?: string
): ResolvedActionProject {
  return runFlowSync(
    resolveEntityFlow<true, ResolvedActionProject>({
      identifier: actionIdentifier,
      cwd,
      entityNoun: "Action",
      listLinkedPackages: () => listLinkedPackages(customHome),
      probe: (root, config, id) => probeActionSync(root, config, id) as true,
      buildResult: (projectRoot, packageId, actionId) => ({ projectRoot, packageId, actionId }),
    })
  );
}

export async function resolveActionProject(
  actionIdentifier: string,
  cwd: string = process.cwd(),
  customHome?: string
): Promise<ResolvedActionProject> {
  return runFlowAsync(
    resolveEntityFlow<true, ResolvedActionProject>({
      identifier: actionIdentifier,
      cwd,
      entityNoun: "Action",
      listLinkedPackages: () => listLinkedPackagesAsync(customHome) as any,
      probe: (root, config, id) => probeActionAsync(root, config, id) as any,
      buildResult: (projectRoot, packageId, actionId) => ({ projectRoot, packageId, actionId }),
    })
  );
}

export function resolvePlaybookProject(
  playbookIdentifier: string,
  cwd: string = process.cwd(),
  customHome?: string
): ResolvedPlaybookProject {
  return runFlowSync(
    resolveEntityFlow<import("../project/types").PlaybookDefinition, ResolvedPlaybookProject>({
      identifier: playbookIdentifier,
      cwd,
      entityNoun: "Playbook",
      listLinkedPackages: () => listLinkedPackages(customHome),
      probe: (root, config, id) => probePlaybook(root, config, id) as import("../project/types").PlaybookDefinition,
      buildResult: (projectRoot, packageId, playbookId, playbook) => ({
        projectRoot,
        packageId,
        playbookId,
        playbook,
      }),
    })
  );
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

  // 检查 packageIdOrPath 是否为磁盘上现存的目录或文件路径
  if (existsSync(resolvedPath)) {
    try {
      const info = statSync(resolvedPath);
      const targetDir = info.isDirectory() ? resolvedPath : dirname(resolvedPath);
      if (existsSync(join(targetDir, "actiondock.json"))) {
        return targetDir;
      }
      const parentRoot = findProjectRoot(targetDir);
      if (parentRoot) {
        return parentRoot;
      }
    } catch {
      // stat 失败（如并发删除）：忽略并继续走标识符解析路径
    }
  }

  // 显式路径形态但未解析成功的场景：
  // scoped package 标识符（如 @team/tools）虽含 '/' 但属于包 ID 而非文件路径
  const isScopedPackage = packageIdOrPath.startsWith("@");
  const isExplicitPath =
    !isScopedPackage &&
    (packageIdOrPath.startsWith(".") ||
      packageIdOrPath.startsWith("/") ||
      packageIdOrPath.startsWith("~") ||
      packageIdOrPath.includes("/") ||
      packageIdOrPath.includes("\\"));

  if (isExplicitPath) {
    // 显式路径不存在或不是 ActionDock 项目时必须失败，禁止静默回退
    return null;
  }

  // 检查当前项目（自 cwd 向上探测）
  const currentRoot = findProjectRoot(cwd);
  if (currentRoot) {
    try {
      const config = loadProjectConfig(currentRoot);
      if (config.id === packageIdOrPath || getPackageSlug(config.id) === packageIdOrPath) {
        return currentRoot;
      }
    } catch {
      // 当前项目配置损坏：忽略，继续注册表匹配
    }
  }

  // 检查注册表中的链接包
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

export function getRegistryStatus(customHome?: string): RegistryStatusReport {
  const registry = loadRegistry(customHome);
  const workspaces: RegistryTreeItem[] = [];
  const packages: RegistryTreeItem[] = [];
  let staleCount = 0;
  const seenPackageIds = new Set<string>();

  // 处理 Workspace：目录存活则动态扫描子项目，缺失则标记 stale
  if (registry.workspaces) {
    for (const wsPath of Object.keys(registry.workspaces)) {
      if (!existsSync(wsPath)) {
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

      const children: NonNullable<RegistryTreeItem["children"]> = [];
      for (const { root, config } of discoverProjectConfigs(wsPath)) {
        seenPackageIds.add(config.id);
        children.push({
          id: config.id,
          name: config.name || config.id,
          version: config.version || "0.0.0",
          path: root,
          status: "active",
        });
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

  // 处理独立包（不属于任何存活 Workspace 且未被动态扫描覆盖）
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
    }
    packages.push({
      type: "package",
      id: pkgEntry.id,
      name: pkgEntry.name,
      version: pkgEntry.version,
      path: pkgEntry.path,
      status: isPkgActive ? "active" : "stale",
    });
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

export async function pruneRegistry(customHome?: string): Promise<PruneResult> {
  const filePath = getRegistryFilePath(customHome);
  ensureRegistryDir(filePath);

  return await withRegistryLock(filePath, async () => {
    const registry = await loadRegistryAsync(customHome);
    const prunedWorkspaces: LinkedWorkspaceEntry[] = [];
    const prunedPackages: LinkedPackageEntry[] = [];

    // 清理目录已缺失的 Workspace 链接
    if (registry.workspaces) {
      for (const [wsPath, wsEntry] of Object.entries(registry.workspaces)) {
        if (!existsSync(wsPath)) {
          prunedWorkspaces.push(wsEntry);
          delete registry.workspaces[wsPath];
        }
      }
    }

    // 清理路径已缺失的 Package 链接
    for (const [pkgId, pkgEntry] of Object.entries(registry.packages)) {
      if (!existsSync(pkgEntry.path)) {
        prunedPackages.push(pkgEntry);
        delete registry.packages[pkgId];
      }
    }

    if (prunedWorkspaces.length > 0 || prunedPackages.length > 0) {
      await writeRegistryLocked(registry, customHome);
    }

    return {
      prunedPackages,
      prunedWorkspaces,
    };
  });
}

// 重新导出扫描辅助，保持既有从 registry 模块的导入路径可用
export { discoverProjects, IGNORED_SCAN_DIRS } from "./scan";
