import {
  isSecretConfigKey,
} from "@actiondock/core/project";
import type { Command } from "commander";
import { notInProjectError } from "../../errors";
import { renderConfigSchema, renderResult, writeStdout } from "../../renderer";
import { buildMergedConfigEntries } from "../../services/config-merge";
import type { CliContext } from "../../types";
import { applyTargetOptions, getEffectiveOptions, requirePackageRoot, withService } from "../../utils";

/**
 * 注册 config schema 子命令：检查声明配置的解析状态。
 *
 * 状态推导复用 config-merge 的跨作用域合并视图单一事实源
 * （项目包级 > 全局持久化 > 环境变量 > 声明默认值）：
 * - source 命中 project、global 或 env 时状态为 SET；
 * - source 为 default（仅声明默认值兜底）时状态为 DEFAULT；
 * - 键无任何来源（不在合并视图中，即未声明默认值也未持久化）时状态为 MISSING。
 *
 * @param configCmd config 命令实例
 * @param context CLI 上下文
 */
export function registerConfigSchemaCommand(configCmd: Command, context?: CliContext): void {
  applyTargetOptions(
    configCmd
      .command("schema [identifier]")
      .alias("check")
      .description("Inspect declared configuration requirements and check resolution status")
      .option("-P, --package <id>", "Target package ID or path")
  )
    .option("--data-dir <path>", "Custom database storage directory")
    .option("--json", "Output as JSON")
    .action(async (identifier: string | undefined, rawOptions: any, cmd: any) => {
      const options = getEffectiveOptions(rawOptions, cmd);
      const targetPkg = identifier || options.package;
      const { root, projConfig } = requirePackageRoot(targetPkg, {
        loadConfig: true,
        hint: "Usage: ad config schema [package-id] or cd into a project directory.",
      });

      const declared = projConfig.config || {};

      // 远端目标显式拒绝：schema 状态推导依赖本地工程声明与环境变量解析，
      // 远端作用域无法获得等价视图，静默落到本地会误导调用方
      if (options.profile || options.server) {
        throw notInProjectError(
          "'ad config schema' only supports local projects. Remote targets are not supported for schema inspection."
        );
      }

      // 跨作用域合并视图单一事实源：与 config list 共享同一条优先级链
      await withService(
        options,
        context,
        async (service) => {
          const merged = await buildMergedConfigEntries(root, service, true);
          const mergedByKey = new Map(merged.map((entry) => [entry.key, entry]));

          const items = Object.keys(declared).map((key) => {
            const itemDef = declared[key];
            const isSecret = isSecretConfigKey(key, itemDef);
            const mergedEntry = mergedByKey.get(key);

            let source: "project" | "global" | "env" | "default" | "missing" = "missing";
            let status: "SET" | "DEFAULT" | "MISSING" = "MISSING";
            let resolvedValue: unknown;

            if (mergedEntry) {
              source = mergedEntry.source;
              resolvedValue = mergedEntry.value;
              // 合并视图的 default 来源仅是链尾兑底标签：
              // 真正的 DEFAULT 状态要求声明确实携带默认值，否则视为 MISSING
              if (mergedEntry.source !== "default") {
                status = "SET";
              } else if (itemDef.default !== undefined) {
                status = "DEFAULT";
              }
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

          if (options.json) {
            renderResult(result, {
              json: options.json,
              context,
            });
          } else {
            writeStdout(renderConfigSchema(items, projConfig.id, root) + "\n", context);
          }

          if (!ok) {
            process.exitCode = 1;
          }
        },
        { localRoot: root }
      );
    });
}
