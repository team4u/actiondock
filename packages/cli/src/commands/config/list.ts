import {
  fetchRemoteConfig,
  filterWithFallbackInfo,
  findProjectRoot,
  isSecretConfigKey,
  loadProjectConfig,
  maskSecretValue,
  resolveEnvValue,
  resolvePackageRoot,
  resolveTarget,
} from "@actiondock/core";
import type { Command } from "commander";
import { ArgumentError } from "../../errors";
import { renderConfigList, renderResult } from "../../renderer";
import type { CliContext } from "../../types";
import { getEffectiveOptions, resolveIntent, withTarget } from "../../utils";

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
  configCmd
    .command("list [patterns...]")
    .description("List configuration entries (Global & Project)")
    .option("-P, --package <id>", "Target package ID or path")
    .option("-g, --global", "Show only global configurations")
    .option("-p, --profile <name>", "Query config on a remote target")
    .option("-s, --server <url>", "Remote server URL")
    .option("-t, --token <token>", "Auth token for remote server")
    .option("-i, --intent <pattern>", "Regex or fuzzy intent filter; falls back to full list when no match")
    .option("--reveal, --show-secrets", "Reveal plain text values for secrets")
    .option("--no-fallback", "Disable fallback to full list when no items match intent")
    .option("--data-dir <path>", "Custom database storage directory")
    .option("--json", "Output as JSON")
    .option("--envelope", "Wrap JSON output in standard envelope")
    .action(async (patterns: string[] = [], rawOptions: any, cmd: any) => {
      const options = getEffectiveOptions(rawOptions, cmd);
      const effectiveIntent = resolveIntent(options.intent, patterns);
      const shouldFallback = options.fallback !== false;
      const reveal = Boolean(options.reveal || options.showSecrets);

      // 远端服务分支不经过 Target 门面，直接查询远端配置接口
      const remoteTargetInfo = resolveTarget(
        { profile: options.profile, server: options.server, token: options.token },
        context?.customHome
      );

      if (remoteTargetInfo.type === "remote") {
        const res = await fetchRemoteConfig(remoteTargetInfo.serverUrl!, remoteTargetInfo.token, options.package);
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
          envelope: options.envelope,
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
            envelope: options.envelope,
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
            throw new ArgumentError(`Package '${options.package}' not found in linked packages or path`);
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
            envelope: options.envelope,
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
        const declared = projConfig.config || {};

        const globalConfigList = await localTarget.listConfig("global");
        const projectConfigList = await localTarget.listConfig(projConfig.id);

        const projectConfigMap = new Map(projectConfigList.map((c) => [c.key, c]));
        const globalConfigMap = new Map(globalConfigList.map((c) => [c.key, c]));

        const allKeys = new Set([
          ...Object.keys(declared),
          ...projectConfigList.map((c) => c.key),
          ...globalConfigList.map((c) => c.key),
        ]);

        // 配置合并优先级：项目包级 > 全局持久化 > 环境变量 > 声明默认值。
        // core 的 RuntimeConfig.describe 已是五层链事实源，但 Target 门面仅按作用域暴露
        // listConfig(scope)，不提供跨作用域合并视图；此处保持命令层合并逻辑，
        // 与 app.getConfig 的 describe 委托链行为语义一致（overrides 层仅存在于 run 链路）。
        const merged = Array.from(allKeys).map((k) => {
          let rawValue: unknown;
          let source = "default";
          const envResolved = resolveEnvValue(k, declared[k], projConfig.id);
          const projItem = projectConfigMap.get(k);
          const globItem = globalConfigMap.get(k);

          if (projItem && projItem.configured && projItem.source === "package") {
            rawValue = projItem.value;
            source = "project";
          } else if (globItem && globItem.configured) {
            rawValue = globItem.value;
            source = "global";
          } else if (envResolved !== undefined) {
            rawValue = envResolved.value;
            source = "env";
          } else {
            rawValue = declared[k]?.default;
            source = "default";
          }

          const isSecret = isSecretConfigKey(k, declared[k]);
          return toDisplayEntry(k, rawValue, source, isSecret, reveal, declared[k]?.description || "");
        });

        const filterRes = filterWithFallbackInfo(
          merged,
          effectiveIntent,
          [(c) => c.key, (c) => c.value, (c) => c.description, (c) => c.source],
          shouldFallback
        );

        renderResult(filterRes.items, {
          json: options.json,
          envelope: options.envelope,
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
