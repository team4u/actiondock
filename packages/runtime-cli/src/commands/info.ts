import { existsSync } from "node:fs";
import {
  fetchRemoteInfo,
  filterWithFallbackInfo,
  findProjectRoot,
  getRegistryStatus,
  listLinkedPackages,
  loadActions,
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
import type { AggregatedPackage, ProjectDetailInfo, RuntimeCliContext } from "../types";
import { getEffectiveOptions, resolveIntent } from "../utils";

async function getProjectDetailInfo(root: string): Promise<ProjectDetailInfo> {
  const config = loadProjectConfig(root);
  const actions = await loadActions(root, config.actionsDir);
  const playbooks = loadPlaybooks(root, config.playbooksDir);

  return {
    id: config.id,
    name: config.name,
    version: config.version,
    description: config.description,
    projectRoot: root,
    actionsDir: config.actionsDir || "actions",
    playbooksDir: config.playbooksDir || "playbooks",
    actionsCount: actions.size,
    playbooksCount: playbooks.size,
    actions: Array.from(actions.keys()),
    playbooks: Array.from(playbooks.keys()),
    configDeclared: config.config ? Object.keys(config.config) : [],
    configDef: config.config,
    actionsMap: actions,
    playbooksMap: playbooks,
  };
}

function projectDetailToJson(info: ProjectDetailInfo) {
  return {
    id: info.id,
    name: info.name,
    version: info.version,
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
 * @param context 运行时上下文
 */
export function registerInfoCommand(program: Command, context?: RuntimeCliContext): void {
  program
    .command("info [patterns...]")
    .description("Display information about current project, linked package, or remote target")
    .option("-i, --intent <pattern>", "Regex or fuzzy intent filter; falls back to full list when no match")
    .option("-P, --package <id>", "Target package ID or path")
    .option("--tree", "Display packages in hierarchical tree view grouped by workspace")
    .option("-p, --profile <name>", "Query against a specific profile")
    .option("-s, --server <url>", "Remote server URL")
    .option("-t, --token <token>", "Auth token for remote server")
    .option("--no-fallback", "Disable fallback to full list when no items match intent")
    .option("--json", "Output information as JSON")
    .option("--envelope", "Wrap JSON output in standard envelope")
    .action(async (patterns: string[] = [], rawOptions: any, cmd: any) => {
      const options = getEffectiveOptions(rawOptions, cmd);
      const effectiveIntent = resolveIntent(options.intent, patterns);
      const shouldFallback = options.fallback !== false;

      // 1. 独立程序运行模式分支
      if (context?.standalone) {
        const sa = context.standalone;
        const actionsMap = sa.actions instanceof Map
          ? sa.actions
          : new Map(sa.actions.map((a) => [a.id, a]));

        const info: ProjectDetailInfo = {
          id: sa.packageId,
          name: sa.packageId,
          version: sa.version,
          description: sa.description,
          projectRoot: process.cwd(),
          actionsDir: "built-in",
          playbooksDir: "none",
          actionsCount: actionsMap.size,
          playbooksCount: 0,
          actions: Array.from(actionsMap.keys()),
          playbooks: [],
          configDeclared: sa.configDefs ? Object.keys(sa.configDefs) : [],
          configDef: sa.configDefs,
          actionsMap,
        };

        if (options.tree) {
          const treeData = {
            workspaces: [],
            packages: [
              {
                id: sa.packageId,
                name: sa.packageId,
                version: sa.version,
                path: process.cwd(),
                status: "active",
                actionsCount: actionsMap.size,
              },
            ],
            totalPackagesCount: 1,
            staleCount: 0,
          };
          renderResult(treeData, {
            json: options.json,
            envelope: options.envelope,
            humanFormatter: () => renderRegistryTree(treeData),
            context,
          });
          return;
        }

        const jsonData = projectDetailToJson(info);
        renderResult(jsonData, {
          json: options.json,
          envelope: options.envelope,
          humanFormatter: () => renderProjectDetail(info),
          context,
        });
        return;
      }

      // 2. 远端服务目标分支
      const target = resolveTarget({
        profile: options.profile,
        server: options.server,
        token: options.token,
      });

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

        if (options.json) {
          renderResult(remoteInfo, {
            json: true,
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

      // 3. 本地注册表树状图分支
      if (options.tree) {
        const status = getRegistryStatus();
        renderResult(status, {
          json: options.json,
          envelope: options.envelope,
          humanFormatter: () => renderRegistryTree(status),
          context,
        });
        return;
      }

      // 4. 显式指定 Package 参数分支
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

      // 5. 扫描本地候选包（当前工程根目录 + 全局已链接包）
      const currentRoot = findProjectRoot();
      const linkedList = listLinkedPackages();
      const aggregated: AggregatedPackage[] = [];
      const seenPaths = new Set<string>();

      if (currentRoot) {
        try {
          const config = loadProjectConfig(currentRoot);
          const actions = await loadActions(currentRoot, config.actionsDir);
          const playbooks = loadPlaybooks(currentRoot, config.playbooksDir);
          aggregated.push({
            id: config.id,
            name: config.name,
            version: config.version,
            description: config.description,
            path: currentRoot,
            actionsCount: actions.size,
            playbooksCount: playbooks.size,
            actions: Array.from(actions.keys()),
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
          const actions = await loadActions(pkg.path, config.actionsDir);
          const playbooks = loadPlaybooks(pkg.path, config.playbooksDir);

          aggregated.push({
            id: config.id,
            name: config.name,
            version: config.version,
            description: config.description,
            path: pkg.path,
            actionsCount: actions.size,
            playbooksCount: playbooks.size,
            actions: Array.from(actions.keys()),
            playbooks: Array.from(playbooks.keys()),
            configDeclared: config.config ? Object.keys(config.config) : [],
          });
          seenPaths.add(pkg.path);
        } catch {
          // 忽略失效链接
        }
      }

      // 6. 无关键字过滤场景
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

      // 7. 有关键字过滤场景
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
        if (!shouldFallback) {
          if (options.json) {
            renderResult({ linkedPackages: [] }, { json: true, envelope: options.envelope, context });
          }
          throw new ExecutionError(`No packages matched intent '${effectiveIntent}'`);
        }

        renderResult(
          { linkedPackages: filterRes.items, isFallback: true },
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

      // 精确匹配单个包：直接展开其完整项目详情
      if (filterRes.matchedCount === 1 && !filterRes.isFallback) {
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
