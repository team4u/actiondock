import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Command } from "commander";
import type { CliContext } from "../types";
import { registerActionCommands } from "./action/create";
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

/**
 * 读取 CLI 自身 package.json 的版本号（单一事实源）。
 * 兼容源码运行（src/commands）与构建产物运行（dist/commands）两种目录层级。
 */
function readCliVersion(): string {
  try {
    const pkgJson = JSON.parse(readFileSync(join(import.meta.dirname, "../../package.json"), "utf-8"));
    return (pkgJson && pkgJson.version) || "0.0.0";
  } catch {
    // package.json 缺失或损坏时回退占位版本，避免阻断启动
    return "0.0.0";
  }
}

/**
 * CLI 版本号（来自 package.json 单一事实源）。
 */
export const CLI_VERSION = readCliVersion();

/**
 * 递归注入全局通用选项。
 *
 * 输出纪律契约：--json/--envelope 对所有命令统一注入；已实现 renderResult
 * 数据输出的命令会消费它们，未实现机器输出的命令（init、link、test、new、
 * serve、mcp 等）将其作为无操作标志忽略，不影响人类输出行为。
 * 错误信封由顶层 main 的 renderError 统一兜底，与命令实现解耦。
 */
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

export function createCliProgram(context?: CliContext): Command {
  const program = new Command();

  program
    .name("ad")
    .description("ActionDock (ad) 2.0 - Toolchain for building and shipping standalone AI Agent Actions & Skills")
    .version(CLI_VERSION, "-v, --version");

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
  registerAddCommand(program, context);
  registerRemoveCommand(program, context);
  registerNewCommands(program, context);
  registerActionCommands(program, context);
  registerInfoCommand(program, context);
  registerDoctorCommand(program, context);
  registerListCommand(program, context);
  registerDescribeCommand(program, context);
  registerRunCommand(program, context);
  registerValidateCommand(program, context);
  registerGenerateCommands(program, context);
  registerPlaybookCommands(program, context);
  registerConfigCommands(program, context);
  registerStateCommands(program, context);
  registerRunsCommands(program, context);
  registerTestCommand(program);
  registerBuildCommand(program, context);
  registerPackCommand(program, context);
  registerExportCommand(program, context);
  registerLinkCommands(program);
  registerProfileCommands(program);
  registerServeCommand(program, context);
  registerMcpCommands(program, context);

  applyCommonOptions(program);

  return program;
}

export {
  registerActionCommands,
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
