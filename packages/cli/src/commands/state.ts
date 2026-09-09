import type { Command } from "commander";
import { registerStateCommands as registerRuntimeStateCommands } from "@actiondock/runtime-cli";

export function registerStateCommands(program: Command): void {
  registerRuntimeStateCommands(program);
}
