import { existsSync } from "node:fs";
import { loadProjectConfig } from "../project/loader";
import type { GlobalRegistryData, LinkedPackageEntry } from "./types";
import { buildLinkedPackageEntry, discoverProjects } from "./scan";
import {
  createPackageIdConflictError,
  isSameRealPath,
  safeRealPath,
} from "./package-conflict";

/**
 * 链接包有效性收集选项。
 */
export interface EffectiveLinkedPackagesOptions {
  /** 受限白名单过滤（仅收集和校验白名单范围内的包标识） */
  allowlist?: Set<string> | string[];
}

/**
 * 损坏的来源诊断元数据。
 */
export interface CorruptedSourceInfo {
  path: string;
  id?: string;
  workspaceRoot?: string;
  error: any;
}

/**
 * 链接包条目与诊断收集结果。
 */
export interface LinkedPackagesCollectionResult {
  packages: LinkedPackageEntry[];
  corrupted: CorruptedSourceInfo[];
  stale: LinkedPackageEntry[];
}

/**
 * 从已加载的注册表数据中提取有效链接包列表与损坏/陈旧诊断信息（内部共享唯一事实源）。
 *
 * 合并 registry.packages 与动态扫描的存活工作区子包：
 * - 动态扫描的存活工作区子包是唯一事实源；仍登记的存活工作区派生 packages 缓存跳过，杜绝改 ID / 切分支时的陈旧索引误报；
 * - 独立包在路径存在且配置合法时优先读取当前实际清单 ID，避免使用过时索引 ID 冒充当前身份；
 * - 损坏的清单不作为有效包身份进入集合，不触发身份冲突，但保留诊断记录供宿主与体检工具暴露；
 * - 支持按白名单提前过滤待检查来源，避免扫描未授权工作区子包与泄露未授权路径；
 * - 在合并前按底层真实目录执行唯一性检查：同 ID 同真实目录去重，不同物理路径抛 ActionDockError(PACKAGE_ID_CONFLICT)；
 * - 磁盘失效路径安全保留为陈旧条目，保证清理与体检诊断可用；但存活有效身份优先接纳，陈旧条目不阻碍有效条目。
 *
 * @param registry 注册表数据
 * @param options 可选白名单过滤配置
 */
export function collectLinkedPackageEntries(
  registry: GlobalRegistryData,
  options?: EffectiveLinkedPackagesOptions
): LinkedPackagesCollectionResult {
  const result = new Map<string, LinkedPackageEntry>();
  const corrupted: CorruptedSourceInfo[] = [];
  const stale: LinkedPackageEntry[] = [];

  const allowlistSet = options?.allowlist
    ? options.allowlist instanceof Set
      ? options.allowlist
      : new Set(options.allowlist)
    : null;

  // 预建真实路径 -> registry.packages 缓存条目的映射，供后续 O(1) 查缓存
  const cachedPackagesByPath = new Map<string, LinkedPackageEntry>();
  if (registry.packages) {
    for (const pkg of Object.values(registry.packages)) {
      if (pkg && pkg.path) {
        cachedPackagesByPath.set(safeRealPath(pkg.path), pkg);
      }
    }
  }

  // 1. 动态扫描已挂载的存活 Workspace 目录（动态扫描清单为第一真相）
  const activeWorkspaceRoots = new Set<string>();
  const workspaceClaimedPaths = new Set<string>();

  if (registry.workspaces) {
    for (const ws of Object.values(registry.workspaces)) {
      if (!existsSync(ws.path)) continue;
      activeWorkspaceRoots.add(safeRealPath(ws.path));

      const childRoots = discoverProjects(ws.path);
      for (const root of childRoots) {
        if (!existsSync(root)) continue;
        const realChildRoot = safeRealPath(root);
        workspaceClaimedPaths.add(realChildRoot);

        // O(1) 查找 registry.packages 中是否曾登记过该子路径的 ID
        const cachedEntry = cachedPackagesByPath.get(realChildRoot);
        const cachedId = cachedEntry?.id;

        try {
          const config = loadProjectConfig(root);
          if (allowlistSet && !allowlistSet.has(config.id)) continue;

          const candidate = buildLinkedPackageEntry(config, root, ws.linkedAt, ws.path);
          const existing = result.get(config.id);
          if (existing) {
            if (existsSync(existing.path)) {
              if (!isSameRealPath(existing.path, root)) {
                throw createPackageIdConflictError(existing, candidate);
              }
              result.set(config.id, candidate);
            } else {
              // 存活条目覆盖失效陈旧条目
              result.set(config.id, candidate);
            }
          } else {
            result.set(config.id, candidate);
          }
        } catch (err: any) {
          if (err?.code === "PACKAGE_ID_CONFLICT") {
            throw err;
          }
          // 清单损坏：不冒充有效身份，但保留为诊断失败记录
          if (allowlistSet) {
            if (cachedId && allowlistSet.has(cachedId)) {
              corrupted.push({
                path: root,
                id: cachedId,
                workspaceRoot: ws.path,
                error: err,
              });
            }
          } else {
            corrupted.push({
              path: root,
              id: cachedId,
              workspaceRoot: ws.path,
              error: err,
            });
          }
        }
      }
    }
  }

  // 2. 处理已登记的独立包（过滤工作区陈旧缓存，按实际清单获取最新身份）
  if (registry.packages) {
    for (const entry of Object.values(registry.packages)) {
      if (!entry || !entry.path) continue;

      const realEntryPath = safeRealPath(entry.path);
      // 若条目属于存活工作区，或其物理路径已被存活工作区动态扫描覆盖，属于过时派生缓存，跳过
      if (
        (entry.workspaceRoot && activeWorkspaceRoots.has(safeRealPath(entry.workspaceRoot))) ||
        workspaceClaimedPaths.has(realEntryPath)
      ) {
        continue;
      }

      // 路径不存在时保留为陈旧条目供体检诊断与清理
      if (!existsSync(entry.path)) {
        if (allowlistSet && !allowlistSet.has(entry.id)) continue;
        stale.push(entry);
        if (!result.has(entry.id)) {
          result.set(entry.id, entry);
        }
        continue;
      }

      // 路径存在时尝试加载最新清单
      let candidate: LinkedPackageEntry | null = null;
      try {
        const liveConfig = loadProjectConfig(entry.path);
        const effectiveId = liveConfig.id;
        const effectiveVersion = liveConfig.version || entry.version;
        const effectiveName = liveConfig.name || liveConfig.id;

        if (allowlistSet && !allowlistSet.has(effectiveId)) continue;

        candidate = {
          ...entry,
          id: effectiveId,
          name: effectiveName,
          version: effectiveVersion,
        };
      } catch (err: any) {
        if (err?.code === "PACKAGE_ID_CONFLICT") {
          throw err;
        }
        // 独立包清单损坏：记录为损坏诊断来源，不作为有效身份提供服务
        if (!allowlistSet || allowlistSet.has(entry.id)) {
          corrupted.push({
            path: entry.path,
            id: entry.id,
            workspaceRoot: entry.workspaceRoot,
            error: err,
          });
        }
        continue;
      }

      if (!candidate) continue;

      const existing = result.get(candidate.id);
      if (existing) {
        if (existsSync(existing.path)) {
          if (!isSameRealPath(existing.path, candidate.path)) {
            throw createPackageIdConflictError(existing, candidate);
          }
          result.set(candidate.id, candidate);
        } else {
          // 存活条目覆盖失效陈旧条目
          result.set(candidate.id, candidate);
        }
      } else {
        result.set(candidate.id, candidate);
      }
    }
  }

  return {
    packages: Array.from(result.values()),
    corrupted,
    stale,
  };
}

/**
 * 从已加载的注册表数据中提取有效链接包列表（内部共享唯一事实源）。
 *
 * @param registry 注册表数据
 * @param options 可选白名单过滤配置
 */
export function getEffectiveLinkedPackages(
  registry: GlobalRegistryData,
  options?: EffectiveLinkedPackagesOptions
): LinkedPackageEntry[] {
  return collectLinkedPackageEntries(registry, options).packages;
}
