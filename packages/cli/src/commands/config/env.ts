import {
  fetchRemoteConfigEnv,
  isSecretConfigKey,
  loadProjectConfig,
  resolveEnvValue,
  resolvePackageRoot,
  resolveTarget,
} from "@actiondock/core";
import type { Command } from "commander";
import { ArgumentError } from "../../errors";
import { renderConfigEnv, renderResult } from "../../renderer";
import type { CliContext, EnvCheckItem } from "../../types";
import { getEffectiveOptions } from "../../utils";

/**
 * 注册 config env 子命令：诊断环境变量对声明配置的满足率。
 *
 * @param configCmd config 命令实例
 * @param context 命令行上下文
 */
export function registerConfigEnvCommand(configCmd: Command, context?: CliContext): void {
  configCmd
    .command("env [identifier]")
    .description("Diagnose environment variable satisfaction for declared configuration")
    .option("-P, --package <id>", "Target package ID or path")
    .option("-p, --profile <name>", "Query on a remote target")
    .option("-s, --server <url>", "Remote server URL")
    .option("-t, --token <token>", "Auth token for remote server")
    .option("--json", "Output as JSON")
    .option("--envelope", "Wrap JSON output in standard envelope")
    .action(async (identifier: string | undefined, rawOptions: any, cmd: any) => {
      const options = getEffectiveOptions(rawOptions, cmd);
      const targetPkg = identifier || options.package;

      // 远端服务分支直接查询远端配置环境诊断接口
      const target = resolveTarget(
        {
          profile: options.profile,
          server: options.server,
          token: options.token,
        },
        context?.customHome
      );

      if (target.type === "remote") {
        const res = await fetchRemoteConfigEnv(target.serverUrl!, target.token, targetPkg);
        renderResult(res, {
          json: options.json,
          envelope: options.envelope,
          humanFormatter: () => renderConfigEnv(res.envChecks || [], res.packageId),
          context,
        });
        return;
      }

      // 本地项目分支
      const root = resolvePackageRoot(targetPkg);
      if (!root) {
        if (targetPkg) {
          throw new ArgumentError(`Package '${targetPkg}' not found in linked packages or path`);
        }
        throw new ArgumentError(
          "Not in an ActionDock project.\nUsage: ad config env [package-id] or cd into a project directory."
        );
      }

      const projConfig = loadProjectConfig(root);
      const declared = projConfig.config || {};
      const envChecks: EnvCheckItem[] = [];

      for (const [key, itemDef] of Object.entries(declared)) {
        const resolved = resolveEnvValue(key, itemDef, projConfig.id);
        const hasDefault = itemDef.default !== undefined;
        const satisfied = resolved !== undefined || hasDefault;
        envChecks.push({
          key,
          required: Boolean(itemDef.required),
          satisfied,
          matchedEnv: resolved ? resolved.matchedKey : null,
          hasDefault,
          secret: isSecretConfigKey(key, itemDef),
        });
      }

      const allSatisfied = envChecks.every((c) => !c.required || c.satisfied);
      const payload = {
        packageId: projConfig.id,
        projectRoot: root,
        ok: allSatisfied,
        envChecks,
      };

      renderResult(payload, {
        json: options.json,
        envelope: options.envelope,
        humanFormatter: () => renderConfigEnv(envChecks, projConfig.id),
        context,
      });

      if (!allSatisfied) {
        process.exitCode = 1;
      }
    });
}
