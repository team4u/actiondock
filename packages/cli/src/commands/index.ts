import { Command } from "commander";
import { registerActionCommands } from "./action";
import { registerBuildCommand } from "./build";
import { registerConfigCommands } from "./config";
import { registerExportCommand } from "./export";
import { registerInfoCommand } from "./info";
import { registerInitCommand } from "./init";
import { registerPlaybookCommands } from "./playbook";
import { registerRunsCommands } from "./runs";
import { registerStateCommands } from "./state";
import { registerTestCommand } from "./test";

export function createCliProgram(): Command {
  const program = new Command();

  program
    .name("ac")
    .description("ActionDock (ac) 2.0 - Toolchain for building and shipping standalone AI Agent Actions & Skills")
    .version("2.0.0");

  registerInitCommand(program);
  registerInfoCommand(program);
  registerActionCommands(program);
  registerPlaybookCommands(program);
  registerConfigCommands(program);
  registerStateCommands(program);
  registerRunsCommands(program);
  registerTestCommand(program);
  registerBuildCommand(program);
  registerExportCommand(program);

  return program;
}
