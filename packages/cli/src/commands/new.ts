import type { Command } from "commander";
import type { CliContext } from "../types";
import { handleActionCreate } from "./action/create";
import { handlePlaybookCreate } from "./playbook";

/**
 * 注册顶层 new 脚手架命令（new action, new playbook）。
 * 
 * @param program Commander 根程序对象
 * @param context 命令行上下文
 */
export function registerNewCommands(program: Command, context?: CliContext): void {
  const newCmd = program
    .command("new")
    .description("Scaffold a new Action or Playbook in current project");

  // new action <id>
  newCmd
    .command("action <id>")
    .alias("create")
    .description("Scaffold a new Action definition file")
    .option("-d, --desc <description>", "Action description")
    .option("-f, --file <filePath>", "Target file path relative to actions dir")
    .action(async (id, options) => {
      await handleActionCreate(id, options, context);
    });

  // new playbook <id>
  newCmd
    .command("playbook <id>")
    .description("Scaffold a new Playbook markdown file")
    .option("-d, --desc <description>", "Playbook description")
    .option("-a, --actions <actions...>", "Referenced action IDs")
    .option("-f, --file <filePath>", "Target file path relative to playbooks dir")
    .action((id, options) => {
      handlePlaybookCreate(id, options, context);
    });
}
