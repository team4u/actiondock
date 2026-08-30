import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import {
  findProjectRoot,
  loadActions,
  loadPlaybooks,
  loadProjectConfig,
} from "@actiondock/core";
import { Command } from "commander";

export function registerPlaybookCommands(program: Command): void {
  const pbCmd = program
    .command("playbook")
    .description("Manage task Playbooks (Task SOPs for AI Agents)");

  // playbook list
  pbCmd
    .command("list")
    .description("List all playbooks in current project")
    .option("--json", "Output as JSON")
    .action((options) => {
      const root = findProjectRoot();
      if (!root) {
        console.error("Error: Not in an ActionDock project");
        process.exit(1);
      }
      try {
        const config = loadProjectConfig(root);
        const playbooks = loadPlaybooks(root, config.playbooksDir);
        const list = Array.from(playbooks.values()).map((p) => ({
          id: p.id,
          description: p.description || "",
          actions: p.actions || [],
          file: p.filePath,
        }));

        if (options.json) {
          console.log(JSON.stringify(list, null, 2));
        } else {
          console.log(`Playbooks in ${config.id}:\n`);
          for (const p of list) {
            console.log(`  ${p.id.padEnd(24)} ${p.description}`);
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
    .description("Show playbook content and metadata")
    .option("--json", "Output as JSON")
    .action((id, options) => {
      const root = findProjectRoot();
      if (!root) {
        console.error("Error: Not in an ActionDock project");
        process.exit(1);
      }
      try {
        const config = loadProjectConfig(root);
        const playbooks = loadPlaybooks(root, config.playbooksDir);
        const pb = playbooks.get(id);
        if (!pb) {
          console.error(`Error: Playbook '${id}' not found`);
          process.exit(1);
        }

        if (options.json) {
          console.log(JSON.stringify(pb, null, 2));
        } else {
          console.log(`Playbook:    ${pb.id}`);
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
    .description("Validate playbook format and action references")
    .option("--json", "Output as JSON")
    .action(async (id, options) => {
      const root = findProjectRoot();
      if (!root) {
        console.error("Error: Not in an ActionDock project");
        process.exit(1);
      }
      try {
        const config = loadProjectConfig(root);
        const playbooks = loadPlaybooks(root, config.playbooksDir);
        const actions = await loadActions(root, config.actionsDir);

        const targets = id ? [playbooks.get(id)].filter(Boolean) : Array.from(playbooks.values());
        if (id && targets.length === 0) {
          console.error(`Error: Playbook '${id}' not found`);
          process.exit(1);
        }

        const results: Array<{ id: string; valid: boolean; warnings: string[]; errors: string[] }> = [];

        for (const pb of targets) {
          if (!pb) continue;
          const errors: string[] = [];
          const warnings: string[] = [];

          if (!pb.id) errors.push("Missing playbook id");
          if (!pb.content) warnings.push("Playbook content is empty");

          if (pb.actions) {
            for (const actId of pb.actions) {
              if (!actions.has(actId)) {
                warnings.push(`Referenced action '${actId}' not found in project actions`);
              }
            }
          }

          results.push({
            id: pb.id,
            valid: errors.length === 0,
            warnings,
            errors,
          });
        }

        const allValid = results.every((r) => r.valid);
        if (options.json) {
          console.log(JSON.stringify({ valid: allValid, results }, null, 2));
        } else {
          for (const r of results) {
            if (r.valid) {
              const warn = r.warnings.length > 0 ? ` (Warnings: ${r.warnings.join("; ")})` : "";
              console.log(`[OK] ${r.id}: Valid${warn}`);
            } else {
              console.log(`[FAIL] ${r.id}: ${r.errors.join("; ")}`);
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
