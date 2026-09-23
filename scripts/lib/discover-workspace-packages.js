/**
 * 工作区子包发现的单一事实源（Node 直接运行时实现）。
 *
 * 与 discover-workspace-packages.ts 类型声明保持同步（形态说明见该文件）。
 * 修改发现逻辑时必须同步修改两个文件。
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * 发现工作区内全部 @actiondock 前缀子包（按 packages/ 目录名排序）。
 */
export function discoverWorkspacePackages(rootDir, prefix = "@actiondock/") {
  const rootPkgPath = join(rootDir, "package.json");
  if (!existsSync(rootPkgPath)) {
    throw new Error(`Root package.json not found at ${rootPkgPath}`);
  }
  const rootPkg = JSON.parse(readFileSync(rootPkgPath, "utf-8"));
  const workspaces = Array.isArray(rootPkg.workspaces)
    ? rootPkg.workspaces
    : rootPkg.workspaces?.packages || ["packages/*"];

  const packages = [];
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
