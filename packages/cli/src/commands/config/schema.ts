import {
  createActionDockTarget,
  isSecretConfigKey,
  loadProjectConfig,
  resolveEnvValue,
  resolvePackageRoot,
} from "@actiondock/core";
import type { Command } from "commander";
import { ArgumentError, ExecutionError } from "../../errors";
import { renderConfigSchema, renderResult, writeStdout } from "../../renderer";
import type { CliContext } from "../../types";
import { getEffectiveOptions } from "../../utils";

/**
 * 注册 config schema 子命令：检查声明配置的解析状态。
 *
 * @param configCmd config 命令实例
 * @param context 命令行上下文
 */
export function registerConfigSchemaCommand(configCmd: Command, context?: CliContext): void {
  configCmd
    .command("schema [identifier]")
    .alias("check")
    .description("Inspect declared configuration requirements and check resolution status")
    .option("-P, --package <id>", "Target package ID or path")
    .option("--data-dir <path>", "Custom database storage directory")
    .option("--json", "Output as JSON")
    .option("--envelope", "Wrap JSON output in standard envelope")
    .action(async (identifier: string | undefined, rawOptions: any, cmd: any) => {
      try {
        const options = getEffectiveOptions(rawOptions, cmd);
        const targetPkg = identifier || options.package;
        const root = resolvePackageRoot(targetPkg);
        if (!root) {
          if (targetPkg) {
            throw new ArgumentError(
              `Package '${targetPkg}' not found in linked packages or path`
            );
          }
          throw new ArgumentError(
            "Not in an ActionDock project.\nUsage: ad config schema [package-id] or cd into a project directory."
          );
        }

        const projConfig = loadProjectConfig(root);
        const declared = projConfig.config || {};
        const declaredKeys = Object.keys(declared);

        const target = await createActionDockTarget({
          type: "local",
          projectRoot: root,
          customHome: context?.customHome,
          dataDir: options.dataDir || context?.dataDir,
        });

        let globalConfig: import("@actiondock/core").ConfigValueView[] = [];
        let projectConfig: import("@actiondock/core").ConfigValueView[] = [];
        try {
          globalConfig = await target.listConfig("global");
          projectConfig = await target.listConfig(projConfig.id);
        } finally {
          await target.close();
        }

        const projectConfigMap = new Map(projectConfig.map((c) => [c.key, c]));
        const globalConfigMap = new Map(globalConfig.map((c) => [c.key, c]));

        const items = declaredKeys.map((key) => {
          const itemDef = declared[key];
          const isSecret = isSecretConfigKey(key, itemDef);

          let resolvedValue: unknown;
          let source: "project" | "global" | "env" | "default" | "missing" = "missing";
          let status: "SET" | "DEFAULT" | "MISSING" = "MISSING";
          const envResolved = resolveEnvValue(key, itemDef, projConfig.id);

          const projItem = projectConfigMap.get(key);
          const globItem = globalConfigMap.get(key);

          if (projItem && projItem.configured && projItem.source === "package") {
            resolvedValue = projItem.value;
            source = "project";
            status = "SET";
          } else if (globItem && globItem.configured) {
            resolvedValue = globItem.value;
            source = "global";
            status = "SET";
          } else if (envResolved !== undefined) {
            resolvedValue = envResolved.value;
            source = "env";
            status = "SET";
          } else if (itemDef.default !== undefined) {
            resolvedValue = itemDef.default;
            source = "default";
            status = "DEFAULT";
          }

          return {
            key,
            required: Boolean(itemDef.required),
            secret: isSecret,
            status,
            source,
            description: itemDef.description || "",
            defaultValue: itemDef.default,
            hasValue: resolvedValue !== undefined,
          };
        });

        const missingRequired = items.filter((i) => i.required && i.status === "MISSING");
        const ok = missingRequired.length === 0;

        const result = {
          packageId: projConfig.id,
          projectRoot: root,
          ok,
          missingCount: missingRequired.length,
          configs: items,
        };

        if (options.json || options.envelope) {
          renderResult(result, {
            json: options.json,
            envelope: options.envelope,
            context,
          });
        } else {
          writeStdout(renderConfigSchema(items, projConfig.id, root) + "\n", context);
        }

        if (!ok) {
          process.exitCode = 1;
        }
      } catch (err: any) {
        if (err instanceof ArgumentError || err instanceof ExecutionError) {
          throw err;
        }
        throw new ExecutionError(err.message);
      }
    });
}
