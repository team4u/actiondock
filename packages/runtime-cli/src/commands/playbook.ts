import { existsSync } from "node:fs";
import {
  fetchRemotePlaybooks,
  fetchRemotePlaybookShow,
  filterWithFallbackInfo,
  findProjectRoot,
  listLinkedPackages,
  loadPlaybooks,
  loadProjectConfig,
  resolvePlaybookProject,
  resolveTarget,
} from "@actiondock/core";
import { Command } from "commander";
import { ArgumentError, ExecutionError } from "../errors";
import { renderPlaybookDetail, renderPlaybookList, renderResult } from "../renderer";
import type { RuntimeCliContext } from "../types";
import { getEffectiveOptions, resolveIntent } from "../utils";

/**
 * 注册 Playbook 任务指导手册命令（list、show）。
 * 
 * @param program Commander 实例
 * @param context 运行时上下文
 */
export function registerPlaybookCommands(program: Command, context?: RuntimeCliContext): void {
  const pbCmd = program
    .command("playbook")
    .description("Manage task Playbooks (Task SOPs for AI Agents)");

  // playbook list
  pbCmd
    .command("list [patterns...]")
    .description("List playbooks in current project or linked packages")
    .option("-i, --intent <pattern>", "Regex or fuzzy intent filter; falls back to full list when no match")
    .option("-P, --package <id>", "Target package ID or path")
    .option("-p, --profile <name>", "Query against a specific profile")
    .option("-s, --server <url>", "Remote server URL")
    .option("-t, --token <token>", "Auth token for remote server")
    .option("--no-fallback", "Disable fallback to full list when no items match intent")
    .option("--json", "Output as JSON")
    .option("--envelope", "Wrap JSON output in standard envelope")
    .action(async (patterns: string[] = [], rawOptions: any, cmd: any) => {
      const options = getEffectiveOptions(rawOptions, cmd);
      const effectiveIntent = resolveIntent(options.intent, patterns);
      const shouldFallback = options.fallback !== false;

      // 1. 独立运行模式
      if (context?.standalone) {
        renderResult([], {
          json: options.json,
          envelope: options.envelope,
          humanFormatter: () => renderPlaybookList([], "Playbooks", false, effectiveIntent),
          context,
        });
        return;
      }

      // 2. 远端服务分支
      const target = resolveTarget({
        profile: options.profile,
        server: options.server,
        token: options.token,
      });

      if (target.type === "remote") {
        const remotePbs = await fetchRemotePlaybooks(target.serverUrl!, target.token, {
          intent: effectiveIntent,
          package: options.package,
        });

        renderResult(remotePbs, {
          json: options.json,
          envelope: options.envelope,
          humanFormatter: () =>
            renderPlaybookList(
              remotePbs,
              `Playbooks on remote server ${target.serverUrl}${target.profileName ? ` (Profile: ${target.profileName})` : ""}`,
              false,
              effectiveIntent
            ),
          context,
        });
        return;
      }

      // 3. 本地工程模式
      const root = findProjectRoot();
      if (root) {
        const config = loadProjectConfig(root);
        const playbooks = loadPlaybooks(root, config.playbooksDir);
        const rawList = Array.from(playbooks.values()).map((p) => ({
          id: p.id,
          description: p.description || "",
          actions: p.actions || [],
          file: p.filePath,
          packageId: config.id,
        }));

        const filterRes = filterWithFallbackInfo(
          rawList,
          effectiveIntent,
          [(p) => p.id, (p) => p.description, (p) => p.actions, (p) => p.file],
          shouldFallback
        );

        renderResult(filterRes.items, {
          json: options.json,
          envelope: options.envelope,
          humanFormatter: () =>
            renderPlaybookList(
              filterRes.items,
              `Playbooks in ${config.id} (${root})`,
              filterRes.isFallback,
              effectiveIntent
            ),
          context,
        });
        return;
      }

      // 4. 扫描所有链接的包
      const linkedList = listLinkedPackages();
      if (linkedList.length === 0) {
        renderResult([], {
          json: options.json,
          envelope: options.envelope,
          humanFormatter: () =>
            "No ActionDock project in current directory, and no packages linked.\nRun 'ad link' inside an Action package to register it.",
          context,
        });
        return;
      }

      const aggregated: Array<{
        packageId: string;
        packageName: string;
        path: string;
        playbooks: Array<{
          id: string;
          description: string;
          actions: string[];
          file: string;
        }>;
      }> = [];

      for (const pkg of linkedList) {
        if (!existsSync(pkg.path)) continue;
        try {
          const config = loadProjectConfig(pkg.path);
          const playbooks = loadPlaybooks(pkg.path, config.playbooksDir);
          const pkgPlaybooks = Array.from(playbooks.values()).map((p) => ({
            id: p.id,
            description: p.description || "",
            actions: p.actions || [],
            file: p.filePath,
          }));

          aggregated.push({
            packageId: pkg.id,
            packageName: pkg.name,
            path: pkg.path,
            playbooks: pkgPlaybooks,
          });
        } catch {
          // 忽略失效链接
        }
      }

      let filteredPackages: typeof aggregated = [];
      if (!effectiveIntent) {
        filteredPackages = aggregated;
      } else {
        for (const pkg of aggregated) {
          const pkgMatches =
            filterWithFallbackInfo(
              [pkg],
              effectiveIntent,
              [(p) => p.packageId, (p) => p.packageName, (p) => p.path],
              false
            ).matchedCount > 0;

          if (pkgMatches) {
            filteredPackages.push(pkg);
          } else {
            const matchedPlaybooks = filterWithFallbackInfo(
              pkg.playbooks,
              effectiveIntent,
              [(p) => p.id, (p) => p.description, (p) => p.actions, (p) => p.file],
              false
            ).items;

            if (matchedPlaybooks.length > 0) {
              filteredPackages.push({
                ...pkg,
                playbooks: matchedPlaybooks,
              });
            }
          }
        }

        if (filteredPackages.length === 0 && shouldFallback) {
          filteredPackages = aggregated;
        }
      }

      renderResult(filteredPackages, {
        json: options.json,
        envelope: options.envelope,
        humanFormatter: () => {
          const lines: string[] = ["Playbooks in Linked Packages:\n"];
          for (const pkg of filteredPackages) {
            lines.push(`- Package: ${pkg.packageId} (${pkg.path})`);
            if (pkg.playbooks.length === 0) {
              lines.push("    (No playbooks)");
            } else {
              for (const p of pkg.playbooks) {
                lines.push(`    - ${p.id.padEnd(26)} ${p.description}`);
              }
            }
          }
          return lines.join("\n");
        },
        context,
      });
    });

  // playbook show
  pbCmd
    .command("show <id>")
    .description("Show playbook content and metadata (from current project or linked packages)")
    .option("-p, --profile <name>", "Query against a specific profile")
    .option("-s, --server <url>", "Remote server URL")
    .option("-t, --token <token>", "Auth token for remote server")
    .option("--json", "Output as JSON")
    .option("--envelope", "Wrap JSON output in standard envelope")
    .action(async (id: string, rawOptions: any, cmd: any) => {
      const options = getEffectiveOptions(rawOptions, cmd);
      if (!id) {
        throw new ArgumentError("Playbook ID is required for show");
      }

      if (context?.standalone) {
        throw new ExecutionError(`Playbook '${id}' not found in standalone package`);
      }

      const target = resolveTarget({
        profile: options.profile,
        server: options.server,
        token: options.token,
      });

      if (target.type === "remote") {
        const pb = await fetchRemotePlaybookShow(target.serverUrl!, id, target.token);
        renderResult(pb, {
          json: options.json,
          envelope: options.envelope,
          humanFormatter: () => renderPlaybookDetail(pb),
          context,
        });
        return;
      }

      const resolved = resolvePlaybookProject(id);
      const pb = resolved.playbook;
      const payload = { ...pb, packageId: resolved.packageId };

      renderResult(payload, {
        json: options.json,
        envelope: options.envelope,
        humanFormatter: () =>
          renderPlaybookDetail({
            id: pb.id,
            packageId: resolved.packageId,
            description: pb.description,
            actions: pb.actions,
            filePath: pb.filePath,
            content: pb.content,
          }),
        context,
      });
    });
}
