import {
  fetchRemoteConfig,
} from "@actiondock/core/profile";
import {
  findProjectRoot,
  loadProjectConfig,
} from "@actiondock/core";
import {
  filterWithFallbackInfo,
  isSecretConfigKey,
  maskSecretValue,
} from "@actiondock/core/project";
import {
  resolvePackageRoot,
} from "@actiondock/core/registry";
import type { Command } from "commander";
import { packageNotFoundError } from "../../errors";
import { renderConfigList, renderResult } from "../../renderer";
import { buildMergedConfigEntries } from "../../services/config-merge";
import type { CliContext } from "../../types";
import {
  applyTargetOptions,
  getEffectiveOptions,
  remoteTargetLabel,
  resolveFallbackStrategy,
  resolveIntent,
  resolveTargetFromOptions,
  withService,
} from "../../utils";

/**
 * 构造单条配置项的展示视图（含掩码决策，reveal 为假且为敏感键时打码）。
 * 掩码决策收敛于命令层，renderer 仅负责值的字符串格式化。
 */
function toDisplayEntry(
  key: string,
  rawValue: unknown,
  source: string,
  isSecret: boolean,
  reveal: boolean,
  description?: string
) {
  const displayValue = !reveal && isSecret && rawValue !== undefined ? maskSecretValue(rawValue) : rawValue;
  return {
    key,
    value: displayValue,
    source,
    secret: isSecret,
    ...(description !== undefined ? { description } : {}),
  };
}

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
    .option("--reveal, --show-secrets", "Reveal plain text values for secrets")
    .option("--fallback", "Enable fallback to full list when no items match intent")
    .option("--no-fallback", "Disable fallback to full list when no items match intent")
    .option("--data-dir <path>", "Custom database storage directory")
    .option("--json", "Output as JSON")
    .action(async (patterns: string[] = [], rawOptions: any, cmd: any) => {
      const options = getEffectiveOptions(rawOptions, cmd);
      const effectiveIntent = resolveIntent(options.intent, patterns);
      const { shouldFallback } = resolveFallbackStrategy(options);
      const reveal = Boolean(options.reveal || options.showSecrets);

      // 远端服务分支不经过 Target 门面，直接查询远端配置接口
      const remoteTargetInfo = resolveTargetFromOptions(options, context);

      if (remoteTargetInfo.type === "remote") {
        const res = await fetchRemoteConfig(remoteTargetInfo.serverUrl!, remoteTargetInfo.token, options.package, {
          allowInsecureHttp: Boolean(options.allowInsecureHttp),
          insecure: remoteTargetInfo.insecure,
        });
        const entries = Object.entries(res.values || {}).map(([k, v]) =>
          toDisplayEntry(
            k,
            v,
            "remote",
            isSecretConfigKey(k, res.declared?.[k]),
            reveal,
            res.declared?.[k]?.description || ""
          )
        );

        renderResult(entries, {
          json: options.json,
          humanFormatter: () =>
            renderConfigList(
              entries,
              remoteTargetLabel(remoteTargetInfo),
              false,
              effectiveIntent
            ),
          context,
        });
        return;
      }

      // 本地分支（通过 Service 门面统一访问）
      await withService(options, context, async (service) => {
        const root = options.package ? resolvePackageRoot(options.package) : findProjectRoot();

        // 全局作用域分支：显式 --global 或无工程回退时仅列举全局配置
        if (options.global || !root) {
          if (!options.global && options.package) {
            throw packageNotFoundError(options.package);
          }

          const all = (await service.management?.config.list("global")) ?? [];
          const entries = all.map((item) =>
            toDisplayEntry(
              item.key,
              item.value,
              "global",
              item.secret || isSecretConfigKey(item.key),
              reveal
            )
          );

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

        // 跨作用域合并视图单一事实源：项目包级 > 全局持久化 > 环境变量 > 声明默认值
        const merged = await buildMergedConfigEntries(root, service, reveal);

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
      });
    });
}
