import type { Command } from "commander";
import { registerMcpCommands as registerRuntimeMcpCommands } from "@actiondock/runtime-cli";

export function registerMcpCommands(program: Command): void {
  registerRuntimeMcpCommands(program);
}
