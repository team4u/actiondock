import type { Command } from "commander";
import { registerRunsCommands as registerRuntimeRunsCommands } from "@actiondock/runtime-cli";

export function registerRunsCommands(program: Command): void {
  registerRuntimeRunsCommands(program);
}
