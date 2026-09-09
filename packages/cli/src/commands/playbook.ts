import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { findProjectRoot, loadProjectConfig } from "@actiondock/core";
import { Command } from "commander";
import {
  CliError,
  ExecutionError,
  registerPlaybookCommands as registerRuntimePlaybookCommands,
} from "@actiondock/runtime-cli";

/**
 * 注册 Playbook 命令集合。
 * 委托 list, show, validate 至 @actiondock/runtime-cli，保留开发者专用的 create 命令。
 */
export function registerPlaybookCommands(program: Command): void {
  // 1. 委托运行时核心 Playbook 命令至 @actiondock/runtime-cli (list, show, validate)
  registerRuntimePlaybookCommands(program);

  // 2. 获取已注册的 playbook 命令组并追加开发者专用命令
  const pbCmd =
    program.commands.find((c) => c.name() === "playbook") ||
    program.command("playbook");

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
}

