import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { ActionRef } from "@actiondock/sdk";
import { parseActionRef } from "../../catalog/resolve-action";
import { findProjectRoot, loadProjectConfig } from "../../project/loader";
import { loadManifest } from "../../project/manifest";
import { getRegistryStatus, listLinkedPackages, resolvePackageRoot } from "../../registry/registry";
import type { DoctorCheck, DoctorCheckContext } from "../context";

/**
 * 按白名单过滤已链接包列表（白名单为空时保留全部）。
 */
function filterLinkedList(ctx: DoctorCheckContext) {
  let linkedList = listLinkedPackages(ctx.customHome);
  if (ctx.packageAllowlist && ctx.packageAllowlist.length > 0) {
    linkedList = linkedList.filter((pkg) => ctx.packageAllowlist!.includes(pkg.id));
  }
  return linkedList;
}

/**
 * 检查全局注册表健康度（链接数量与失效路径）。
 */
export const checkGlobalRegistry: DoctorCheck = {
  id: "registry.global",
  run: (ctx) => {
    try {
      const regStatus = getRegistryStatus(ctx.customHome);
      if (regStatus.staleCount > 0) {
        ctx.checks.push({
          id: "registry.global",
          category: "registry",
          name: "Global Registry",
          status: "warn",
          message: `${regStatus.totalPackagesCount} package(s), ${regStatus.workspaces.length} workspace(s), but ${regStatus.staleCount} stale path(s) detected`,
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
          fix: "Run 'npm install' in the affected package directories, or execute 'ad run' to auto-install",
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
      const linkedList = filterLinkedList(ctx);
      let packagesToCheck: Array<{ id: string; root: string }> = linkedList.map((p) => ({
        id: p.id,
        root: p.path,
      }));

      const curProjectRoot = ctx.packageIdOrPath
        ? resolvePackageRoot(ctx.packageIdOrPath, ctx.cwd, ctx.customHome) || findProjectRoot(ctx.packageIdOrPath)
        : findProjectRoot(ctx.cwd);
      if (curProjectRoot && !packagesToCheck.some((p) => p.root === curProjectRoot)) {
        try {
          const cfg = loadProjectConfig(curProjectRoot);
          packagesToCheck.push({ id: cfg.id, root: curProjectRoot });
        } catch (err: any) {
          // 当前工程配置损坏：无法纳入闭包检查范围，输出告警而非无声跳过
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
              const depRoot = resolvePackageRoot(parsed.packageId, pkg.root, ctx.customHome);
              if (!depRoot || !existsSync(depRoot)) {
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
      // 闭包检查整体失败：转为 error 检查项呈现在报告中，而非无声跳过
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
