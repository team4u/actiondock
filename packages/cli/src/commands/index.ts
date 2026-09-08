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
    .version("2.0.11-beta.0", "-v, --version");

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

  applyCommonOptions(program);

  return program;
}
