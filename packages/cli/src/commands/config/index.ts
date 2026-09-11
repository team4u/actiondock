import { Command } from "commander";
import type { CliContext } from "../../types";
import { registerConfigSchemaCommand } from "./schema";
import { registerConfigListCommand } from "./list";
import { registerConfigGetCommand } from "./get";
import { registerConfigSetCommand } from "./set";
import { registerConfigDeleteCommand } from "./delete";
import { registerConfigEnvCommand } from "./env";

/**
 * 注册 config 配置管理命令（get、set、list、delete、env、schema）。
 *
 * @param program Commander 实例
 * @param context 命令行上下文
 */
export function registerConfigCommands(program: Command, context?: CliContext): void {
  const configCmd = program
    .command("config")
    .description("Manage runtime configuration store (Global & Project-level)");

  registerConfigSchemaCommand(configCmd, context);
  registerConfigListCommand(configCmd, context);
  registerConfigGetCommand(configCmd, context);
  registerConfigSetCommand(configCmd, context);
  registerConfigDeleteCommand(configCmd, context);
  registerConfigEnvCommand(configCmd, context);
}
