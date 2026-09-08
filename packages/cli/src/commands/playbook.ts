import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
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
} from "@actiondock/core";
import type { PlaybookDefinition } from "@actiondock/core";
import { Command } from "commander";
import {
  ArgumentError,
  CliError,
  ExecutionError,
  getEffectiveOptions,
  renderResult,
} from "@actiondock/runtime-cli";
import { resolveIntent } from "../utils/filter";

export function registerPlaybookCommands(program: Command): void {
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
    .option("--fallback", "Enable fallback to full list when no items match intent")
    .option("--no-fallback", "Disable fallback to full list when no items match intent")
    .option("--json", "Output as JSON")
    .option("--envelope", "Wrap JSON output in standard envelope")
    .action(async (patterns, rawOptions, cmd) => {
      try {
        const options = getEffectiveOptions(rawOptions, cmd);
        const effectiveIntent = resolveIntent(options.intent, patterns);
        const isMachine = Boolean(options.json || options.envelope);
        const fallbackExplicit = options.fallback === true || (Array.isArray(process.argv) && process.argv.includes("--fallback"));
        const shouldFallback = isMachine ? fallbackExplicit : options.fallback !== false;

        const target = resolveTarget({
          profile: options.profile,
          server: options.server,
          token: options.token,
        });

        if (target.type === "remote") {
          let remotePbs = await fetchRemotePlaybooks(target.serverUrl!, target.token, {
            intent: effectiveIntent,
            package: options.package,
          });

          let isFallback = false;
          if (remotePbs.length === 0 && effectiveIntent && shouldFallback) {
            remotePbs = await fetchRemotePlaybooks(target.serverUrl!, target.token, {
              package: options.package,
            });
            isFallback = true;
          }

          if (isFallback && isMachine) {
            renderResult(
              { items: remotePbs, isFallback: true, matchedCount: 0 },
              { json: options.json, envelope: options.envelope }
            );
            return;
          }

          renderResult(remotePbs, {
            json: options.json,
            envelope: options.envelope,
            humanFormatter: () => {
              const lines = [
                `Playbooks on remote server ${target.serverUrl}${target.profileName ? ` (Profile: ${target.profileName})` : ""}:\n`,
              ];
              if (isFallback && effectiveIntent) {
                lines.push(`(No remote playbooks matched intent '${effectiveIntent}', showing all playbooks)\n`);
              }
              if (remotePbs.length === 0) {
                lines.push("  (No playbooks found)");
              } else {
                for (const p of remotePbs) {
                  lines.push(`  ${p.id.padEnd(24)} ${p.description} (Package: ${p.packageId})`);
                }
              }
              return lines.join("\n");
            },
          });
          return;
        }

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
              { json: options.json, envelope: options.envelope }
            );
            return;
          }

          renderResult(filterRes.items, {
            json: options.json,
            envelope: options.envelope,
            humanFormatter: () => {
              const lines = [`Playbooks in ${config.id} (${targetRoot}):\n`];
              if (filterRes.isFallback && effectiveIntent) {
                lines.push(`(No playbooks matched intent '${effectiveIntent}', showing all playbooks)\n`);
              }
              for (const p of filterRes.items) {
                lines.push(`  ${p.id.padEnd(24)} ${p.description}`);
              }
              return lines.join("\n");
            },
          });
          return;
        }
        // List playbooks across all linked packages
        const linkedList = listLinkedPackages();
        if (linkedList.length === 0) {
          renderResult([], {
            json: options.json,
            envelope: options.envelope,
            humanFormatter: () =>
              "No ActionDock project in current directory, and no packages linked.\nRun 'ad link' inside an Action package to register it.",
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
            // Ignore broken linked package
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
            { json: options.json, envelope: options.envelope }
          );
          return;
        }

        renderResult(filteredPackages, {
          json: options.json,
          envelope: options.envelope,
          humanFormatter: () => {
            const lines = ["Playbooks in Linked Packages:\n"];
            for (const pkg of filteredPackages) {
              lines.push(`* Package: ${pkg.packageId} (${pkg.path})`);
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
        });
      } catch (err: any) {
        if (err instanceof ArgumentError || err instanceof CliError) throw err;
        throw new ExecutionError(err.message);
      }
    });

  // playbook create / new
  pbCmd
    .command("create <id>")
    .alias("new")
    .description("Scaffold a new Playbook markdown file")
    .option("-d, --desc <description>", "Playbook description")
    .option("-a, --actions <actions...>", "Referenced action IDs")
    .option("-f, --file <filePath>", "Target file path relative to playbooks dir")
    .action((id, options) => {
      const root = findProjectRoot();
      if (!root) {
        throw new ExecutionError("Not in an ActionDock project (actiondock.json not found)");
      }
      try {
        const config = loadProjectConfig(root);
        const pbDir = resolve(root, config.playbooksDir || "playbooks");
        if (!existsSync(pbDir)) {
          mkdirSync(pbDir, { recursive: true });
        }

        const cleanName = id.replace(/[^a-zA-Z0-9-_]/g, "-");
        const targetRelFile = options.file || `${cleanName}.md`;
        const targetFullFile = resolve(pbDir, targetRelFile);

        if (existsSync(targetFullFile)) {
          throw new ExecutionError(`File '${targetFullFile}' already exists`);
        }

        mkdirSync(dirname(targetFullFile), { recursive: true });

        const desc = options.desc || `SOP guide for ${id}`;
        const actionsList = Array.isArray(options.actions) ? options.actions : [];
        const actionsYaml =
          actionsList.length > 0
            ? `actions:\n${actionsList.map((a: string) => `  - ${a}`).join("\n")}\n`
            : "actions: []\n";

        const template = `---
id: ${id}
description: ${desc}
${actionsYaml}---

# ${id.replace(/[-_]/g, " ").replace(/\b\w/g, (c: string) => c.toUpperCase())} SOP

This playbook provides task execution guidance for AI Agents.

## Instructions

1. Inspect available actions with \`<binary> list --json\`.
2. Follow the required steps to complete the task.
`;

        writeFileSync(targetFullFile, template, "utf-8");
        console.log(`[OK] Created Playbook '${id}' at ${targetFullFile}`);
      } catch (err: any) {
        if (err instanceof CliError) {
          throw err;
        }
        throw new ExecutionError(err.message);
      }
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
    .action(async (id, rawOptions, cmd) => {
      try {
        const options = getEffectiveOptions(rawOptions, cmd);
        if (!id) {
          throw new ArgumentError("Playbook ID is required for show");
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
            humanFormatter: () => {
              const lines = [`Playbook:    ${pb.id} (Package: ${pb.packageId})`];
              if (pb.description) lines.push(`Description: ${pb.description}`);
              if (pb.actions && pb.actions.length > 0) {
                lines.push(`Actions:     ${pb.actions.join(", ")}`);
              }
              if (pb.filePath) lines.push(`File:        ${pb.filePath}\n`);
              lines.push("--- Content ---", pb.content);
              return lines.join("\n");
            },
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
          humanFormatter: () => {
            const lines = [`Playbook:    ${pb.id} (Package: ${resolved.packageId})`];
            if (pb.description) lines.push(`Description: ${pb.description}`);
            if (pb.actions && pb.actions.length > 0) {
              lines.push(`Actions:     ${pb.actions.join(", ")}`);
            }
            if (pb.filePath) lines.push(`File:        ${pb.filePath}\n`);
            lines.push("--- Content ---", pb.content);
            return lines.join("\n");
          },
        });
      } catch (err: any) {
        if (err instanceof ArgumentError || err instanceof CliError) throw err;
        throw new ExecutionError(err.message);
      }
    });

  // playbook validate
  pbCmd
    .command("validate [id]")
    .description("Validate playbook format and action references (in current project or linked packages)")
    .option("-P, --package <id>", "Target package ID or path")
    .option("--json", "Output as JSON")
    .option("--envelope", "Wrap JSON output in standard envelope")
    .action(async (id, rawOptions, cmd) => {
      try {
        const options = getEffectiveOptions(rawOptions, cmd);
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
          const resolved = resolvePlaybookProject(id);
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
          const manifest = loadManifest(target.root);
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
          }
        );
        if (!allValid) process.exitCode = 1;
      } catch (err: any) {
        if (err instanceof ArgumentError || err instanceof CliError) {
          throw err;
        }
        throw new ExecutionError(err.message);
      }
    });
}

