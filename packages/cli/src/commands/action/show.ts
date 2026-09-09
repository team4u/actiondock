import type { Command } from "commander";
import { registerActionCommands } from "@actiondock/runtime-cli";

/**
 * @deprecated 核心逻辑已统一下沉至 @actiondock/runtime-cli
 */
export function registerActionShowCommand(actionCmd: Command): void {
  const rootProgram = actionCmd.parent || actionCmd;
  registerActionCommands(rootProgram);
}
