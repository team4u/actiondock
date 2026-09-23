import { Command } from "commander";
import {
  filterWithFallbackInfo,
} from "@actiondock/core/package";
import { packageNotFoundError } from "../errors";
import { renderActionList, renderResult } from "../renderer";
import type { CliContext } from "../types";
import {
  applyTargetOptions,
  getEffectiveOptions,
  resolveFallbackStrategy,
  resolveIntent,
  resolveLocalPackageRoot,
  withService,
} from "../utils";

/**
 * 挂载 list 子命令至指定 Commander 节点。
 * 
 * @param parent 目标 Commander 命令节点
 * @param context 命令行上下文
 */
export function attachListCommand(parent: Command, context?: CliContext): Command {
  const cmd = parent
    .command("list [patterns...]")
    .description("List actions in current project, linked packages, or remote profile")
    .option("-i, --intent <pattern>", "Regex or fuzzy intent filter; falls back to full list when no match")
    .option("-P, --package <id>", "Target package ID or path");

  return applyTargetOptions(cmd)
    .option("--fallback", "Enable fallback to full list when no items match intent")
    .option("--no-fallback", "Disable fallback to full list when no items match intent")
    .option("--json", "Output as JSON")
    .option("--data-dir <path>", "Custom database storage directory")
    .action(async (patterns: string[] = [], rawOptions: any, cmd: any) => {
      const options = getEffectiveOptions(rawOptions, cmd);
      const effectiveIntent = resolveIntent(options.intent, patterns);
      const { isMachine, shouldFallback } = resolveFallbackStrategy(options);

      // 目标拓扑解析（仅 local 分支需要包寻址）
      const targetPackageRoot = resolveLocalPackageRoot(options.package);
      if (options.package && !targetPackageRoot) {
        throw packageNotFoundError(options.package);
      }

      // 通过 Service 门面统一获取 Action 列表
      await withService(
        options,
        context,
        async (service, resolved) => {
          let rawSummaries = await service.discovery.listActions();

          // 若指定了目标包但本地未过滤，则精确匹配包标识
          if (options.package && !options.profile && !options.server) {
            rawSummaries = rawSummaries.filter(
              (s) =>
                s.id.startsWith(`${options.package}/`) ||
                (s as any).packageId === options.package ||
                !s.id.includes("/")
            );
          }

          const rawList = rawSummaries.map((s) => {
            let id = s.id;
            if (targetPackageRoot || options.package) {
              const pkgId = (s as any).packageId || options.package;
              if (pkgId && id.startsWith(`${pkgId}/`)) {
                id = id.slice(pkgId.length + 1);
              } else if (targetPackageRoot && id.includes("/")) {
                id = id.slice(id.indexOf("/") + 1);
              }
            }
            return {
              id,
              description: s.description || "",
            };
          });

          const filterRes = filterWithFallbackInfo(
            rawList,
            effectiveIntent,
            [(a) => a.id, (a) => a.description],
            shouldFallback
          );

          if (filterRes.isFallback && isMachine) {
            renderResult(
              { items: filterRes.items, isFallback: true, matchedCount: 0 },
              { json: options.json, context }
            );
            return;
          }

          const title =
            resolved.type === "remote"
              ? `Actions on remote server ${resolved.serverUrl}${resolved.profileName ? ` (Profile: ${resolved.profileName})` : ""}`
              : targetPackageRoot
              ? `Actions in ${options.package || "current project"}`
              : "Available Actions";

          renderResult(filterRes.items, {
            json: options.json,
            humanFormatter: () =>
              renderActionList(
                filterRes.items,
                title,
                filterRes.isFallback,
                effectiveIntent
              ),
            context,
          });
        },
        { localRoot: targetPackageRoot || undefined, scanLinkedPackages: true }
      );
    });
}

/**
 * 注册顶层统一 list 命令：列出当前工程、已链接包或远端服务中的可用 Action。
 * 
 * @param program Commander 根程序对象
 * @param context 命令行上下文
 */
export function registerListCommand(program: Command, context?: CliContext): void {
  attachListCommand(program, context);
}
