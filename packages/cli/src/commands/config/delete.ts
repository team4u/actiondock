import {
  loadProjectConfig,
  resolvePackageRoot,
} from "@actiondock/core";
import type { Command } from "commander";
import { ArgumentError } from "../../errors";
import { writeStdout } from "../../renderer";
import type { CliContext } from "../../types";
import { getEffectiveOptions, withTarget } from "../../utils";

/**
 * 注册 config delete 子命令：删除配置项。
 *
 * @param configCmd config 命令实例
 * @param context 命令行上下文
 */
export function registerConfigDeleteCommand(configCmd: Command, context?: CliContext): void {
  configCmd
    .command("delete <key>")
    .alias("rm")
    .description("Delete configuration entry")
    .option("-P, --package <id>", "Target package ID or path")
    .option("-g, --global", "Delete from global configuration")
    .option("-p, --profile <name>", "Delete on a remote target")
    .option("-s, --server <url>", "Remote server URL")
    .option("-t, --token <token>", "Auth token for remote server")
    .option("--data-dir <path>", "Custom database storage directory")
    .action(async (key: string, rawOptions: any, cmd: any) => {
      const options = getEffectiveOptions(rawOptions, cmd);
      if (!key) {
        throw new ArgumentError("Configuration key is required");
      }

      const root = resolvePackageRoot(options.package);

      await withTarget(options, context, async (target, resolved) => {
        if (resolved.type === "remote") {
          await target.deleteConfig(options.package || "", key);
          writeStdout(`[OK] Configuration '${key}' deleted from remote server`, context);
          return;
        }

        if (options.global) {
          await target.deleteConfig("global", key);
          writeStdout(`[OK] Global configuration '${key}' deleted`, context);
          return;
        }

        if (!root) {
          if (options.package) {
            throw new ArgumentError(`Package '${options.package}' not found in linked packages or path`);
          }
          await target.deleteConfig("global", key);
          writeStdout(`[OK] Global configuration '${key}' deleted`, context);
          return;
        }

        const projConfig = loadProjectConfig(root);
        await target.deleteConfig(projConfig.id, key);
        writeStdout(`[OK] Configuration '${key}' deleted for package '${projConfig.id}'`, context);
      });
    });
}
