import {
  loadProjectConfig,
} from "@actiondock/core";
import {
  assertConcreteConfigKey,
} from "@actiondock/core/project";
import {
  resolvePackageRoot,
} from "@actiondock/core/registry";
import type { Command } from "commander";
import { ArgumentError, packageNotFoundError } from "../../errors";
import { formatSingleConfigDisplay, renderResult } from "../../renderer";
import { resolveMergedConfigEntry } from "../../services/config-merge";
import type { CliContext } from "../../types";
import {
  applyTargetOptions,
  getEffectiveOptions,
  resolveTargetFromOptions,
  withService,
} from "../../utils";
import { fetchRemoteConfigSafe } from "./remote-helper";

/**
 * 注册 config get 子命令：查询指定配置键的生效值。
 *
 * @param configCmd config 命令实例
 * @param context 命令行上下文
 */
export function registerConfigGetCommand(configCmd: Command, context?: CliContext): void {
  applyTargetOptions(
    configCmd
      .command("get <key>")
      .description("Get configuration value for key")
      .option("-P, --package <id>", "Target package ID or path")
      .option("-g, --global", "Get from global configuration")
  )
    .option("--data-dir <path>", "Custom database storage directory")
    .option("--json", "Output as JSON")
    .action(async (key: string, rawOptions: any, cmd: any) => {
      const options = getEffectiveOptions(rawOptions, cmd);
      if (!key) {
        throw new ArgumentError("Configuration key is required");
      }
      assertConcreteConfigKey(key);

      // 远端服务分支
      const target = resolveTargetFromOptions(options, context);

      if (target.type === "remote") {
        const { items } = await fetchRemoteConfigSafe(
          {
            serverUrl: target.serverUrl,
            token: target.token,
            insecure: target.insecure,
          },
          { ...options, key },
          context
        );

        const matchedItem = items.find((it) => it.key === key);
        const payload = matchedItem
          ? {
              key: matchedItem.key,
              value: matchedItem.value,
              source: matchedItem.source,
              secret: matchedItem.secret,
              configured: matchedItem.configured,
              redactedPaths: matchedItem.redactedPaths,
            }
          : {
              key,
              value: undefined,
              source: "remote",
              secret: false,
              configured: false,
              redactedPaths: [],
            };

        renderResult(payload, {
          json: options.json,
          humanFormatter: () => formatSingleConfigDisplay(payload),
          context,
        });
        return;
      }

      // 本地分支
      const root = resolvePackageRoot(options.package);

      await withService(
        options,
        context,
        async (service) => {
          if (options.global || !root) {
            if (!options.global && options.package && !root) {
              throw packageNotFoundError(options.package);
            }

            const confView = await service.management?.config.get("global", key);
            const payload = {
              key,
              value: confView?.value,
              source: confView?.source ?? "default",
              secret: Boolean(confView?.secret),
              configured: Boolean(confView?.configured),
              redactedPaths: confView?.redactedPaths ?? [],
            };

            renderResult(payload, {
              json: options.json,
              humanFormatter: () => formatSingleConfigDisplay(payload),
              context,
            });
            return;
          }

          const projConfig = loadProjectConfig(root);
          const declaredItem = projConfig.config?.[key];

          const merged = await resolveMergedConfigEntry(
            key,
            projConfig.id,
            declaredItem,
            service
          );

          const payload = {
            key,
            value: merged.value,
            source: merged.source,
            secret: merged.secret,
            configured: merged.configured,
            redactedPaths: merged.redactedPaths,
          };

          renderResult(payload, {
            json: options.json,
            humanFormatter: () => formatSingleConfigDisplay(payload),
            context,
          });
        },
        { localRoot: root || undefined }
      );
    });
}
