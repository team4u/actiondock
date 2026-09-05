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
  resolvePlaybookProject,
  resolveTarget,
} from "@actiondock/core";
import type { PlaybookDefinition } from "@actiondock/core";
import { Command } from "commander";
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
    .option("--no-fallback", "Disable fallback to full list when no items match intent")
    .option("--json", "Output as JSON")
    .action(async (patterns, options) => {
      try {
        const effectiveIntent = resolveIntent(options.intent, patterns);
        const shouldFallback = options.fallback !== false;

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
          if (options.json) {
            console.log(JSON.stringify(remotePbs, null, 2));
            return;
          }
          console.log(
            `Playbooks on remote server ${target.serverUrl}${target.profileName ? ` (Profile: ${target.profileName})` : ""}:\n`
          );
          if (remotePbs.length === 0) {
            console.log("  (No playbooks found)");
          } else {
            for (const p of remotePbs) {
              console.log(`  ${p.id.padEnd(24)} ${p.description} (Package: ${p.packageId})`);
            }
          }
          return;
        }

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

          if (options.json) {
            console.log(JSON.stringify(filterRes.items, null, 2));
          } else {
            console.log(`Playbooks in ${config.id} (${root}):\n`);
            if (filterRes.isFallback && effectiveIntent) {
              console.log(`(No playbooks matched intent '${effectiveIntent}', showing all playbooks)\n`);
            }
            for (const p of filterRes.items) {
              console.log(`  ${p.id.padEnd(24)} ${p.description}`);
            }
          }
        } else {
          // List playbooks across all linked packages
          const linkedList = listLinkedPackages();
          if (linkedList.length === 0) {
            console.log("No ActionDock project in current directory, and no packages linked.");
            console.log("Run 'ad link' inside an Action package to register it.");
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
            }
          }

          if (options.json) {
            console.log(JSON.stringify(filteredPackages, null, 2));
          } else {
            console.log("Playbooks in Linked Packages:\n");
            for (const pkg of filteredPackages) {
              console.log(`* Package: ${pkg.packageId} (${pkg.path})`);
              if (pkg.playbooks.length === 0) {
                console.log("    (No playbooks)");
              } else {
                for (const p of pkg.playbooks) {
                  console.log(`    - ${p.id.padEnd(26)} ${p.description}`);
                }
              }
            }
          }
        }
      } catch (err: any) {
        console.error(`Error: ${err.message}`);
        process.exit(1);
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
        console.error("Error: Not in an ActionDock project (actiondock.json not found)");
        process.exit(1);
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
          console.error(`Error: File '${targetFullFile}' already exists`);
          process.exit(1);
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
        console.error(`Error: ${err.message}`);
        process.exit(1);
      }
    });

  // playbook show
  pbCmd
    .command("show <id>")
    .description("Show playbook content and metadata (from current project or linked packages)")
    .option("-p, --profile <name>", "Query against a specific profile")
    .option("-s, --server <url>", "Remote server URL")
    .option("-t, --token <token>", "Auth token for remote server")
    .option("--json", "Output as JSON")
    .action(async (id, options) => {
      try {
        const target = resolveTarget({
          profile: options.profile,
          server: options.server,
          token: options.token,
        });

        if (target.type === "remote") {
          const pb = await fetchRemotePlaybookShow(target.serverUrl!, id, target.token);
          if (options.json) {
            console.log(JSON.stringify(pb, null, 2));
            return;
          }
          console.log(`Playbook:    ${pb.id} (Package: ${pb.packageId})`);
          if (pb.description) console.log(`Description: ${pb.description}`);
          if (pb.actions && pb.actions.length > 0) {
            console.log(`Actions:     ${pb.actions.join(", ")}`);
          }
          if (pb.filePath) console.log(`File:        ${pb.filePath}\n`);
          console.log("--- Content ---");
          console.log(pb.content);
          return;
        }

        const resolved = resolvePlaybookProject(id);
        const pb = resolved.playbook;

        if (options.json) {
          console.log(JSON.stringify({ ...pb, packageId: resolved.packageId }, null, 2));
        } else {
          console.log(`Playbook:    ${pb.id} (Package: ${resolved.packageId})`);
          if (pb.description) console.log(`Description: ${pb.description}`);
          if (pb.actions && pb.actions.length > 0) {
            console.log(`Actions:     ${pb.actions.join(", ")}`);
          }
          console.log(`File:        ${pb.filePath}\n`);
          console.log("--- Content ---");
          console.log(pb.content);
        }
      } catch (err: any) {
        console.error(`Error: ${err.message}`);
        process.exit(1);
      }
    });

  // playbook validate
  pbCmd
    .command("validate [id]")
    .description("Validate playbook format and action references (in current project or linked packages)")
    .option("--json", "Output as JSON")
    .action(async (id, options) => {
      try {
        const root = findProjectRoot();
        const targets: Array<{ root: string; packageId: string; playbooks: PlaybookDefinition[] }> = [];

        if (root) {
          const config = loadProjectConfig(root);
          const playbooks = loadPlaybooks(root, config.playbooksDir);
          if (id) {
            const pb = playbooks.get(id);
            if (!pb) {
              console.error(`Error: Playbook '${id}' not found in current project`);
              process.exit(1);
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
            console.error("Error: Not in an ActionDock project, and no packages linked.");
            process.exit(1);
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
        if (options.json) {
          console.log(JSON.stringify({ valid: allValid, results }, null, 2));
        } else {
          for (const r of results) {
            const prefix = targets.length > 1 || !root ? `[${r.packageId}] ` : "";
            if (r.valid) {
              const warn = r.warnings.length > 0 ? ` (Warnings: ${r.warnings.join("; ")})` : "";
              console.log(`[OK] ${prefix}${r.id}: Valid${warn}`);
            } else {
              console.log(`[FAIL] ${prefix}${r.id}: ${r.errors.join("; ")}`);
            }
          }
        }
        if (!allValid) process.exit(1);
      } catch (err: any) {
        console.error(`Error: ${err.message}`);
        process.exit(1);
      }
    });
}

