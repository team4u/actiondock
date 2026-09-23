import {
  isSecretConfigKey,
} from "@actiondock/core/project";
import {
  loadProjectConfig,
} from "@actiondock/core";
import {
  resolvePackageRoot,
} from "@actiondock/core/registry";
import type { Command } from "commander";
import type { ConfigItemDefinition } from "@actiondock/core/project";
import { ArgumentError, packageNotFoundError } from "../../errors";
import { writeStdout } from "../../renderer";
import type { CliContext } from "../../types";
import { applyTargetOptions, getEffectiveOptions, withService } from "../../utils";
import { resolveConfigValueInput } from "../../prompt";

/**
 * 注册 config set 子命令：写入配置值（支持标准输入与安全提示）。
 *
 * @param configCmd config 命令实例
 * @param context 命令行上下文
 */
export function registerConfigSetCommand(configCmd: Command, context?: CliContext): void {
  applyTargetOptions(
    configCmd
      .command("set <key> [value]")
      .description("Set configuration value (supports stdin and secure prompt)")
      .option("-P, --package <id>", "Target package ID or path")
      .option("-g, --global", "Set in global configuration")
  )
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
      await withService(options, context, async (service, resolved) => {
        if (resolved.type === "remote") {
          await service.management?.config.set(options.package || "", key, parsedVal as any);
          writeStdout(`[OK] Configuration '${key}' updated on remote server`, context);
          return;
        }

        if (options.global) {
          await service.management?.config.set("global", key, parsedVal as any);
          writeStdout(`[OK] Global configuration '${key}' updated`, context);
          return;
        }

        if (!root) {
          if (options.package) {
            throw packageNotFoundError(options.package);
          }
          await service.management?.config.set("global", key, parsedVal as any);
          writeStdout(`[OK] Global configuration '${key}' updated (no project in current directory)`, context);
          return;
        }

        await service.management?.config.set(projConfig.id, key, parsedVal as any);
        writeStdout(`[OK] Configuration '${key}' updated for package '${projConfig.id}'`, context);
      });
    });
}
