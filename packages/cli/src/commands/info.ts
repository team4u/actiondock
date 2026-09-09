import { existsSync } from "node:fs";
import {
  fetchRemoteInfo,
  filterWithFallbackInfo,
  findProjectRoot,
  getRegistryStatus,
  listLinkedPackages,
  loadManifest,
  loadPlaybooks,
  loadProjectConfig,
  resolvePackageRoot,
  resolveTarget,
} from "@actiondock/core";
import { Command } from "commander";
import { ArgumentError, ExecutionError } from "../errors";
import {
  renderAggregatedPackages,
  renderProjectDetail,
  renderRegistryTree,
  renderResult,
} from "../renderer";
import type { AggregatedPackage, ProjectDetailInfo, CliContext } from "../types";
import { getEffectiveOptions, resolveIntent } from "../utils";

async function getProjectDetailInfo(root: string): Promise<ProjectDetailInfo> {
  const config = loadProjectConfig(root);
  const manifest = loadManifest(root);
  const actionsMap = new Map<string, { id: string; description?: string }>();
  if (manifest?.actions) {
    for (const [id, item] of Object.entries(manifest.actions)) {
      actionsMap.set(id, {
        id,
        description: item.description,
      });
    }
  }
  const playbooks = loadPlaybooks(root, config.playbooksDir);

  return {
    id: config.id,
    name: config.name || config.id,
    version: config.version || "0.0.0",
    description: config.description,
    projectRoot: root,
    actionsDir: config.actionsDir || "actions",
    playbooksDir: config.playbooksDir || "playbooks",
    actionsCount: actionsMap.size,
    playbooksCount: playbooks.size,
    actions: Array.from(actionsMap.keys()),
    playbooks: Array.from(playbooks.keys()),
    configDeclared: config.config ? Object.keys(config.config) : [],
    configDef: config.config,
    actionsMap,
    playbooksMap: playbooks,
  };
}

function projectDetailToJson(info: ProjectDetailInfo) {
  return {
    id: info.id,
    name: info.name || info.id,
    version: info.version || "0.0.0",
    description: info.description,
    projectRoot: info.projectRoot,
    actionsDir: info.actionsDir,
    playbooksDir: info.playbooksDir,
    actionsCount: info.actionsCount,
    playbooksCount: info.playbooksCount,
    actions: info.actions,
    playbooks: info.playbooks,
    configDeclared: info.configDeclared,
  };
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
      const isMachine = Boolean(options.json || options.envelope);
      const fallbackExplicit = options.fallback === true || (Array.isArray(process.argv) && process.argv.includes("--fallback"));
      const shouldFallback = isMachine ? fallbackExplicit : options.fallback !== false;

      // 1. 远端服务目标分支
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
          renderResult(remoteInfo, {
            json: options.json,
            envelope: options.envelope,
            context,
          });
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
          const detail: ProjectDetailInfo = {
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

      // 2. 本地注册表树状图分支
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

      // 3. 显式指定 Package 参数分支
      if (options.package) {
        const directRoot = resolvePackageRoot(options.package);
        if (directRoot) {
          const detail = await getProjectDetailInfo(directRoot);
          renderResult(projectDetailToJson(detail), {
            json: options.json,
            envelope: options.envelope,
            humanFormatter: () => renderProjectDetail(detail),
            context,
          });
          return;
        }
        throw new ArgumentError(`Package '${options.package}' not found in linked packages or path`);
      }

      // 4. 扫描本地候选包（当前工程根目录 + 全局已链接包）
      const currentRoot = findProjectRoot();
      const linkedList = listLinkedPackages(context?.customHome);
      const aggregated: AggregatedPackage[] = [];
      const seenPaths = new Set<string>();

      if (currentRoot) {
        try {
          const config = loadProjectConfig(currentRoot);
          const manifest = loadManifest(currentRoot);
          const manifestActionIds = manifest?.actions ? Object.keys(manifest.actions) : [];
          const playbooks = loadPlaybooks(currentRoot, config.playbooksDir);
          aggregated.push({
            id: config.id,
            name: config.name || config.id,
            version: config.version || "0.0.0",
            description: config.description,
            path: currentRoot,
            actionsCount: manifestActionIds.length,
            playbooksCount: playbooks.size,
            actions: manifestActionIds,
            playbooks: Array.from(playbooks.keys()),
            configDeclared: config.config ? Object.keys(config.config) : [],
          });
          seenPaths.add(currentRoot);
        } catch {
          // 忽略异常工程根目录
        }
      }

      for (const pkg of linkedList) {
        if (!existsSync(pkg.path)) continue;
        if (seenPaths.has(pkg.path)) continue;
        try {
          const config = loadProjectConfig(pkg.path);
          const manifest = loadManifest(pkg.path);
          const manifestActionIds = manifest?.actions ? Object.keys(manifest.actions) : [];
          const playbooks = loadPlaybooks(pkg.path, config.playbooksDir);

          aggregated.push({
            id: config.id,
            name: config.name || config.id,
            version: config.version || "0.0.0",
            description: config.description,
            path: pkg.path,
            actionsCount: manifestActionIds.length,
            playbooksCount: playbooks.size,
            actions: manifestActionIds,
            playbooks: Array.from(playbooks.keys()),
            configDeclared: config.config ? Object.keys(config.config) : [],
          });
          seenPaths.add(pkg.path);
        } catch {
          // 忽略失效链接
        }
      }

      // 5. 无关键字过滤场景
      if (!effectiveIntent) {
        if (currentRoot) {
          const detail = await getProjectDetailInfo(currentRoot);
          renderResult(projectDetailToJson(detail), {
            json: options.json,
            envelope: options.envelope,
            humanFormatter: () => renderProjectDetail(detail),
            context,
          });
          return;
        }

        if (aggregated.length === 0) {
          renderResult(
            { linkedPackages: [] },
            {
              json: options.json,
              envelope: options.envelope,
              humanFormatter: () =>
                "No ActionDock project in current directory, and no packages linked.\nRun 'ad link' inside an Action package to register it.",
              context,
            }
          );
          return;
        }

        renderResult(
          { linkedPackages: aggregated },
          {
            json: options.json,
            envelope: options.envelope,
            humanFormatter: () => renderAggregatedPackages(aggregated),
            context,
          }
        );
        return;
      }

      // 6. 有关键字过滤场景
      if (patterns.length === 1 && !options.intent) {
        const directRoot = resolvePackageRoot(patterns[0]);
        if (directRoot) {
          const detail = await getProjectDetailInfo(directRoot);
          renderResult(projectDetailToJson(detail), {
            json: options.json,
            envelope: options.envelope,
            humanFormatter: () => renderProjectDetail(detail),
            context,
          });
          return;
        }
      }

      if (aggregated.length === 0) {
        if (isMachine) {
          renderResult(
            { linkedPackages: [], matchedCount: 0, isFallback: false },
            { json: options.json, envelope: options.envelope, context }
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
          (p) => p.id,
          (p) => p.name,
          (p) => p.description,
          (p) => p.path,
          (p) => p.actions,
          (p) => p.playbooks,
        ],
        shouldFallback
      );

      // 无匹配项
      if (filterRes.matchedCount === 0) {
        if (!filterRes.isFallback) {
          if (isMachine) {
            renderResult(
              { linkedPackages: [], matchedCount: 0, isFallback: false },
              { json: options.json, envelope: options.envelope, context }
            );
            return;
          }
          throw new ExecutionError(`No packages matched intent '${effectiveIntent}'`);
        }

        // Fallback enabled: display all packages with a notice
        if (isMachine) {
          renderResult(
            { linkedPackages: filterRes.items, isFallback: true, matchedCount: 0 },
            { json: options.json, envelope: options.envelope, context }
          );
          return;
        }

        renderResult(
          { linkedPackages: filterRes.items, isFallback: true, matchedCount: 0 },
          {
            json: options.json,
            envelope: options.envelope,
            humanFormatter: () =>
              `(No linked packages matched intent '${effectiveIntent}', showing all packages)\n\n` +
              renderAggregatedPackages(filterRes.items),
            context,
          }
        );
        return;
      }

      // 机器模式下搜索：稳定返回列表结构，不因为 matchedCount === 1 突变为详情
      if (isMachine) {
        renderResult(
          { linkedPackages: filterRes.items, matchedCount: filterRes.matchedCount, isFallback: false },
          { json: options.json, envelope: options.envelope, context }
        );
        return;
      }

      // 人类终端交互：精确匹配单个包展开详情
      if (filterRes.matchedCount === 1) {
        const matchedPkg = filterRes.items[0];
        const detail = await getProjectDetailInfo(matchedPkg.path);
        renderResult(projectDetailToJson(detail), {
          json: options.json,
          envelope: options.envelope,
          humanFormatter: () => renderProjectDetail(detail),
          context,
        });
        return;
      }

      // 匹配多个包：输出摘要列表
      renderResult(
        { linkedPackages: filterRes.items },
        {
          json: options.json,
          envelope: options.envelope,
          humanFormatter: () =>
            renderAggregatedPackages(filterRes.items, {
              header: `ActionDock Linked Packages (${filterRes.matchedCount} matches for '${effectiveIntent}'):\n`,
              showTip: true,
            }),
          context,
        }
      );
    });
}
