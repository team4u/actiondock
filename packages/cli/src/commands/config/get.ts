import {
  fetchRemoteConfig,
  isSecretConfigKey,
  loadProjectConfig,
  maskSecretValue,
  resolveEnvValue,
  resolvePackageRoot,
  resolveTarget,
} from "@actiondock/core";
import type { Command } from "commander";
import type { ResolvedTarget } from "@actiondock/core";
import { ArgumentError } from "../../errors";
import { renderResult } from "../../renderer";
import type { CliContext } from "../../types";
import { getEffectiveOptions, withTarget } from "../../utils";

/**
 * 解析远端目标拓扑信息（仅信息解析，不创建 Target 实例）。
 */
function resolveRemoteTargetInfo(
  options: { profile?: string; server?: string; token?: string },
  context?: CliContext
): ResolvedTarget {
  return resolveTarget(
    {
      profile: options.profile,
      server: options.server,
      token: options.token,
    },
    context?.customHome
  );
}

/**
 * 注册 config get 子命令：查询指定配置键的生效值。
 *
 * @param configCmd config 命令实例
 * @param context 命令行上下文
 */
export function registerConfigGetCommand(configCmd: Command, context?: CliContext): void {
  configCmd
    .command("get <key>")
    .description("Get configuration value for key")
    .option("-P, --package <id>", "Target package ID or path")
    .option("-g, --global", "Get from global configuration")
    .option("-p, --profile <name>", "Query config on a remote target")
    .option("-s, --server <url>", "Remote server URL")
    .option("-t, --token <token>", "Auth token for remote server")
    .option("--reveal, --show-secrets", "Reveal plain text values for secrets")
    .option("--data-dir <path>", "Custom database storage directory")
    .option("--json", "Output as JSON")
    .option("--envelope", "Wrap JSON output in standard envelope")
    .action(async (key: string, rawOptions: any, cmd: any) => {
      const options = getEffectiveOptions(rawOptions, cmd);
      if (!key) {
        throw new ArgumentError("Configuration key is required");
      }
      const reveal = Boolean(options.reveal || options.showSecrets);

      // 远端服务分支不经过 Target 门面，直接查询远端配置接口
      const target = resolveRemoteTargetInfo(options, context);

      if (target.type === "remote") {
        const res = await fetchRemoteConfig(target.serverUrl!, target.token, options.package);
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
          envelope: options.envelope,
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
            throw new ArgumentError(`Package '${options.package}' not found in linked packages or path`);
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
            envelope: options.envelope,
            humanFormatter: () => (displayValue !== undefined ? String(displayValue) : ""),
            context,
          });
          return;
        }

        const projConfig = loadProjectConfig(root);
        const declaredItem = projConfig.config?.[key];
        const confView = await localTarget.getConfig(projConfig.id, key);

        let resolvedVal: unknown = confView?.value;
        let source: string = confView?.source === "package" ? "project" : (confView?.source || "default");
        const envResolved = resolveEnvValue(key, declaredItem, projConfig.id);

        if (confView && confView.configured) {
          resolvedVal = confView.value;
          source = confView.source === "package" ? "project" : confView.source;
        } else if (envResolved !== undefined) {
          resolvedVal = envResolved.value;
          source = "env";
        } else {
          resolvedVal = declaredItem?.default;
          source = "default";
        }

        const isSecret = confView?.secret ?? isSecretConfigKey(key, declaredItem);
        const displayValue = !reveal && isSecret && resolvedVal !== undefined ? maskSecretValue(resolvedVal) : resolvedVal;

        const payload = {
          key,
          value: displayValue,
          source,
          secret: isSecret,
        };

        renderResult(payload, {
          json: options.json,
          envelope: options.envelope,
          humanFormatter: () => (displayValue !== undefined ? String(displayValue) : ""),
          context,
        });
      });
    });
}
