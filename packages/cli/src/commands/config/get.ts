import {
  fetchRemoteConfig,
  isSecretConfigKey,
  loadProjectConfig,
  maskSecretValue,
  resolvePackageRoot,
} from "@actiondock/core";
import type { Command } from "commander";
import { ArgumentError, packageNotFoundError } from "../../errors";
import { renderResult } from "../../renderer";
import { resolveMergedConfigEntry } from "../../services/config-merge";
import type { CliContext } from "../../types";
import {
  applyTargetOptions,
  getEffectiveOptions,
  resolveTargetFromOptions,
  withTarget,
} from "../../utils";

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
    .option("--reveal, --show-secrets", "Reveal plain text values for secrets")
    .option("--data-dir <path>", "Custom database storage directory")
    .option("--json", "Output as JSON")
    .action(async (key: string, rawOptions: any, cmd: any) => {
      const options = getEffectiveOptions(rawOptions, cmd);
      if (!key) {
        throw new ArgumentError("Configuration key is required");
      }
      const reveal = Boolean(options.reveal || options.showSecrets);

      // 远端服务分支不经过 Target 门面，直接查询远端配置接口
      const target = resolveTargetFromOptions(options, context);

      if (target.type === "remote") {
        const res = await fetchRemoteConfig(target.serverUrl!, target.token, options.package, {
          allowInsecureHttp: Boolean(options.allowInsecureHttp),
          insecure: target.insecure,
        });
        const val = res.values?.[key];
        const isSecret = isSecretConfigKey(key, res.declared?.[key]);
        const displayValue = !reveal && isSecret && val !== undefined ? maskSecretValue(val) : val;

        const payload = {
          key,
          value: displayValue,
          source: "remote",
          secret: isSecret,
        };

        renderResult(payload, {
          json: options.json,
          humanFormatter: () => (displayValue !== undefined ? String(displayValue) : ""),
          context,
        });
        return;
      }

      // 本地分支
      const root = resolvePackageRoot(options.package);

      await withTarget(options, context, async (localTarget) => {
        if (options.global || !root) {
          if (!options.global && options.package && !root) {
            throw packageNotFoundError(options.package);
          }

          const confView = await localTarget.getConfig("global", key);
          const val = confView?.value;
          const isSecret = confView?.secret ?? isSecretConfigKey(key);
          const displayValue = !reveal && isSecret && val !== undefined ? maskSecretValue(val) : val;

          const payload = {
            key,
            value: displayValue,
            source: "global",
            secret: isSecret,
          };

          renderResult(payload, {
            json: options.json,
            humanFormatter: () => (displayValue !== undefined ? String(displayValue) : ""),
            context,
          });
          return;
        }

        const projConfig = loadProjectConfig(root);
        const declaredItem = projConfig.config?.[key];

        // 合并优先级链单一事实源：项目包级 > 全局持久化 > 环境变量 > 声明默认值
        const { value: displayValue, source, secret: isSecret } = await resolveMergedConfigEntry(
          key,
          projConfig.id,
          declaredItem,
          localTarget,
          reveal
        );

        const payload = {
          key,
          value: displayValue,
          source,
          secret: isSecret,
        };

        renderResult(payload, {
          json: options.json,
          humanFormatter: () => (displayValue !== undefined ? String(displayValue) : ""),
          context,
        });
      });
    });
}
