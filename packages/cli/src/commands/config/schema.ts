import {
  isConfigTemplate,
  isSecretConfigKey,
  redactConfigValue,
  resolveConfigDeclaration,
} from "@actiondock/core/project";
import type { Command } from "commander";
import { notInProjectError } from "../../errors";
import { renderConfigSchema, renderResult } from "../../renderer";
import { buildMergedConfigEntries } from "../../services/config-merge";
import type { CliContext } from "../../types";
import { applyTargetOptions, getEffectiveOptions, requirePackageRoot, withService } from "../../utils";

/**
 * 注册 config schema 子命令：检查声明配置的解析状态。
 *
 * 状态推导复用跨作用域合并视图：
 * - 模板通配声明单独展示状态 TEMPLATE，并统计已存储匹配具体键数量，不参与 missing 统计；
 * - 非模板项以 configured 显式来源判定为 SET；
 * - 携带声明默认值时判定为 DEFAULT，且对外安全视图中敏感 defaultValue 严格脱敏；
 * - 其余缺失项判定为 MISSING。
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

      // 远端目标显式拒绝
      if (options.profile || options.server) {
        throw notInProjectError(
          "'ad config schema' only supports local projects. Remote targets are not supported for schema inspection."
        );
      }

      await withService(
        options,
        context,
        async (service) => {
          const merged = await buildMergedConfigEntries(root, service, false);
          const mergedByKey = new Map(merged.map((entry) => [entry.key, entry]));

          const projectConfigList = (await service.management?.config.list(projConfig.id)) ?? [];
          const globalConfigList = (await service.management?.config.list("global")) ?? [];
          const allStoredKeys = new Set([
            ...projectConfigList.filter((c) => c.configured).map((c) => c.key),
            ...globalConfigList.filter((c) => c.configured).map((c) => c.key),
          ]);

          const items = Object.keys(declared).map((key) => {
            const itemDef = declared[key];
            const isSecret = isSecretConfigKey(key, itemDef);

            if (isConfigTemplate(key)) {
              let matchCount = 0;
              for (const storedKey of allStoredKeys) {
                const resolved = resolveConfigDeclaration(declared, storedKey);
                if (resolved?.template === key) {
                  matchCount++;
                }
              }

              return {
                key,
                required: false,
                secret: isSecret,
                status: "TEMPLATE",
                source: "template",
                description: itemDef.description || "",
                matchCount,
              };
            }

            const mergedEntry = mergedByKey.get(key);
            const isConfigured = Boolean(mergedEntry?.configured);

            let source: "project" | "global" | "env" | "default" | "missing" = "missing";
            let status: "SET" | "DEFAULT" | "MISSING" = "MISSING";

            if (isConfigured) {
              status = "SET";
              source = (mergedEntry?.source as any) || "project";
            } else if (itemDef.default !== undefined) {
              status = "DEFAULT";
              source = "default";
            } else {
              status = "MISSING";
              source = "missing";
            }

            // 严禁泄露敏感项默认值明文，统一采用核心脱敏视图
            const sanitizedDefault =
              itemDef.default !== undefined
                ? redactConfigValue(itemDef.default, itemDef).value
                : undefined;

            return {
              key,
              required: Boolean(itemDef.required),
              secret: isSecret,
              status,
              source,
              description: itemDef.description || "",
              ...(sanitizedDefault !== undefined ? { defaultValue: sanitizedDefault } : {}),
              hasValue: isConfigured || itemDef.default !== undefined,
            };
          });

          // 模板项不参与 missing/required 统计
          const missingRequired = items.filter(
            (i) => i.status !== "TEMPLATE" && (i as any).required && i.status === "MISSING"
          );
          const ok = missingRequired.length === 0;

          const result: Record<string, any> = {
            packageId: projConfig.id,
            projectRoot: root,
            ok,
            missingCount: missingRequired.length,
            configs: items,
            ...(!ok
              ? {
                  hints: [
                    "Tip: Run 'ad config set <KEY> <val>' to configure required settings.",
                  ],
                }
              : {}),
          };

          renderResult(result, {
            json: options.json,
            humanFormatter: () => renderConfigSchema(items as any, projConfig.id, root) + "\n",
            context,
          });

          if (!ok) {
            if (context) {
              context.exitCode = 1;
            }
            process.exitCode = 1;
          }
        },
        { localRoot: root }
      );
    });
}
