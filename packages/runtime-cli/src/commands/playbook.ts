import { existsSync } from "node:fs";
import {
  fetchRemotePlaybooks,
  fetchRemotePlaybookShow,
  filterWithFallbackInfo,
  findProjectRoot,
  listLinkedPackages,
  loadActions,
  loadManifest,
  loadPlaybooks,
  loadProjectConfig,
  resolveActionProject,
  resolvePackageRoot,
  resolvePlaybookProject,
  resolveTarget,
  type PlaybookDefinition,
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
      const isMachine = Boolean(options.json || options.envelope);

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
      let targetRoot: string | null = null;
      if (options.package) {
        targetRoot = resolvePackageRoot(options.package);
        if (!targetRoot) {
          throw new ArgumentError(
            `Package '${options.package}' not found in linked packages or path`
          );
        }
      } else {
        targetRoot = findProjectRoot();
      }

      if (targetRoot) {
        const config = loadProjectConfig(targetRoot);
        const playbooks = loadPlaybooks(targetRoot, config.playbooksDir);
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

        if (filterRes.isFallback && isMachine) {
          renderResult(
            { items: filterRes.items, isFallback: true, matchedCount: 0 },
            { json: options.json, envelope: options.envelope, context }
          );
          return;
        }

        renderResult(filterRes.items, {
          json: options.json,
          envelope: options.envelope,
          humanFormatter: () =>
            renderPlaybookList(
              filterRes.items,
              `Playbooks in ${config.id} (${targetRoot})`,
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
          // 忽略破损的链接包
        }
      }

      let filteredPackages: typeof aggregated = [];
      let isFallback = false;
      if (!effectiveIntent) {
        filteredPackages = aggregated;
      } else {
        for (const pkg of aggregated) {
          const pkgMatches = filterWithFallbackInfo(
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
          isFallback = true;
        }
      }

      if (isFallback && isMachine) {
        renderResult(
          { packages: filteredPackages, isFallback: true, matchedCount: 0 },
          { json: options.json, envelope: options.envelope, context }
        );
        return;
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
    .option("-P, --package <id>", "Target package ID or path")
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
        throw new ArgumentError(`Playbook '${id}' not found in standalone package`);
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

      let showTarget = id;
      if (options.package && !id.includes("/") && !id.includes(":")) {
        const pkgRoot = resolvePackageRoot(options.package);
        if (!pkgRoot) {
          throw new ArgumentError(
            `Package '${options.package}' not found in linked packages or path`
          );
        }
        showTarget = `${options.package}/${id}`;
      }

      let resolved;
      try {
        resolved = resolvePlaybookProject(showTarget);
      } catch (err: any) {
        if (err.message?.includes("not found") || err.message?.includes("no longer exists")) {
          throw new ArgumentError(err.message);
        }
        throw new ExecutionError(err.message);
      }

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

  // playbook validate
  pbCmd
    .command("validate [id]")
    .description("Validate playbook format and action references (in current project or linked packages)")
    .option("-P, --package <id>", "Target package ID or path")
    .option("--json", "Output as JSON")
    .option("--envelope", "Wrap JSON output in standard envelope")
    .action(async (id: string | undefined, rawOptions: any, cmd: any) => {
      const options = getEffectiveOptions(rawOptions, cmd);
      if (context?.standalone) {
        renderResult(
          { valid: true, results: [] },
          {
            json: options.json,
            envelope: options.envelope,
            humanFormatter: () => "No playbooks to validate in standalone mode.",
            context,
          }
        );
        return;
      }

      let root: string | null = null;
      if (options.package) {
        root = resolvePackageRoot(options.package);
        if (!root) {
          throw new ArgumentError(
            `Package '${options.package}' not found in linked packages or path`
          );
        }
      } else {
        root = findProjectRoot();
      }

      const targets: Array<{ root: string; packageId: string; playbooks: PlaybookDefinition[] }> = [];

      if (root) {
        const config = loadProjectConfig(root);
        const playbooks = loadPlaybooks(root, config.playbooksDir);
        if (id) {
          const pb = playbooks.get(id);
          if (!pb) {
            throw new ArgumentError(`Playbook '${id}' not found in package '${config.id}'`);
          }
          targets.push({ root, packageId: config.id, playbooks: [pb] });
        } else {
          targets.push({ root, packageId: config.id, playbooks: Array.from(playbooks.values()) });
        }
      } else if (id) {
        let resolved;
        try {
          resolved = resolvePlaybookProject(id);
        } catch (err: any) {
          throw new ArgumentError(err.message);
        }
        targets.push({
          root: resolved.projectRoot,
          packageId: resolved.packageId,
          playbooks: [resolved.playbook],
        });
      } else {
        // Outside project: validate all linked packages
        const linkedList = listLinkedPackages();
        if (linkedList.length === 0) {
          throw new ArgumentError("Not in an ActionDock project, and no packages linked.");
        }
        for (const pkg of linkedList) {
          if (!existsSync(pkg.path)) continue;
          try {
            const config = loadProjectConfig(pkg.path);
            const playbooks = loadPlaybooks(pkg.path, config.playbooksDir);
            targets.push({
              root: pkg.path,
              packageId: pkg.id,
              playbooks: Array.from(playbooks.values()),
            });
          } catch {}
        }
      }

      const results: Array<{ id: string; packageId: string; valid: boolean; warnings: string[]; errors: string[] }> = [];

      for (const target of targets) {
        const config = loadProjectConfig(target.root);
        let actionIds = new Set<string>();
        let manifest = null;
        try {
          manifest = loadManifest(target.root);
        } catch {
          // Ignore invalid manifest and fall back to loadActions
        }
        if (manifest?.actions) {
          actionIds = new Set(Object.keys(manifest.actions));
        } else {
          try {
            const actions = await loadActions(target.root, config.actionsDir, { autoInstall: false });
            actionIds = new Set(actions.keys());
          } catch {
            // Ignore action loading failure during validation
          }
        }

        for (const pb of target.playbooks) {
          if (!pb) continue;
          const errors: string[] = [];
          const warnings: string[] = [];

          if (!pb.id) errors.push("Missing playbook id");
          if (!pb.content) warnings.push("Playbook content is empty");

          if (pb.actions) {
            for (const actId of pb.actions) {
              if (actionIds.has(actId)) {
                continue;
              }
              try {
                await resolveActionProject(actId, target.root);
              } catch (err: any) {
                warnings.push(err.message);
              }
            }
          }

          results.push({
            id: pb.id,
            packageId: target.packageId,
            valid: errors.length === 0,
            warnings,
            errors,
          });
        }
      }

      const allValid = results.every((r) => r.valid);
      renderResult(
        { valid: allValid, results },
        {
          json: options.json,
          envelope: options.envelope,
          humanFormatter: () => {
            const lines: string[] = [];
            for (const r of results) {
              const prefix = targets.length > 1 || !root ? `[${r.packageId}] ` : "";
              if (r.valid) {
                const warn = r.warnings.length > 0 ? ` (Warnings: ${r.warnings.join("; ")})` : "";
                lines.push(`[OK] ${prefix}${r.id}: Valid${warn}`);
              } else {
                lines.push(`[FAIL] ${prefix}${r.id}: ${r.errors.join("; ")}`);
              }
            }
            return lines.join("\n");
          },
          context,
        }
      );
      if (!allValid) {
        process.exitCode = 1;
      }
    });
}
