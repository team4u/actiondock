import { Command } from "commander";
import { writeStdout } from "../renderer";
import type { RuntimeCliContext } from "../types";

/**
 * 注册 version 与 help 命令及相关元数据。
 * 
 * @param program Commander 实例
 * @param context 运行时上下文
 */
export function registerVersionHelpCommands(program: Command, context?: RuntimeCliContext): void {
  // 显式 version 命令
  program
    .command("version")
    .description("Display version information")
    .action(() => {
      if (context?.standalone) {
        writeStdout(`${context.standalone.packageId} v${context.standalone.version}`, context);
      } else {
        const ver = program.version() || "2.0.2";
        const name = program.name() || "ActionDock";
        writeStdout(`${name} v${ver}`, context);
      }
    });

  // 显式 help 命令
  program
    .command("help [command]")
    .description("Display help for command")
    .action((cmdName?: string) => {
      if (cmdName) {
        const sub = program.commands.find((c) => c.name() === cmdName || c.aliases().includes(cmdName));
        if (sub) {
          sub.outputHelp();
          return;
        }
      }

      if (context?.standalone) {
        const sa = context.standalone;
        const lines: string[] = [];
        lines.push(`${sa.packageId} (v${sa.version})`);
        if (sa.description) {
          lines.push(`${sa.description}\n`);
        }
        lines.push("Usage:");
        lines.push("  <binary> list [--json]                         List available actions");
        lines.push("  <binary> show <id> [--json]                    Show action details and schemas");
        lines.push("  <binary> run <id> [--input '<json>']           Execute action with JSON input");
        lines.push("  <binary> config list/get/set/delete/env        Manage package configuration");
        lines.push("  <binary> state list/get/set/delete/clear       Manage shared state store");
        lines.push("  <binary> runs list/show/clear                  Inspect execution runs");
        lines.push("  <binary> serve                                 Start HTTP Runner service");
        lines.push("  <binary> mcp                                   Start MCP STDIO / HTTP service");
        lines.push("\nGlobal options:");
        lines.push("  --data-dir <path>                              Custom runtime database directory");
        lines.push("  --config <KEY=val>                             Temporary config override");
        lines.push("  --json                                         Output results as JSON");
        lines.push("  --envelope                                     Wrap JSON output in standard envelope");
        lines.push("  -h, --help                                     Display this help message");
        lines.push("  -v, --version                                  Display version information");
        writeStdout(lines.join("\n"), context);
      } else {
        program.outputHelp();
      }
    });
}
