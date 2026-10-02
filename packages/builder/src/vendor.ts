import { copyFileSync, existsSync, lstatSync, mkdirSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import type { SelectionPlan } from "./types";

/**
 * 物化锁定生产依赖到产物 node_modules 目录（vendorDeps 开启时）。
 */
export function vendorDependencies(
  root: string,
  stagingDir: string,
  plan: SelectionPlan
): void {
  const destNodeModules = join(stagingDir, "node_modules");
  mkdirSync(destNodeModules, { recursive: true });

  // 尝试复制本地已解析的生产依赖
  const sourceCandidates = [
    join(root, "node_modules"),
    resolve(import.meta.dirname, "../../../node_modules"),
  ];

  // 嵌套 node_modules 不再跳过：多版本共存时传递依赖必须完整物化，
  // 否则产物运行时 Cannot find module 且构建阶段无任何警告；
  // 保留 .git、.bin 等目录排除（.bin 为平台相关的命令行 shim，不参与运行时模块解析）
  const copyVendorPackage = (srcDir: string, destDir: string): void => {
    if (!existsSync(srcDir)) return;
    mkdirSync(destDir, { recursive: true });
    const entries = readdirSync(srcDir);
    for (const entry of entries) {
      if (
        entry === ".git" ||
        entry === ".actiondock" ||
        entry === ".bin" ||
        entry === "test" ||
        entry === "tests"
      ) {
        continue;
      }
      const srcPath = join(srcDir, entry);
      const destPath = join(destDir, entry);
      try {
        const stat = lstatSync(srcPath);
        if (stat.isSymbolicLink()) {
          // 软链接不进行递归物理穿越，避免链接环路死锁
          continue;
        }
        if (stat.isDirectory()) {
          copyVendorPackage(srcPath, destPath);
        } else if (stat.isFile()) {
          copyFileSync(srcPath, destPath);
        }
      } catch (err) {
        // 防御与透明：记录系统读取异常日志
        console.warn(
          `[actiondock] Warning: Failed to vendor file ${srcPath}: ${err instanceof Error ? err.message : String(err)}`
        );
      }
    }
  };

  for (const dep of plan.dependencies.external) {
    if (dep.isDev) continue;
    for (const baseModules of sourceCandidates) {
      const srcDep = join(baseModules, dep.name);
      if (existsSync(srcDep)) {
        const targetDep = join(destNodeModules, dep.name);
        mkdirSync(dirname(targetDep), { recursive: true });
        copyVendorPackage(srcDep, targetDep);
        break;
      }
    }
  }

  // 复制 ActionDock 内部依赖
  for (const internalPkg of ["@actiondock/core", "@actiondock/sdk"]) {
    for (const baseModules of sourceCandidates) {
      const srcDep = join(baseModules, internalPkg);
      if (existsSync(srcDep)) {
        const targetDep = join(destNodeModules, internalPkg);
        mkdirSync(dirname(targetDep), { recursive: true });
        copyVendorPackage(srcDep, targetDep);
        break;
      }
    }
  }
}
