import type { Command } from "commander";
import { registerActionCreateCommand } from "./create";

export { registerActionCreateCommand } from "./create";

/**
 * 注册 Action 命令组（仅保留脚手架 create 命令；list/describe/run/validate 统一使用顶层命令）。
 * 
 * @param program Commander 根程序对象
 */
export function registerActionCommands(program: Command): void {
  const actionCmd =
    program.commands.find((c) => c.name() === "action") ||
    program.command("action").description("Action scaffolding commands");

  registerActionCreateCommand(actionCmd);
}
