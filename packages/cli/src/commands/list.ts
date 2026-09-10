import {
  createActionDockTarget,
  filterWithFallbackInfo,
  findProjectRoot,
  resolvePackageRoot,
  resolveTarget,
} from "@actiondock/core";
import { Command } from "commander";
import { ArgumentError } from "../errors";
import { renderActionList, renderResult } from "../renderer";
import type { CliContext } from "../types";
import { getEffectiveOptions, resolveIntent } from "../utils";

/**
 * 注册顶层统一 list 命令：列出当前工程、已链接包或远端服务中的可用 Action。
 * 
 * @param program Commander 根程序对象
 * @param context 命令行上下文
 */
export function registerListCommand(program: Command, context?: CliContext): void {
  program
    .command("list [patterns...]")
    .description("List actions in current project, linked packages, or remote profile")
    .option("-i, --intent <pattern>", "Regex or fuzzy intent filter; falls back to full list when no match")
    .option("-P, --package <id>", "Target package ID or path")
    .option("-p, --profile <name>", "Query against a specific execution profile")
    .option("-s, --server <url>", "Remote server URL")
    .option("-t, --token <token>", "Auth token for remote server")
    .option("--fallback", "Enable fallback to full list when no items match intent")
    .option("--no-fallback", "Disable fallback to full list when no items match intent")
    .option("--json", "Output as JSON")
    .option("--envelope", "Wrap JSON output in standard envelope")
    .option("--data-dir <path>", "Custom database storage directory")
    .action(async (patterns: string[] = [], rawOptions: any, cmd: any) => {
      const options = getEffectiveOptions(rawOptions, cmd);
      const effectiveIntent = resolveIntent(options.intent, patterns);
      const isMachine = Boolean(options.json || options.envelope);
      const fallbackExplicit =
        options.fallback === true ||
        (Array.isArray(process.argv) && process.argv.includes("--fallback"));
      const shouldFallback = isMachine ? fallbackExplicit : options.fallback !== false;

      // 1. 目标拓扑解析
      const resolved = resolveTarget(
        {
          profile: options.profile,
          server: options.server,
          token: options.token,
        },
        context?.customHome
      );

      let targetPackageRoot: string | undefined;
      if (resolved.type === "local") {
        if (options.package) {
          const root = resolvePackageRoot(options.package);
          if (!root) {
            throw new ArgumentError(
              `Package '${options.package}' not found in linked packages or path`
            );
          }
          targetPackageRoot = root;
        } else {
          targetPackageRoot = findProjectRoot() || undefined;
        }
      }

      // 2. 通过 Target 门面统一获取 Action 列表
      const target = await createActionDockTarget(
        resolved.type === "remote"
          ? {
              type: "remote",
              serverUrl: resolved.serverUrl!,
              token: resolved.token,
            }
          : {
              type: "local",
              projectRoot: targetPackageRoot,
              customHome: context?.customHome,
              dataDir: options.dataDir || context?.dataDir,
              scanLinkedPackages: true,
            }
      );

      try {
        let rawSummaries = await target.listActions();

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
            { json: options.json, envelope: options.envelope, context }
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
          envelope: options.envelope,
          humanFormatter: () =>
            renderActionList(
              filterRes.items,
              title,
              filterRes.isFallback,
              effectiveIntent
            ),
          context,
        });
      } finally {
        await target.close();
      }
    });
}
