import { resolveEnvValue } from "@actiondock/core";
import { fetchRemoteConfigEnv } from "@actiondock/core/profile";
import {
  isConfigTemplate,
  isSecretConfigKey,
} from "@actiondock/core/project";
import type { Command } from "commander";
import { renderConfigEnv, renderResult } from "../../renderer";
import type { CliContext, EnvCheckItem } from "../../types";
import { applyTargetOptions, getEffectiveOptions, requirePackageRoot, resolveTargetFromOptions } from "../../utils";
import { resolveRemoteConfigScope } from "./remote-helper";

/**
 * 注册 config env 子命令：诊断环境变量对声明配置的满足率。
 *
 * @param configCmd config 命令实例
 * @param context 命令行上下文
 */
export function registerConfigEnvCommand(configCmd: Command, context?: CliContext): void {
  applyTargetOptions(
    configCmd
      .command("env [identifier]")
      .description("Diagnose environment variable satisfaction for declared configuration")
      .option("-P, --package <id>", "Target package ID or path")
  )
    .option("--json", "Output as JSON")
    .action(async (identifier: string | undefined, rawOptions: any, cmd: any) => {
      const options = getEffectiveOptions(rawOptions, cmd);
      const targetPkg = identifier || options.package;

      // 远端服务分支直接查询远端配置环境诊断接口
      const target = resolveTargetFromOptions(options, context);

      if (target.type === "remote") {
        const scope = resolveRemoteConfigScope({ package: targetPkg });
        const res = await fetchRemoteConfigEnv(target.serverUrl!, target.token, scope.packageId, {
          allowInsecureHttp: Boolean(options.allowInsecureHttp),
          insecure: target.insecure,
        });
        renderResult(res, {
          json: options.json,
          humanFormatter: () => renderConfigEnv(res.envChecks || [], res.packageId),
          context,
        });
        const allSatisfied = (res.envChecks || []).every(
          (c: any) => !c.required || c.satisfied
        );
        if (!allSatisfied) {
          process.exitCode = 1;
        }
        return;
      }

      // 本地项目分支
      const { root, projConfig } = requirePackageRoot(targetPkg, {
        loadConfig: true,
        hint: "Usage: ad config env [package-id] or cd into a project directory.",
      });

      const declared = projConfig.config || {};
      const envChecks: EnvCheckItem[] = [];

      for (const [key, itemDef] of Object.entries(declared)) {
        // 通配模板项跳过环境诊断，不计入满足率统计
        if (isConfigTemplate(key)) {
          continue;
        }

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
        humanFormatter: () => renderConfigEnv(envChecks, projConfig.id),
        context,
      });

      if (!allSatisfied) {
        process.exitCode = 1;
      }
    });
}
