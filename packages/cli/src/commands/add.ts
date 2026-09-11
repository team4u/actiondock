import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  ActionPackageResolver,
  beginTransaction,
  computeManifestDigest,
  findProjectRoot,
  getInstallCommand,
  loadLockfile,
  loadManifest,
  MANIFEST_FILE_NAME,
  parseJsonWithoutDuplicates,
  saveLockfile,
  saveManifest,
  type ActionDockLockfile,
  type ActionDockManifest,
} from "@actiondock/core";
import { Command } from "commander";
import { ArgumentError, ExecutionError } from "../errors";
import { renderResult } from "../renderer";
import type { CliContext } from "../types";
import { getEffectiveOptions, spawnAsync } from "../utils";

/**
 * 从安装说明符中提取基础 npm 包名（去除版本号及前缀范围）。
 */
function extractNpmPackageName(spec: string): string {
  const clean = spec.trim();
  if (clean.startsWith("@")) {
    const slashIdx = clean.indexOf("/");
    if (slashIdx !== -1) {
      const atIdx = clean.indexOf("@", slashIdx + 1);
      return atIdx !== -1 ? clean.slice(0, atIdx) : clean;
    }
  } else {
    const atIdx = clean.indexOf("@");
    return atIdx !== -1 ? clean.slice(0, atIdx) : clean;
  }
  return clean;
}

/**
 * 注册 ad add 依赖安装命令。
 * 遵循规范：安装并锁定依赖，更新 package.json、actiondock.json 与 actiondock.lock.json，执行原子事务快照保护。
 */
export function registerAddCommand(program: Command, context?: CliContext): void {
  program
    .command("add <package>")
    .description("Install and lock an Action package dependency into current project")
    .option("--allow-install-scripts", "Explicitly allow lifecycle install scripts from third-party packages")
    .option("-D, --dev", "Install package as development dependency")
    .option("-P, --package <path>", "Target project directory path")
    .option("--json", "Output as JSON")
    .option("--envelope", "Wrap JSON output in standard envelope")
    .action(async (packageSpec: string, rawOptions: any, cmd: any) => {
      const options = getEffectiveOptions(rawOptions, cmd);
      const root = options.package ? resolve(options.package) : findProjectRoot();

      if (!root) {
        throw new ArgumentError(
          "Not in an ActionDock project (actiondock.json not found).\nPlease specify -P, --package <path> or cd into a project directory."
        );
      }

      const manifest = loadManifest(root);
      if (!manifest) {
        throw new ArgumentError(`actiondock.json not found in ${root}`);
      }

      const npmPackageName = extractNpmPackageName(packageSpec);

      // 获取排他修改锁并创建事务快照
      const tx = await beginTransaction(root, `ad add ${packageSpec}`);

      try {
        // 调用包管理器执行安装（默认禁用生命周期安装脚本）
        const installCmd = getInstallCommand(root);
        const pm = installCmd[0];
        const args: string[] = [];

        if (pm === "bun") {
          args.push("add", packageSpec);
          if (options.dev) {
            args.push("--dev");
          }
          if (!options.allowInstallScripts) {
            args.push("--ignore-scripts");
          }
        } else {
          args.push("install", packageSpec);
          if (options.dev) {
            args.push("--save-dev");
          }
          if (!options.allowInstallScripts) {
            args.push("--ignore-scripts");
          }
        }

        const installProc = await spawnAsync(pm, args, {
          cwd: root,
          stdio: "pipe",
        });

        if (installProc.status !== 0) {
          const errMsg = installProc.stderr?.toString() || installProc.stdout?.toString() || "Unknown error";
          throw new Error(`Failed to install '${packageSpec}' using ${pm}: ${errMsg}`);
        }

        // 寻址已安装包的 actiondock.json 清单
        let targetManifestPath = join(root, "node_modules", npmPackageName, MANIFEST_FILE_NAME);
        if (!existsSync(targetManifestPath)) {
          targetManifestPath = join(root, "node_modules", packageSpec, MANIFEST_FILE_NAME);
        }

        if (!existsSync(targetManifestPath)) {
          throw new Error(
            `Target package '${npmPackageName}' does not contain '${MANIFEST_FILE_NAME}'. It is not a valid ActionDock package.`
          );
        }

        const targetRaw = readFileSync(targetManifestPath, "utf-8");
        const targetManifest = parseJsonWithoutDuplicates<ActionDockManifest>(targetRaw);
        const targetDigest = computeManifestDigest(targetManifest);
        const targetPackageId = targetManifest.id;
        const targetVersion = targetManifest.version || "0.1.0";

        // 更新 actiondock.json.dependencies 映射
        manifest.dependencies = manifest.dependencies || {};
        manifest.dependencies[targetPackageId] =
          targetPackageId === npmPackageName ? `^${targetVersion}` : npmPackageName;

        // 触发依赖图解析及版本冲突检测
        const resolver = new ActionPackageResolver({ projectRoot: root, manifest });
        const graph = resolver.resolveSync();

        // 更新 actiondock.lock.json
        const lockfile: ActionDockLockfile = loadLockfile(root) || {
          lockfileVersion: 1,
          packages: {},
        };

        for (const pkg of graph.packages.values()) {
          if (!pkg.isRoot) {
            lockfile.packages[pkg.packageId] = {
              package: pkg.npmPackage,
              resolved: pkg.version,
              source: "npm",
              packageId: pkg.packageId,
              npmPackage: pkg.npmPackage,
              version: pkg.version,
              manifestDigest: pkg.manifestDigest,
              dependencies: pkg.manifest.dependencies || {},
            };
          }
        }

        // 写入清单与锁文件
        saveManifest(root, manifest);
        saveLockfile(root, lockfile);

        // 提交事务
        await tx.commit();

        const resultPayload = {
          packageId: targetPackageId,
          npmPackage: npmPackageName,
          version: targetVersion,
          manifestDigest: targetDigest,
        };

        renderResult(resultPayload, {
          json: options.json,
          envelope: options.envelope,
          humanFormatter: () =>
            `Successfully added and locked '${resultPayload.packageId}' (v${resultPayload.version}) from ${resultPayload.npmPackage}.`,
          context,
        });
      } catch (err: any) {
        await tx.rollback({ frozenInstall: false });
        throw new ExecutionError(err.message, err, err.code || "ADD_DEPENDENCY_FAILED");
      }
    });
}
