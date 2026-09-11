import {
  fetchRemoteInfo,
  filterWithFallbackInfo,
  getRegistryStatus,
  resolvePackageRoot,
  resolveTarget,
} from "@actiondock/core";
import { Command } from "commander";
import { ArgumentError, ExecutionError } from "../errors";
import {
  projectDetailToJson,
  renderAggregatedPackages,
  renderProjectDetail,
  renderRegistryTree,
  renderResult,
} from "../renderer";
import { getProjectDetailInfo, scanLocalAggregatedPackages } from "../services";
import type { AggregatedPackage, CliContext, ProjectDetailInfo } from "../types";
import { getEffectiveOptions, resolveFallbackStrategy, resolveIntent } from "../utils";

/**
 * 将远端信息响应归一为本地工程详情视图。
 */
function remoteInfoToDetail(remoteInfo: any): ProjectDetailInfo {
  return {
    id: remoteInfo.id,
    name: remoteInfo.name || remoteInfo.id,
    version: remoteInfo.version || "unknown",
    description: remoteInfo.description,
    projectRoot: remoteInfo.path || remoteInfo.projectRoot || "",
    actionsDir: "remote",
    playbooksDir: "remote",
    actionsCount: remoteInfo.actionsCount || (remoteInfo.actions ? remoteInfo.actions.length : 0),
    playbooksCount: remoteInfo.playbooksCount || (remoteInfo.playbooks ? remoteInfo.playbooks.length : 0),
    actions: (remoteInfo.actionsDetail || remoteInfo.actions || []).map((a: any) =>
      typeof a === "string" ? a : a.id
    ),
    playbooks: (remoteInfo.playbooksDetail || remoteInfo.playbooks || []).map((pb: any) =>
      typeof pb === "string" ? pb : pb.id
    ),
    configDeclared: Object.keys(remoteInfo.configDeclared || {}),
    configDef: remoteInfo.configDeclared,
  };
}

/**
 * 渲染工程详情输出（机器模式输出视图转换结果，人类模式渲染详情）。
 */
function renderProjectDetailOutput(
  detail: ProjectDetailInfo,
  options: { json?: boolean; envelope?: boolean; context?: CliContext }
): void {
  renderResult(projectDetailToJson(detail), {
    json: options.json,
    envelope: options.envelope,
    humanFormatter: () => renderProjectDetail(detail),
    context: options.context,
  });
}

/**
 * 注册 info 命令。
 *
 * @param program Commander 实例
 * @param context 命令行上下文
 */
export function registerInfoCommand(program: Command, context?: CliContext): void {
  program
    .command("info [patterns...]")
    .description("Display information about current project, linked package, or remote target")
    .option("-i, --intent <pattern>", "Regex or fuzzy intent filter; falls back to full list when no match")
    .option("-P, --package <id>", "Target package ID or path")
    .option("--tree", "Display packages in hierarchical tree view grouped by workspace")
    .option("-p, --profile <name>", "Query against a specific profile")
    .option("-s, --server <url>", "Remote server URL")
    .option("-t, --token <token>", "Auth token for remote server")
    .option("--fallback", "Enable fallback to full list when no items match intent")
    .option("--no-fallback", "Disable fallback to full list when no items match intent")
    .option("--json", "Output information as JSON")
    .option("--envelope", "Wrap JSON output in standard envelope")
    .option("--data-dir <path>", "Custom database storage directory")
    .action(async (patterns: string[] = [], rawOptions: any, cmd: any) => {
      const options = getEffectiveOptions(rawOptions, cmd);
      const effectiveIntent = resolveIntent(options.intent, patterns);
      const { isMachine, shouldFallback } = resolveFallbackStrategy(options);

      const outOpts = { json: options.json, envelope: options.envelope, context };

      // 远端服务目标分支
      const target = resolveTarget({
        profile: options.profile,
        server: options.server,
        token: options.token,
      }, context?.customHome);

      if (target.type === "remote") {
        const remoteInfo = await fetchRemoteInfo(
          target.serverUrl!,
          target.token,
          {
            intent: effectiveIntent,
            package: options.package,
            tree: Boolean(options.tree),
          }
        );

        if (isMachine) {
          renderResult(remoteInfo, outOpts);
          return;
        }

        if (remoteInfo.type === "tree" || (options.tree && remoteInfo.workspaces)) {
          renderResult(remoteInfo, {
            humanFormatter: () => renderRegistryTree(remoteInfo),
            context,
          });
          return;
        }

        if (remoteInfo.type === "package_detail" || (remoteInfo.id && !remoteInfo.packages)) {
          const detail = remoteInfoToDetail(remoteInfo);
          renderResult(detail, {
            humanFormatter: () => renderProjectDetail(detail),
            context,
          });
          return;
        }

        const packages = remoteInfo.packages || remoteInfo.linkedPackages || [];
        renderResult(packages, {
          humanFormatter: () => renderAggregatedPackages(packages),
          context,
        });
        return;
      }

      // 本地注册表树状图分支
      if (options.tree) {
        const status = getRegistryStatus(context?.customHome);
        renderResult(status, {
          json: options.json,
          envelope: options.envelope,
          humanFormatter: () => renderRegistryTree(status),
          context,
        });
        return;
      }

      // 显式指定 Package 参数分支
      if (options.package) {
        const directRoot = resolvePackageRoot(options.package);
        if (directRoot) {
          const detail = await getProjectDetailInfo(directRoot);
          renderProjectDetailOutput(detail, outOpts);
          return;
        }
        throw new ArgumentError(`Package '${options.package}' not found in linked packages or path`);
      }

      // 扫描本地候选包（当前工程根目录 + 全局已链接包）
      const { currentRoot, aggregated } = scanLocalAggregatedPackages(context);

      // 无关键字过滤场景
      if (!effectiveIntent) {
        if (currentRoot) {
          const detail = await getProjectDetailInfo(currentRoot);
          renderProjectDetailOutput(detail, outOpts);
          return;
        }

        if (aggregated.length === 0) {
          renderResult(
            { linkedPackages: [] },
            {
              ...outOpts,
              humanFormatter: () =>
                "No ActionDock project in current directory, and no packages linked.\nRun 'ad link' inside an Action package to register it.",
            }
          );
          return;
        }

        renderResult(
          { linkedPackages: aggregated },
          {
            ...outOpts,
            humanFormatter: () => renderAggregatedPackages(aggregated),
          }
        );
        return;
      }

      // 有关键字过滤场景：单一位置参数且非显式 --intent 时优先尝试包寻址
      if (patterns.length === 1 && !options.intent) {
        const directRoot = resolvePackageRoot(patterns[0]);
        if (directRoot) {
          const detail = await getProjectDetailInfo(directRoot);
          renderProjectDetailOutput(detail, outOpts);
          return;
        }
      }

      if (aggregated.length === 0) {
        if (isMachine) {
          renderResult(
            { linkedPackages: [], matchedCount: 0, isFallback: false },
            outOpts
          );
          return;
        }
        throw new ExecutionError(
          `No ActionDock project or linked packages available to match '${effectiveIntent}'`
        );
      }

      const filterRes = filterWithFallbackInfo(
        aggregated,
        effectiveIntent,
        [
          (p: AggregatedPackage) => p.id,
          (p: AggregatedPackage) => p.name,
          (p: AggregatedPackage) => p.description,
          (p: AggregatedPackage) => p.path,
          (p: AggregatedPackage) => p.actions,
          (p: AggregatedPackage) => p.playbooks,
        ],
        shouldFallback
      );

      // 无匹配项
      if (filterRes.matchedCount === 0) {
        if (!filterRes.isFallback) {
          if (isMachine) {
            renderResult(
              { linkedPackages: [], matchedCount: 0, isFallback: false },
              outOpts
            );
            return;
          }
          throw new ExecutionError(`No packages matched intent '${effectiveIntent}'`);
        }

        // 回退模式：展示全部包并附带提示
        if (isMachine) {
          renderResult(
            { linkedPackages: filterRes.items, isFallback: true, matchedCount: 0 },
            outOpts
          );
          return;
        }

        renderResult(
          { linkedPackages: filterRes.items, isFallback: true, matchedCount: 0 },
          {
            ...outOpts,
            humanFormatter: () =>
              `(No linked packages matched intent '${effectiveIntent}', showing all packages)\n\n` +
              renderAggregatedPackages(filterRes.items),
          }
        );
        return;
      }

      // 机器模式下搜索：稳定返回列表结构，不因为 matchedCount === 1 突变为详情
      if (isMachine) {
        renderResult(
          { linkedPackages: filterRes.items, matchedCount: filterRes.matchedCount, isFallback: false },
          outOpts
        );
        return;
      }

      // 人类终端交互：精确匹配单个包展开详情
      if (filterRes.matchedCount === 1) {
        const matchedPkg = filterRes.items[0];
        const detail = await getProjectDetailInfo(matchedPkg.path);
        renderProjectDetailOutput(detail, outOpts);
        return;
      }

      // 匹配多个包：输出摘要列表
      renderResult(
        { linkedPackages: filterRes.items },
        {
          ...outOpts,
          humanFormatter: () =>
            renderAggregatedPackages(filterRes.items, {
              header: `ActionDock Linked Packages (${filterRes.matchedCount} matches for '${effectiveIntent}'):\n`,
              showTip: true,
            }),
        }
      );
    });
}
