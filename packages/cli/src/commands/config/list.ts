import {
  loadProjectConfig,
} from "@actiondock/core";
import {
  filterWithFallbackInfo,
} from "@actiondock/core/project";
import type { Command } from "commander";
import { packageNotFoundError } from "../../errors";
import { renderConfigList, renderResult } from "../../renderer";
import { buildMergedConfigEntries, type MergedConfigEntry } from "../../services/config-merge";
import type { CliContext } from "../../types";
import {
  applyTargetOptions,
  getEffectiveOptions,
  remoteTargetLabel,
  resolveFallbackStrategy,
  resolveIntent,
  resolveLocalPackageRoot,
  resolveTargetFromOptions,
  withService,
} from "../../utils";
import { fetchRemoteConfigSafe } from "./remote-helper";

/**
 * 注册 config list 子命令：列出全局与项目配置项。
 *
 * @param configCmd config 命令实例
 * @param context 命令行上下文
 */
export function registerConfigListCommand(configCmd: Command, context?: CliContext): void {
  applyTargetOptions(
    configCmd
      .command("list [patterns...]")
      .description("List configuration entries (Global & Project)")
      .option("-P, --package <id>", "Target package ID or path")
      .option("-g, --global", "Show only global configurations")
  )
    .option("-i, --intent <pattern>", "Regex or fuzzy intent filter; falls back to full list when no match")
    .option("--fallback", "Enable fallback to full list when no items match intent")
    .option("--no-fallback", "Disable fallback to full list when no items match intent")
    .option("--data-dir <path>", "Custom database storage directory")
    .option("--json", "Output as JSON")
    .action(async (patterns: string[] = [], rawOptions: any, cmd: any) => {
      const options = getEffectiveOptions(rawOptions, cmd);
      const effectiveIntent = resolveIntent(options.intent, patterns);
      const { shouldFallback } = resolveFallbackStrategy(options);

      // 远端服务分支
      const remoteTargetInfo = resolveTargetFromOptions(options, context);

      if (remoteTargetInfo.type === "remote") {
        const { items, declared } = await fetchRemoteConfigSafe(
          {
            serverUrl: remoteTargetInfo.serverUrl,
            token: remoteTargetInfo.token,
            insecure: remoteTargetInfo.insecure,
          },
          options,
          context
        );

        const entries: MergedConfigEntry[] = items.map((it) => ({
          key: it.key,
          value: it.value,
          source: it.source,
          secret: it.secret,
          configured: it.configured,
          redactedPaths: it.redactedPaths,
          ...(declared?.[it.key]?.description ? { description: declared[it.key].description } : {}),
        }));

        const filterRes = filterWithFallbackInfo(
          entries,
          effectiveIntent,
          [(c) => c.key, (c) => c.value, (c) => c.description, (c) => c.source],
          shouldFallback
        );

        renderResult(filterRes.items, {
          json: options.json,
          humanFormatter: () =>
            renderConfigList(
              filterRes.items,
              remoteTargetLabel(remoteTargetInfo),
              filterRes.isFallback,
              effectiveIntent
            ),
          context,
        });
        return;
      }

      // 本地分支
      await withService(
        options,
        context,
        async (service) => {
          const root = resolveLocalPackageRoot(options.package) || undefined;

          // 全局作用域分支
          if (options.global || !root) {
            if (!options.global && options.package) {
              throw packageNotFoundError(options.package);
            }

            const all = (await service.management?.config.list("global")) ?? [];
            const entries: MergedConfigEntry[] = all.map((item) => ({
              key: item.key,
              value: item.value,
              source: "global",
              secret: item.secret,
              configured: item.configured,
              redactedPaths: item.redactedPaths ?? [],
            }));

            const filterRes = filterWithFallbackInfo(
              entries,
              effectiveIntent,
              [(c) => c.key, (c) => c.value],
              shouldFallback
            );

            renderResult(filterRes.items, {
              json: options.json,
              humanFormatter: () =>
                renderConfigList(
                  filterRes.items,
                  options.global ? "Global Scope" : "Global Scope (No project found)",
                  filterRes.isFallback,
                  effectiveIntent
                ),
              context,
            });
            return;
          }

          const projConfig = loadProjectConfig(root);

          // 跨作用域合并视图单一事实源
          const merged = await buildMergedConfigEntries(root, service);

          const filterRes = filterWithFallbackInfo(
            merged,
            effectiveIntent,
            [(c) => c.key, (c) => c.value, (c) => c.description, (c) => c.source],
            shouldFallback
          );

          renderResult(filterRes.items, {
            json: options.json,
            humanFormatter: () =>
              renderConfigList(
                filterRes.items,
                `${projConfig.name} (${projConfig.id})`,
                filterRes.isFallback,
                effectiveIntent
              ),
            context,
          });
        },
        {
          localRoot: () => resolveLocalPackageRoot(options.package) || undefined,
        }
      );
    });
}
