/**
 * 工作区子包发现的单一事实源。
 *
 * 读取根 package.json 的 workspaces 声明并按 @actiondock 前缀过滤，
 * 替代 bump-version / publish / pack-smoke-test 三个脚本各自硬编码的
 * 子包清单，新增或更名子包时无需逐一同步。
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** 子包描述：包名与对应目录 */
export interface WorkspacePackage {
  name: string;
  /** 包目录短名（即 packages/ 下的目录名） */
  shortName: string;
  dir: string;
}

/**
 * 发现工作区内全部 @actiondock 前缀子包（按 packages/ 目录名排序）。
 *
 * @param rootDir 仓库根目录（默认取调用方显式传入值）
 * @param prefix 包名前缀过滤条件（默认 @actiondock/）
 */
export function discoverWorkspacePackages(
  rootDir: string,
  prefix = "@actiondock/"
): WorkspacePackage[] {
  const rootPkgPath = join(rootDir, "package.json");
  if (!existsSync(rootPkgPath)) {
    throw new Error(`Root package.json not found at ${rootPkgPath}`);
  }
  const rootPkg = JSON.parse(readFileSync(rootPkgPath, "utf-8"));
  const workspaces: string[] = Array.isArray(rootPkg.workspaces)
    ? rootPkg.workspaces
    : rootPkg.workspaces?.packages || ["packages/*"];

  const packages: WorkspacePackage[] = [];
  for (const pattern of workspaces) {
    if (!pattern.endsWith("/*")) {
      continue;
    }
    const baseDir = join(rootDir, pattern.slice(0, -2));
    if (!existsSync(baseDir)) {
      continue;
    }
    for (const entry of readdirSync(baseDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) {
        continue;
      }
      const pkgDir = join(baseDir, entry.name);
      const pkgJsonPath = join(pkgDir, "package.json");
      if (!existsSync(pkgJsonPath)) {
        continue;
      }
      const pkgJson = JSON.parse(readFileSync(pkgJsonPath, "utf-8"));
      if (pkgJson.name && pkgJson.name.startsWith(prefix)) {
        packages.push({
          name: pkgJson.name,
          shortName: entry.name,
          dir: pkgDir,
        });
      }
    }
  }

  packages.sort((a, b) => a.shortName.localeCompare(b.shortName));
  return packages;
}
