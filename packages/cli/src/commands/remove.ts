import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import {
  beginTransaction,
  findProjectRoot,
  getInstallCommand,
  loadLockfile,
  loadManifest,
  saveLockfile,
  saveManifest,
} from "@actiondock/core";
import { Command } from "commander";
import { ArgumentError, ExecutionError } from "../errors";
import { renderResult } from "../renderer";
import type { CliContext } from "../types";
import { getEffectiveOptions } from "../utils";

/**
 * 注册 ad remove 依赖移除命令。
 * 遵循规范：移除依赖并更新锁文件，保留该包的历史存储数据，检查反向引用防止误删。
 */
export function registerRemoveCommand(program: Command, context?: CliContext): void {
  program
    .command("remove <package>")
    .description("Remove an Action package dependency and update actiondock.lock.json")
    .option("-P, --package <path>", "Target project directory path")
    .option("--json", "Output as JSON")
    .option("--envelope", "Wrap JSON output in standard envelope")
    .action(async (packageIdentifier: string, rawOptions: any, cmd: any) => {
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

      // 寻址逻辑包标识
      let targetPackageId: string | null = null;
      let npmPackageName = packageIdentifier;

      if (manifest.dependencies?.[packageIdentifier]) {
        targetPackageId = packageIdentifier;
        npmPackageName = manifest.dependencies[packageIdentifier];
      } else if (manifest.dependencies) {
        for (const [id, spec] of Object.entries(manifest.dependencies)) {
          if (spec === packageIdentifier || id === packageIdentifier) {
            targetPackageId = id;
            npmPackageName = spec;
            break;
          }
        }
      }

      if (!targetPackageId) {
        throw new ArgumentError(
          `Package '${packageIdentifier}' is not a declared dependency in actiondock.json`
        );
      }

      // 检查当前工程中 Action 的反向 uses 依赖声明
      if (manifest.actions) {
        for (const [actionId, actionEntry] of Object.entries(manifest.actions)) {
          if (actionEntry.uses && Array.isArray(actionEntry.uses)) {
            const hasRef = actionEntry.uses.some(
              (u) =>
                u === targetPackageId ||
                u === `${targetPackageId}/*` ||
                u.startsWith(`${targetPackageId}/`)
            );
            if (hasRef) {
              throw new ExecutionError(
                `Cannot remove package '${targetPackageId}': action '${actionId}' declares dependency on it in 'uses'. Please remove the 'uses' declaration first.`,
                undefined,
                "DEPENDENCY_CONFLICT"
              );
            }
          }
        }
      }

      // 检查当前工程中 Playbook 的反向动作引用
      if (manifest.playbooks) {
        for (const [pbId, pbEntry] of Object.entries(manifest.playbooks)) {
          if (pbEntry.actions && Array.isArray(pbEntry.actions)) {
            const hasRef = pbEntry.actions.some(
              (a) =>
                a === targetPackageId ||
                a === `${targetPackageId}/*` ||
                a.startsWith(`${targetPackageId}/`)
            );
            if (hasRef) {
              throw new ExecutionError(
                `Cannot remove package '${targetPackageId}': playbook '${pbId}' references it in 'actions'. Please update the playbook first.`,
                undefined,
                "DEPENDENCY_CONFLICT"
              );
            }
          }
        }
      }

      // 获取排他锁与事务快照保护
      const tx = await beginTransaction(root, `ad remove ${packageIdentifier}`);

      try {
        // 从 actiondock.json 中移除依赖声明
        if (manifest.dependencies) {
          delete manifest.dependencies[targetPackageId];
          if (Object.keys(manifest.dependencies).length === 0) {
            delete manifest.dependencies;
          }
          saveManifest(root, manifest);
        }

        // 从 actiondock.lock.json 中移除锁定记录
        const lockfile = loadLockfile(root);
        if (lockfile && lockfile.packages[targetPackageId]) {
          delete lockfile.packages[targetPackageId];
          saveLockfile(root, lockfile);
        }

        // 调用包管理器执行卸载
        const installCmd = getInstallCommand(root);
        const pm = installCmd[0];
        const args = pm === "bun" ? ["remove", npmPackageName] : ["uninstall", npmPackageName, "--ignore-scripts"];

        spawnSync(pm, args, {
          cwd: root,
          stdio: "pipe",
          shell: process.platform === "win32",
        });

        // 提交事务
        await tx.commit();

        const resultPayload = {
          packageId: targetPackageId,
          npmPackage: npmPackageName,
          retainedNamespace: targetPackageId,
        };

        renderResult(resultPayload, {
          json: options.json,
          envelope: options.envelope,
          humanFormatter: () =>
            `Successfully removed '${resultPayload.packageId}'.\n[INFO] Retained configuration and state namespace for package '${resultPayload.packageId}'.`,
          context,
        });
      } catch (err: any) {
        await tx.rollback({ frozenInstall: false });
        throw new ExecutionError(err.message, err, err.code || "REMOVE_DEPENDENCY_FAILED");
      }
    });
}
