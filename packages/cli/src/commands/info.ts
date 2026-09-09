import type { Command } from "commander";
import { registerInfoCommand as registerRuntimeInfoCommand } from "@actiondock/runtime-cli";

export function registerInfoCommand(program: Command): void {
  registerRuntimeInfoCommand(program);
}
