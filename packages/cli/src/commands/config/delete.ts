import {
  loadProjectConfig,
} from "@actiondock/core";
import {
  resolvePackageRoot,
} from "@actiondock/core/registry";
import type { Command } from "commander";
import { ArgumentError, packageNotFoundError } from "../../errors";
import { writeStdout } from "../../renderer";
import type { CliContext } from "../../types";
import { applyTargetOptions, getEffectiveOptions, withService } from "../../utils";

/**
 * 注册 config delete 子命令：删除配置项。
 *
 * @param configCmd config 命令实例
 * @param context 命令行上下文
 */
export function registerConfigDeleteCommand(configCmd: Command, context?: CliContext): void {
  applyTargetOptions(
    configCmd
      .command("delete <key>")
      .alias("rm")
      .description("Delete configuration entry")
      .option("-P, --package <id>", "Target package ID or path")
      .option("-g, --global", "Delete from global configuration")
  )
    .option("--data-dir <path>", "Custom database storage directory")
    .action(async (key: string, rawOptions: any, cmd: any) => {
      const options = getEffectiveOptions(rawOptions, cmd);
      if (!key) {
        throw new ArgumentError("Configuration key is required");
      }

      const root = resolvePackageRoot(options.package);

      await withService(options, context, async (service, resolved) => {
        if (resolved.type === "remote") {
          await service.management?.config.delete(options.package || "", key);
          writeStdout(`[OK] Configuration '${key}' deleted from remote server`, context);
          return;
        }

        if (options.global) {
          await service.management?.config.delete("global", key);
          writeStdout(`[OK] Global configuration '${key}' deleted`, context);
          return;
        }

        if (!root) {
          if (options.package) {
            throw packageNotFoundError(options.package);
          }
          await service.management?.config.delete("global", key);
          writeStdout(`[OK] Global configuration '${key}' deleted`, context);
          return;
        }

        const projConfig = loadProjectConfig(root);
        await service.management?.config.delete(projConfig.id, key);
        writeStdout(`[OK] Configuration '${key}' deleted for package '${projConfig.id}'`, context);
      });
    });
}
