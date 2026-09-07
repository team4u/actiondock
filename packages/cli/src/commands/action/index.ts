import type { Command } from "commander";
import { registerActionCreateCommand } from "./create";
import { registerActionListCommand } from "./list";
import { executeAction, registerActionRunCommand } from "./run";
import { registerActionShowCommand } from "./show";
import { registerActionSyncCommand } from "./sync";
import { registerActionValidateCommand } from "./validate";

export { executeAction };

/**
 * 注册 Action 相关的 CLI 命令集合（包括 list, describe, run, create, sync, validate 以及顶层 run 别名）。
 * 
 * @param program Commander 根程序对象
 */
export function registerActionCommands(program: Command): void {
  const actionCmd = program
    .command("action")
    .description("Manage and execute Actions");

  registerActionListCommand(actionCmd);
  registerActionCreateCommand(actionCmd);
  registerActionSyncCommand(actionCmd);
  registerActionShowCommand(actionCmd);
  registerActionValidateCommand(actionCmd);
  registerActionRunCommand(actionCmd, program);
}
