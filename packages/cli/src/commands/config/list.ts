import {
  fetchRemoteConfig,
  filterWithFallbackInfo,
  findProjectRoot,
  isSecretConfigKey,
  loadProjectConfig,
  maskSecretValue,
  resolvePackageRoot,
} from "@actiondock/core";
import type { Command } from "commander";
import { packageNotFoundError } from "../../errors";
import { renderConfigList, renderResult } from "../../renderer";
import { buildMergedConfigEntries } from "../../services/config-merge";
import type { CliContext } from "../../types";
import {
  applyTargetOptions,
  getEffectiveOptions,
  resolveIntent,
  resolveTargetFromOptions,
  withTarget,
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
    .option("--no-fallback", "Disable fallback to full list when no items match intent")
    .option("--data-dir <path>", "Custom database storage directory")
    .option("--json", "Output as JSON")
    .action(async (patterns: string[] = [], rawOptions: any, cmd: any) => {
      const options = getEffectiveOptions(rawOptions, cmd);
      const effectiveIntent = resolveIntent(options.intent, patterns);
      const shouldFallback = options.fallback !== false;
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
              `Remote Server ${remoteTargetInfo.serverUrl}${remoteTargetInfo.profileName ? ` (Profile: ${remoteTargetInfo.profileName})` : ""}`,
              false,
              effectiveIntent
            ),
          context,
        });
        return;
      }

      // 本地分支（通过 Target 门面统一访问）
      await withTarget(options, context, async (localTarget) => {
        const root = options.package ? resolvePackageRoot(options.package) : findProjectRoot();

        if (options.global) {
          const all = await localTarget.listConfig("global");
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
                "Global Scope",
                filterRes.isFallback,
                effectiveIntent
              ),
            context,
          });
          return;
        }

        if (!root) {
          if (options.package) {
            throw packageNotFoundError(options.package);
          }

          const all = await localTarget.listConfig("global");
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
                "Global Scope (No project found)",
                filterRes.isFallback,
                effectiveIntent
              ),
            context,
          });
          return;
        }

        const projConfig = loadProjectConfig(root);

        // 跨作用域合并视图单一事实源：项目包级 > 全局持久化 > 环境变量 > 声明默认值
        const merged = await buildMergedConfigEntries(root, localTarget, reveal);

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
