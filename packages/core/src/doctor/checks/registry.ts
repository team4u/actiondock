import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { ActionRef } from "@actiondock/sdk";
import { parseActionRef } from "../../catalog/resolve-action";
import { PACKAGE_ID_CONFLICT } from "../../errors";
import { findProjectRoot, loadProjectConfig } from "../../project/loader";
import { loadManifest } from "../../project/manifest";
import {
  getRegistryStatus,
  listLinkedPackages,
  loadRegistry,
  resolvePackageRoot,
} from "../../registry/registry";
import {
  collectLinkedPackageEntries,
  getEffectiveLinkedPackages,
} from "../../registry/linked-packages";
import { resolvePackageRootWithCandidates } from "../../registry/resolve-package";
import {
  createPackageIdConflictError,
  isSameRealPath,
} from "../../registry/package-conflict";
import type { DoctorCheck, DoctorCheckContext } from "../context";

/**
 * 按白名单过滤已链接包列表（白名单模式使用受限已过滤集合，不吞没读取异常）。
 */
function filterLinkedList(ctx: DoctorCheckContext) {
  if (ctx.packageAllowlist && ctx.packageAllowlist.length > 0) {
    const reg = loadRegistry(ctx.customHome);
    return getEffectiveLinkedPackages(reg, { allowlist: ctx.packageAllowlist });
  }
  return listLinkedPackages(ctx.customHome);
}

/**
 * 检查全局注册表健康度（链接数量与失效路径）。
 */
export const checkGlobalRegistry: DoctorCheck = {
  id: "registry.global",
  run: (ctx) => {
    try {
      const reg = loadRegistry(ctx.customHome);
      const { corrupted, stale } = collectLinkedPackageEntries(reg, {
        allowlist: ctx.packageAllowlist,
      });

      if (corrupted.length > 0) {
        ctx.checks.push({
          id: "registry.global",
          category: "registry",
          name: "Global Registry",
          status: "error",
          message: `${corrupted.length} corrupted package manifest(s) detected in registered packages and workspaces: ${corrupted
            .map((c) => {
              const errDetail = c.error?.message || String(c.error);
              return c.id ? `${c.id} ('${c.path}': ${errDetail})` : `'${c.path}': ${errDetail}`;
            })
            .join(", ")}`,
          fix: "Correct the corrupted actiondock.json files or unlink the affected sources",
        });
        return;
      }

      const regStatus = getRegistryStatus(ctx.customHome);
      if (stale.length > 0 || regStatus.staleCount > 0) {
        const staleCount = Math.max(stale.length, regStatus.staleCount);
        ctx.checks.push({
          id: "registry.global",
          category: "registry",
          name: "Global Registry",
          status: "warn",
          message: `${regStatus.totalPackagesCount} package(s), ${regStatus.workspaces.length} workspace(s), but ${staleCount} stale path(s) detected`,
          fix: "Run 'ad unlink --prune' to clean up stale entries from registry",
        });
      } else {
        ctx.checks.push({
          id: "registry.global",
          category: "registry",
          name: "Global Registry",
          status: "ok",
          message: `${regStatus.totalPackagesCount} linked package(s), ${regStatus.workspaces.length} workspace(s) (0 stale)`,
        });
      }
    } catch (err: any) {
      ctx.checks.push({
        id: "registry.global",
        category: "registry",
        name: "Global Registry",
        status: "error",
        message: `Failed to read registry: ${err.message}`,
      });
    }
  },
};

/**
 * 检查全局注册表与当前工程中是否存在重复的包标识冲突（PACKAGE_ID_CONFLICT）。
 * 复用 getEffectiveLinkedPackages 规则完成工作区扫描与有效项判重；
 * 受限白名单模式下提前过滤，工程定位使用局部解析，杜绝泄漏未授权路径。
 */
export const checkRegistryDuplicates: DoctorCheck = {
  id: "registry.duplicates",
  run: (ctx) => {
    try {
      const reg = loadRegistry(ctx.customHome);
      const allowlist =
        ctx.packageAllowlist && ctx.packageAllowlist.length > 0
          ? ctx.packageAllowlist
          : undefined;

      // 1. 复用内部唯一事实源规则收集有效链接包（含存活工作区动态扫描及重复冲突检测）
      const effectiveLinked = getEffectiveLinkedPackages(reg, { allowlist });

      // 2. 当前工程：优先使用 locateProject 已解析的 projectRoot 或根据 cwd 向上探测
      const curProjectRoot = ctx.projectRoot || findProjectRoot(ctx.cwd);

      if (curProjectRoot && existsSync(curProjectRoot)) {
        try {
          const cfg = loadProjectConfig(curProjectRoot);
          const allowlistSet = allowlist ? new Set(allowlist) : null;
          if (!allowlistSet || allowlistSet.has(cfg.id)) {
            const matched = effectiveLinked.find((p) => p.id === cfg.id);
            if (matched && existsSync(matched.path) && !isSameRealPath(matched.path, curProjectRoot)) {
              throw createPackageIdConflictError(
                { id: matched.id, path: matched.path, workspaceRoot: matched.workspaceRoot },
                { id: cfg.id, path: curProjectRoot, isCurrentProject: true }
              );
            }
          }
        } catch (err: any) {
          if (err?.code === PACKAGE_ID_CONFLICT) {
            throw err;
          }
          // 当前工程配置损坏由其他检查报告
        }
      }

      ctx.checks.push({
        id: "registry.duplicates",
        category: "registry",
        name: "Package ID Duplicates",
        status: "ok",
        message: "No package ID conflicts detected in registered packages and workspaces",
      });
    } catch (err: any) {
      ctx.checks.push({
        id: "registry.duplicates",
        category: "registry",
        name: "Package ID Duplicates",
        status: "error",
        message: err.message,
        fix: err.hint,
      });
    }
  },
};

/**
 * 检查已链接包的依赖完整性（声明依赖但缺失 node_modules）。
 */
export const checkLinkedPackageDependencies: DoctorCheck = {
  id: "registry.dependencies",
  run: (ctx) => {
    try {
      const linkedList = filterLinkedList(ctx);
      const missingNodeModules: string[] = [];

      for (const pkg of linkedList) {
        if (!existsSync(pkg.path)) continue;
        const pkgJsonPath = join(pkg.path, "package.json");
        if (!existsSync(pkgJsonPath)) continue;
        try {
          const pkgJson = JSON.parse(readFileSync(pkgJsonPath, "utf-8"));
          const hasDeps =
            (pkgJson.dependencies && Object.keys(pkgJson.dependencies).length > 0) ||
            (pkgJson.devDependencies && Object.keys(pkgJson.devDependencies).length > 0);
          if (hasDeps && !existsSync(join(pkg.path, "node_modules"))) {
            missingNodeModules.push(pkg.id);
          }
        } catch (err: any) {
          // 单包 package.json 损坏：计入检查告警而非无声跳过，诊断工具必须暴露异常
          missingNodeModules.push(`${pkg.id} (unreadable package.json: ${err?.message || String(err)})`);
        }
      }

      if (missingNodeModules.length > 0) {
        ctx.checks.push({
          id: "registry.dependencies",
          category: "registry",
          name: "Linked Package Dependencies",
          status: "warn",
          message: `${missingNodeModules.length} linked package(s) declare dependencies but miss node_modules: ${missingNodeModules.join(", ")}`,
          fix: "Run 'npm install --omit=dev' in the affected package directories",
        });
      } else {
        ctx.checks.push({
          id: "registry.dependencies",
          category: "registry",
          name: "Linked Package Dependencies",
          status: "ok",
          message:
            linkedList.length > 0
              ? "All linked packages have dependencies installed"
              : "No linked packages requiring dependency verification",
        });
      }
    } catch (err: any) {
      // 依赖检查整体失败：转为 error 检查项呈现在报告中，而非无声跳过
      ctx.checks.push({
        id: "registry.dependencies",
        category: "registry",
        name: "Linked Package Dependencies",
        status: "error",
        message: `Failed to check linked package dependencies: ${err?.message || String(err)}`,
      });
    }
  },
};

/**
 * 检查清单 uses 声明的跨包依赖闭包可解析性。
 */
export const checkUsesClosure: DoctorCheck = {
  id: "registry.uses_closure",
  run: (ctx) => {
    try {
      // 至少 loadRegistry 每个 check 一次，后续引用定向收集复用此全局快照
      const reg = loadRegistry(ctx.customHome);

      const linkedList = ctx.packageAllowlist && ctx.packageAllowlist.length > 0
        ? getEffectiveLinkedPackages(reg, { allowlist: ctx.packageAllowlist })
        : getEffectiveLinkedPackages(reg);

      let packagesToCheck: Array<{ id: string; root: string }> = linkedList.map((p) => ({
        id: p.id,
        root: p.path,
      }));

      const curProjectRoot: string | null = ctx.projectRoot || findProjectRoot(ctx.cwd);
      if (curProjectRoot && !packagesToCheck.some((p) => p.root === curProjectRoot)) {
        try {
          const cfg = loadProjectConfig(curProjectRoot);
          packagesToCheck.push({ id: cfg.id, root: curProjectRoot });
        } catch (err: any) {
          console.warn(
            `[Doctor] Skipping corrupted current project in uses-closure check: '${curProjectRoot}' (${err?.message || String(err)})`
          );
        }
      }

      if (ctx.packageAllowlist && ctx.packageAllowlist.length > 0) {
        packagesToCheck = packagesToCheck.filter((p) => ctx.packageAllowlist!.includes(p.id));
      }

      const unresolvableUses: string[] = [];

      for (const pkg of packagesToCheck) {
        if (!existsSync(pkg.root)) continue;
        const manifest = loadManifest(pkg.root);
        if (!manifest || !manifest.actions) continue;

        for (const [actionId, actionEntry] of Object.entries(manifest.actions)) {
          if (!Array.isArray(actionEntry.uses)) continue;
          for (const rawRef of actionEntry.uses) {
            if (typeof rawRef !== "string" || !rawRef.trim()) continue;
            let parsed: ActionRef;
            try {
              parsed = parseActionRef(rawRef);
            } catch {
              unresolvableUses.push(`${pkg.id}/${actionId} -> '${rawRef}'`);
              continue;
            }

            if (parsed.packageId) {
              const depPackageId = parsed.packageId;
              let isAvailable = false;

              // 1. 检查是否为同包或本地相对路径
              try {
                const localResolved = resolvePackageRootWithCandidates(depPackageId, pkg.root, []);
                if (localResolved && existsSync(localResolved)) {
                  isAvailable = true;
                }
              } catch {
                // 忽略本地判定错误
              }

              // 2. 超出当前包：针对依赖完整 ID 定向收集
              if (!isAvailable) {
                try {
                  const depCollection = collectLinkedPackageEntries(reg, {
                    allowlist: [depPackageId],
                  });

                  if (depCollection.corrupted.length > 0) {
                    isAvailable = false;
                  } else {
                    const resolved = resolvePackageRootWithCandidates(
                      depPackageId,
                      pkg.root,
                      depCollection.packages
                    );
                    if (resolved && existsSync(resolved)) {
                      isAvailable = true;
                    }
                  }
                } catch {
                  // 未授权依赖冲突/损坏时输出受限结果，不能吞错返回 true 或泄漏未授权路径
                  isAvailable = false;
                }
              }

              if (!isAvailable) {
                unresolvableUses.push(`${pkg.id}/${actionId} -> '${rawRef}'`);
              }
            }
          }
        }
      }

      if (unresolvableUses.length > 0) {
        ctx.checks.push({
          id: "registry.uses_closure",
          category: "registry",
          name: "Cross-Package Uses Dependencies",
          status: "warn",
          message: `${unresolvableUses.length} unresolvable cross-package dependency reference(s) found in manifest uses: ${unresolvableUses.join(", ")}`,
          fix: "Link missing packages with 'ad link', or correct unresolvable uses declarations",
        });
      } else {
        ctx.checks.push({
          id: "registry.uses_closure",
          category: "registry",
          name: "Cross-Package Uses Dependencies",
          status: "ok",
          message: "All cross-package uses declarations in manifests resolved successfully",
        });
      }
    } catch (err: any) {
      ctx.checks.push({
        id: "registry.uses_closure",
        category: "registry",
        name: "Cross-Package Uses Dependencies",
        status: "error",
        message: `Failed to check cross-package uses dependencies: ${err?.message || String(err)}`,
      });
    }
  },
};
