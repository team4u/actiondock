import { Command } from "commander";
import { registerAddCommand } from "./add";
import { registerBuildCommand } from "./build";
import { registerConfigCommands } from "./config";
import { registerDescribeCommand } from "./describe";
import { registerDoctorCommand } from "./doctor";
import { registerExportCommand } from "./export";
import { registerGenerateCommands } from "./generate";
import { registerInfoCommand } from "./info";
import { registerInitCommand } from "./init";
import { registerLinkCommands } from "./link";
import { registerListCommand } from "./list";
import { registerMcpCommands } from "./mcp";
import { registerNewCommands } from "./new";
import { registerPackCommand } from "./pack";
import { registerPlaybookCommands } from "./playbook";
import { registerProfileCommands } from "./profile";
import { registerRemoveCommand } from "./remove";
import { registerRunCommand } from "./run";
import { registerRunsCommands } from "./runs";
import { registerServeCommand } from "./serve";
import { registerStateCommands } from "./state";
import { registerTestCommand } from "./test";
import { registerValidateCommand } from "./validate";

function applyCommonOptions(cmd: Command): void {
  const hasOpt = (flagName: string) =>
    cmd.options.some((o) => o.name() === flagName || o.long === `--${flagName}`);

  if (!hasOpt("json")) {
    cmd.option("--json", "Output as JSON");
  }
  if (!hasOpt("envelope")) {
    cmd.option("--envelope", "Wrap JSON output in standard envelope");
  }
  if (!hasOpt("dataDir") && !hasOpt("data-dir")) {
    cmd.option("--data-dir <path>", "Custom database storage directory");
  }

  for (const sub of cmd.commands) {
    applyCommonOptions(sub);
  }
}

export function createCliProgram(): Command {
  const program = new Command();

  program
    .name("ad")
    .description("ActionDock (ad) 2.0 - Toolchain for building and shipping standalone AI Agent Actions & Skills")
    .version("2.2.0", "-v, --version");

  program.option("-V", "output the version number");
  program.on("option:V", () => {
    (program as any)._outputConfiguration.writeOut(`${program.version()}\n`);
    (program as any)._exit(0, "commander.version", program.version()!);
  });

  // 禁用 Commander 内部直接 process.exit，统一由顶层调度器管控退出码
  program.exitOverride((err) => {
    throw err;
  });

  registerInitCommand(program);
  registerAddCommand(program);
  registerRemoveCommand(program);
  registerNewCommands(program);
  registerInfoCommand(program);
  registerDoctorCommand(program);
  registerListCommand(program);
  registerDescribeCommand(program);
  registerRunCommand(program);
  registerValidateCommand(program);
  registerGenerateCommands(program);
  registerPlaybookCommands(program);
  registerConfigCommands(program);
  registerStateCommands(program);
  registerRunsCommands(program);
  registerTestCommand(program);
  registerBuildCommand(program);
  registerPackCommand(program);
  registerExportCommand(program);
  registerLinkCommands(program);
  registerProfileCommands(program);
  registerServeCommand(program);
  registerMcpCommands(program);

  applyCommonOptions(program);

  return program;
}

export {
  registerAddCommand,
  registerBuildCommand,
  registerConfigCommands,
  registerDescribeCommand,
  registerDoctorCommand,
  registerExportCommand,
  registerGenerateCommands,
  registerInfoCommand,
  registerInitCommand,
  registerLinkCommands,
  registerListCommand,
  registerMcpCommands,
  registerNewCommands,
  registerPackCommand,
  registerPlaybookCommands,
  registerProfileCommands,
  registerRemoveCommand,
  registerRunCommand,
  registerRunsCommands,
  registerServeCommand,
  registerStateCommands,
  registerTestCommand,
  registerValidateCommand,
};
