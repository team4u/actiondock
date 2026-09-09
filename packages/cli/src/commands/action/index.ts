import type { Command } from "commander";
import {
  executeAction,
  registerActionCommands as registerRuntimeActionCommands,
} from "@actiondock/runtime-cli";
import { registerActionCreateCommand } from "./create";
import { registerActionSyncCommand } from "./sync";

export { executeAction };
export { registerActionCreateCommand } from "./create";
export { registerActionSyncCommand } from "./sync";
export { registerActionListCommand } from "./list";
export { registerActionShowCommand } from "./show";
export { registerActionValidateCommand } from "./validate";
export { registerActionRunCommand } from "./run";

/**
 * 注册 Action 相关的 CLI 命令集合。
 * 委托 list, show, validate, run 至 @actiondock/runtime-cli，保留开发者专用的 create 与 sync 命令。
 * 
 * @param program Commander 根程序对象
 */
export function registerActionCommands(program: Command): void {
  // 1. 委托运行时核心 Action 命令至 @actiondock/runtime-cli (list, show, validate, run 及顶层 run)
  registerRuntimeActionCommands(program);

  // 2. 获取已注册的 action 命令组并追加开发者专用命令
  const actionCmd =
    program.commands.find((c) => c.name() === "action") ||
    program.command("action");

  registerActionCreateCommand(actionCmd);
  registerActionSyncCommand(actionCmd);
}
