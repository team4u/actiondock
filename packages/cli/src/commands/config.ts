import type { Command } from "commander";
import { registerConfigCommands as registerRuntimeConfigCommands } from "@actiondock/runtime-cli";

export function registerConfigCommands(program: Command): void {
  registerRuntimeConfigCommands(program);
}
