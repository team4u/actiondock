import { Command } from "commander";
import { registerActionCommands } from "./action";
import { registerBuildCommand } from "./build";
import { registerConfigCommands } from "./config";
import { registerDoctorCommand } from "./doctor";
import { registerExportCommand } from "./export";
import { registerInfoCommand } from "./info";
import { registerInitCommand } from "./init";
import { registerLinkCommands } from "./link";
import { registerMcpCommands } from "./mcp";
import { registerPlaybookCommands } from "./playbook";
import { registerProfileCommands } from "./profile";
import { registerRunsCommands } from "./runs";
import { registerServeCommand } from "./serve";
import { registerStateCommands } from "./state";
import { registerTestCommand } from "./test";

export function createCliProgram(): Command {
  const program = new Command();

  program
    .name("ad")
    .description("ActionDock (ad) 2.0 - Toolchain for building and shipping standalone AI Agent Actions & Skills")
    .version("2.0.1");

  registerInitCommand(program);
  registerInfoCommand(program);
  registerDoctorCommand(program);
  registerActionCommands(program);
  registerPlaybookCommands(program);
  registerConfigCommands(program);
  registerStateCommands(program);
  registerRunsCommands(program);
  registerTestCommand(program);
  registerBuildCommand(program);
  registerExportCommand(program);
  registerLinkCommands(program);
  registerProfileCommands(program);
  registerServeCommand(program);
  registerMcpCommands(program);

  return program;
}
