import type { Command } from "commander";
import { registerServeCommand as registerRuntimeServeCommand } from "@actiondock/runtime-cli";

export function registerServeCommand(program: Command): void {
  registerRuntimeServeCommand(program);
}
