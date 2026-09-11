import {
  isSecretConfigKey,
  loadProjectConfig,
  resolvePackageRoot,
} from "@actiondock/core";
import type { Command } from "commander";
import type { ConfigItemDefinition } from "@actiondock/core";
import { ArgumentError } from "../../errors";
import { writeStdout } from "../../renderer";
import type { CliContext } from "../../types";
import { getEffectiveOptions, withTarget } from "../../utils";
import { resolveConfigValueInput } from "../../prompt";

/**
 * 注册 config set 子命令：写入配置值（支持标准输入与安全提示）。
 *
 * @param configCmd config 命令实例
 * @param context 命令行上下文
 */
export function registerConfigSetCommand(configCmd: Command, context?: CliContext): void {
  configCmd
    .command("set <key> [value]")
    .description("Set configuration value (supports stdin and secure prompt)")
    .option("-P, --package <id>", "Target package ID or path")
    .option("-g, --global", "Set in global configuration")
    .option("-p, --profile <name>", "Configure on a remote target")
    .option("-s, --server <url>", "Remote server URL")
    .option("-t, --token <token>", "Auth token for remote server")
    .option("--stdin", "Read value from standard input")
    .option("--data-dir <path>", "Custom database storage directory")
    .action(async (key: string, rawVal: string | undefined, rawOptions: any, cmd: any) => {
      const options = getEffectiveOptions(rawOptions, cmd);
      if (!key) {
        throw new ArgumentError("Configuration key is required");
      }

      let root: string | null = null;
      let projConfig: any = null;
      let declaredDef: ConfigItemDefinition | undefined;

      if (!options.global && !options.profile && !options.server) {
        root = resolvePackageRoot(options.package);
        if (root) {
          try {
            projConfig = loadProjectConfig(root);
            declaredDef = projConfig.config?.[key];
          } catch (err) {
            // 清单损坏时必须让错误可见：静默忽略会导致写入错误的作用域
            throw err;
          }
        }
      }

      const isSecret = isSecretConfigKey(key, declaredDef);

      let effectiveValueStr = rawVal;
      if (effectiveValueStr === undefined || options.stdin) {
        effectiveValueStr = await resolveConfigValueInput({
          promptText: `Enter value for '${key}'${isSecret ? " (secret)" : ""}: `,
          secret: isSecret,
          context,
          useStdin: Boolean(options.stdin),
        });
      }

      let parsedVal: unknown = effectiveValueStr;
      try {
        parsedVal = JSON.parse(effectiveValueStr);
      } catch {
        parsedVal = effectiveValueStr;
      }

      // 目标解析与写入（远端分支直接写远端作用域，本地分支按全局/项目作用域写入）
      await withTarget(options, context, async (target, resolved) => {
        if (resolved.type === "remote") {
          await target.setConfig(options.package || "", key, parsedVal as any);
          writeStdout(`[OK] Configuration '${key}' updated on remote server`, context);
          return;
        }

        if (options.global) {
          await target.setConfig("global", key, parsedVal as any);
          writeStdout(`[OK] Global configuration '${key}' updated`, context);
          return;
        }

        if (!root) {
          if (options.package) {
            throw new ArgumentError(`Package '${options.package}' not found in linked packages or path`);
          }
          await target.setConfig("global", key, parsedVal as any);
          writeStdout(`[OK] Global configuration '${key}' updated (no project in current directory)`, context);
          return;
        }

        await target.setConfig(projConfig.id, key, parsedVal as any);
        writeStdout(`[OK] Configuration '${key}' updated for package '${projConfig.id}'`, context);
      });
    });
}
