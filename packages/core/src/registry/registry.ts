import { existsSync, mkdirSync, readFileSync, renameSync, statSync } from "node:fs";
import { readFile, rename, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve, sep } from "node:path";
import { findProjectRoot, loadProjectConfig } from "../project/loader";
import type { ProjectConfig } from "../project/types";
import { getActionDockHome, getPackageSlug } from "../utils";
import { ActionDockError, MANIFEST_NOT_FOUND, REGISTRY_CORRUPTED } from "../errors";
import { withRegistryLock } from "./lock";
import {
  createPackageIdConflictError,
  isSameRealPath,
  safeRealPath,
  type PackageLocationInfo,
} from "./package-conflict";
import { getEffectiveLinkedPackages } from "./linked-packages";
import {
  resolveDirectProjectPath,
  resolvePackageRootWithCandidates,
} from "./resolve-package";
import {
  buildLinkedPackageEntry,
  discoverProjectConfigs,
  discoverProjects,
} from "./scan";
import type {
  GlobalRegistryData,
  LinkedPackageEntry,
  LinkedWorkspaceEntry,
  LinkResult,
  PruneResult,
  RegistryStatusReport,
  RegistryTreeItem,
  UnlinkResult,
} from "./types";

/**
 * 空注册表初始结构。
 */
function emptyRegistry(): GlobalRegistryData {
  return { version: "2.0.0", packages: {}, workspaces: {} };
}

/**
 * 判定 entryPath 是否严格位于 baseDir 目录之内（携带路径分隔符边界）。
 * 避免裸 startsWith 前缀匹配把兄弟目录（如 /home/ws 与 /home/ws2）误判为子路径。
 */
function isPathWithin(entryPath: string, baseDir: string): boolean {
  return entryPath === baseDir || entryPath.startsWith(baseDir + sep);
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
    throw new ActionDockError(
      REGISTRY_CORRUPTED,
      `Registry file '${filePath}' is corrupted (invalid JSON: ${err.message}). ` +
        `The original data has been preserved as '${filePath}.corrupt' and can be restored manually. ` +
        `Fix or restore the file, or remove it to start with an empty registry.`
    );
  }

  if (!parsed || typeof parsed !== "object") {
    throw new ActionDockError(
      REGISTRY_CORRUPTED,
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
        } catch (err: any) {
          // 迁移时项目已损坏或配置非法：跳过该条 link 避免迁移整体失败，但必须输出告警，杜绝链接无声消失
          console.warn(
            `[Registry] Skipping corrupted package link during migration: '${link.path}' (${err?.message || String(err)})`
          );
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
 * 在已持有注册表锁的上下文中直接原子落盘（供复合读改写流程使用）；调用方必须已持有对应锁。
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

/**
 * 链接候选与已有有效链接条目排他性断言。
 * 使用常数复杂度 Map 登记并核对候选之间、候选与已有条目间的身份唯一性。
 */
function assertNoLinkConflicts(
  effective: LinkedPackageEntry[],
  candidates: PackageLocationInfo[]
): void {
  const map = new Map<string, PackageLocationInfo>();
  for (const item of effective) {
    if (item && item.id && item.path && existsSync(item.path)) {
      map.set(item.id, {
        id: item.id,
        path: item.path,
        workspaceRoot: item.workspaceRoot,
      });
    }
  }

  for (const candidate of candidates) {
    const existing = map.get(candidate.id);
    if (existing) {
      if (!isSameRealPath(existing.path, candidate.path)) {
        throw createPackageIdConflictError(existing, candidate);
      }
    } else {
      map.set(candidate.id, candidate);
    }
  }
}

/**
 * 在锁内同步独立包存储索引：
 * 基于完整旧快照先计算规范化有效记录，再一次性替换新索引；
 * 有效记录优先失效记录，不能顺序覆盖；
 * 工作区派生缓存不要恢复旧身份；
 * 冲突校验仍须先完成，再原子写盘。
 */
function syncRegistryPackagesIndexInLock(registry: GlobalRegistryData): void {
  if (!registry.packages) return;

  const oldEntries = Object.entries(registry.packages);
  const activeWorkspaceRoots = new Set<string>();
  if (registry.workspaces) {
    for (const ws of Object.values(registry.workspaces)) {
      if (ws && ws.path && existsSync(ws.path)) {
        activeWorkspaceRoots.add(safeRealPath(ws.path));
      }
    }
  }

  // 收集并规范化所有条目（分离存活有效记录与失效/损坏记录）
  const liveRecords: LinkedPackageEntry[] = [];
  const staleOrCorruptRecords: LinkedPackageEntry[] = [];

  for (const [key, entry] of oldEntries) {
    if (!entry || !entry.path) continue;

    // 工作区派生缓存：若属于存活工作区
    const isUnderActiveWorkspace = Boolean(
      (entry.workspaceRoot && activeWorkspaceRoots.has(safeRealPath(entry.workspaceRoot))) ||
      (entry.path && [...activeWorkspaceRoots].some((wsPath) => isPathWithin(entry.path, wsPath)))
    );

    if (isUnderActiveWorkspace) {
      // 工作区派生缓存不要恢复旧身份：
      // 如果子路径在磁盘上已不存在，或者配置损坏/改名，不作为独立陈旧记录保留
      if (!existsSync(entry.path)) {
        continue;
      }
      try {
        const live = loadProjectConfig(entry.path);
        liveRecords.push({
          ...entry,
          id: live.id,
          name: live.name || live.id,
          version: live.version || entry.version,
        });
      } catch {
        // 配置损坏时保留为诊断元数据，供白名单与受限诊断确认旧身份，不进入 liveRecords，
        // 全局收集依旧通过工作区动态扫描处理其有效性，不会恢复陈旧有效身份
        staleOrCorruptRecords.push(entry);
      }
      continue;
    }

    // 独立包处理
    if (existsSync(entry.path)) {
      try {
        const live = loadProjectConfig(entry.path);
        liveRecords.push({
          ...entry,
          id: live.id,
          name: live.name || live.id,
          version: live.version || entry.version,
        });
      } catch {
        // 清单损坏时保留原样供诊断
        staleOrCorruptRecords.push(entry);
      }
    } else {
      // 路径已不存在：陈旧记录
      staleOrCorruptRecords.push(entry);
    }
  }

  // 一次性构建新索引：有效记录优先失效记录，同物理真实路径去重
  const newPackages: Record<string, LinkedPackageEntry> = {};

  // 1. 先放入失效/损坏记录
  for (const entry of staleOrCorruptRecords) {
    newPackages[entry.id] = entry;
  }

  // 2. 存活有效记录优先覆盖（同一物理路径只保留最新的有效记录）
  const livePathToId = new Map<string, string>();
  for (const entry of liveRecords) {
    const realPath = safeRealPath(entry.path);
    newPackages[entry.id] = entry;
    livePathToId.set(realPath, entry.id);
  }

  // 3. 清理陈旧记录中指向已存活路径但键不是当前有效 ID 的多余别名
  for (const [key, entry] of Object.entries(newPackages)) {
    if (entry.path && existsSync(entry.path)) {
      const realPath = safeRealPath(entry.path);
      const currentEffectiveId = livePathToId.get(realPath);
      if (currentEffectiveId && key !== currentEffectiveId) {
        delete newPackages[key];
      }
    }
  }

  registry.packages = newPackages;
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
      // 冲突核对必须在修改数据结构前执行，排查失败时注册表保持完全不变
      const effective = getEffectiveLinkedPackages(registry);
      assertNoLinkConflicts(effective, [{ id: config.id, path: absPath }]);

      syncRegistryPackagesIndexInLock(registry);

      // 清理原先指向 absPath 的旧别名或旧登记键（避免重命名后残留旧别名索引）
      for (const [id, oldEntry] of Object.entries(registry.packages)) {
        if (oldEntry && oldEntry.path && isSameRealPath(oldEntry.path, absPath)) {
          delete registry.packages[id];
        }
      }

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
      const candidates: Array<{ config: ProjectConfig; root: string }> = [];
      for (const root of discoveredRoots) {
        try {
          const config = loadProjectConfig(root);
          candidates.push({ config, root });
        } catch (err: any) {
          // 子项目配置损坏：跳过该子项目条目不影响 workspace 注册本身，但必须输出告警含包路径，杜绝链接无声消失
          console.warn(
            `[Registry] Skipping corrupted workspace child package during link: '${root}' (${err?.message || String(err)})`
          );
        }
      }

      // 在锁内、写入前统一核对候选与已有链接包排他性（O(1) 查重，包含工作区内部重复 ID 拒绝）
      const effective = getEffectiveLinkedPackages(registry);
      assertNoLinkConflicts(
        effective,
        candidates.map((c) => ({ id: c.config.id, path: c.root, workspaceRoot: absPath }))
      );

      syncRegistryPackagesIndexInLock(registry);

      // 全部检查通过后才写入变更
      const now = new Date().toISOString();
      const wsEntry: LinkedWorkspaceEntry = {
        path: absPath,
        linkedAt: now,
      };

      registry.workspaces = registry.workspaces || {};
      registry.workspaces[absPath] = wsEntry;

      // 清理 absPath 下旧的子包键
      for (const [id, oldEntry] of Object.entries(registry.packages)) {
        if (
          oldEntry &&
          oldEntry.path &&
          (isPathWithin(oldEntry.path, absPath) || (oldEntry.workspaceRoot && isSameRealPath(oldEntry.workspaceRoot, absPath)))
        ) {
          delete registry.packages[id];
        }
      }

      const linkedEntries: LinkedPackageEntry[] = [];
      for (const { config, root } of candidates) {
        const entry = buildLinkedPackageEntry(config, root, now, absPath);
        registry.packages[config.id] = entry;
        linkedEntries.push(entry);
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
      const effective = getEffectiveLinkedPackages(registry);
      assertNoLinkConflicts(effective, [{ id: config.id, path: parentRoot }]);

      syncRegistryPackagesIndexInLock(registry);

      for (const [id, oldEntry] of Object.entries(registry.packages)) {
        if (oldEntry && oldEntry.path && isSameRealPath(oldEntry.path, parentRoot)) {
          delete registry.packages[id];
        }
      }

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

  throw new ActionDockError(
    MANIFEST_NOT_FOUND,
    `Cannot link: actiondock.json not found in '${absPath}' or its subdirectories`
  );
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

    // 检查是否匹配 Workspace 绝对路径或别名
    let matchedWsPath: string | undefined;
    if (registry.workspaces) {
      if (registry.workspaces[absPath]) {
        matchedWsPath = absPath;
      } else {
        for (const [wsPath] of Object.entries(registry.workspaces)) {
          if (basename(wsPath) === identifier || isSameRealPath(wsPath, absPath)) {
            matchedWsPath = wsPath;
            break;
          }
        }
      }
    }

    if (matchedWsPath && registry.workspaces) {
      const removedWs = registry.workspaces[matchedWsPath];
      delete registry.workspaces[matchedWsPath];

      let removedCount = 0;
      if (registry.packages) {
        for (const [id, entry] of Object.entries(registry.packages)) {
          if (
            isPathWithin(entry.path, matchedWsPath) ||
            entry.workspaceRoot === matchedWsPath ||
            (entry.workspaceRoot && isSameRealPath(entry.workspaceRoot, matchedWsPath))
          ) {
            delete registry.packages[id];
            removedCount++;
          }
        }
      }
      await writeRegistryLocked(registry, customHome);
      return {
        type: "workspace",
        id: basename(matchedWsPath),
        path: matchedWsPath,
        packagesCount: removedCount,
        removedWorkspace: removedWs,
      };
    }

    // 检查是否直接匹配 Package
    // 优先级：
    // 1. 精确物理路径匹配（直接命中已登记条目的真实物理路径）
    // 2. 当前存活项目的有效完整 ID（处理改名后通过新 ID 解除，优先于旧 key）
    // 3. 已登记的原始 ID 或 key（保留坏清单/失效来源通过旧 id 恢复/解除能力）
    // 4. 当前存活项目短名（slug）匹配
    // 5. 已登记条目短名（slug）匹配
    let targetEntry: LinkedPackageEntry | undefined;

    if (registry.packages) {
      // 1. 优先精确物理路径匹配
      for (const entry of Object.values(registry.packages)) {
        if (entry && entry.path && (entry.path === absPath || isSameRealPath(entry.path, absPath))) {
          if (existsSync(entry.path)) {
            try {
              const live = loadProjectConfig(entry.path);
              targetEntry = { ...entry, id: live.id, name: live.name || live.id, version: live.version || entry.version };
            } catch {
              targetEntry = entry;
            }
          } else {
            targetEntry = entry;
          }
          break;
        }
      }

      // 2. 匹配当前存活项目的有效完整 ID
      if (!targetEntry) {
        for (const entry of Object.values(registry.packages)) {
          if (entry && entry.path && existsSync(entry.path)) {
            try {
              const live = loadProjectConfig(entry.path);
              if (live.id === identifier) {
                targetEntry = {
                  ...entry,
                  id: live.id,
                  name: live.name || live.id,
                  version: live.version || entry.version,
                };
                break;
              }
            } catch {
              // 清单损坏忽略
            }
          }
        }
      }

      // 3. 匹配已登记的原始 ID 或 key（坏清单或失效来源）
      if (!targetEntry) {
        if (registry.packages[identifier]) {
          targetEntry = registry.packages[identifier];
        } else {
          for (const entry of Object.values(registry.packages)) {
            if (entry && entry.id === identifier) {
              targetEntry = entry;
              break;
            }
          }
        }
      }

      // 4. 匹配当前存活项目的短名（slug）
      if (!targetEntry) {
        for (const entry of Object.values(registry.packages)) {
          if (entry && entry.path && existsSync(entry.path)) {
            try {
              const live = loadProjectConfig(entry.path);
              if (getPackageSlug(live.id) === identifier) {
                targetEntry = {
                  ...entry,
                  id: live.id,
                  name: live.name || live.id,
                  version: live.version || entry.version,
                };
                break;
              }
            } catch {
              // 忽略
            }
          }
        }
      }

      // 5. 匹配已登记条目的短名（slug）
      if (!targetEntry) {
        for (const entry of Object.values(registry.packages)) {
          if (entry && getPackageSlug(entry.id) === identifier) {
            targetEntry = entry;
            break;
          }
        }
      }
    }

    if (!targetEntry) {
      return null;
    }

    const removedPath = targetEntry.path;
    const removedId = targetEntry.id;
    let removedCount = 0;

    // 清理所有指向该物理路径的旧条目与别名，彻底杜绝死灰复燃；删除只针对选定物理来源
    if (registry.packages) {
      for (const [key, entry] of Object.entries(registry.packages)) {
        if (entry && entry.path && (entry.path === removedPath || isSameRealPath(entry.path, removedPath))) {
          delete registry.packages[key];
          removedCount++;
        }
      }
    }

    await writeRegistryLocked(registry, customHome);
    return {
      type: "package",
      id: removedId,
      path: removedPath,
      packagesCount: removedCount,
      removedPackage: targetEntry,
    };
  });
}

export function listLinkedPackages(customHome?: string): LinkedPackageEntry[] {
  const registry = loadRegistry(customHome);
  return getEffectiveLinkedPackages(registry);
}

export function listLinkedWorkspaces(customHome?: string): LinkedWorkspaceEntry[] {
  const registry = loadRegistry(customHome);
  return Object.values(registry.workspaces || {});
}



export function resolvePackageRoot(
  packageIdOrPath?: string,
  cwd?: string,
  customHome?: string
): string | null {
  // 共享解析规则：若为无参数、现存物理路径或显式文件系统路径，直接早返回，跳过全局候选检索以隔离无关全局冲突
  const direct = resolveDirectProjectPath(packageIdOrPath, cwd);
  if (direct.resolved) {
    return direct.root;
  }

  const linkedList = listLinkedPackages(customHome);
  return resolvePackageRootWithCandidates(packageIdOrPath, cwd, linkedList);
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
