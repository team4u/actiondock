import { Command } from "commander";
import type { RuntimeCliContext } from "../types";
import { registerActionCommands } from "./action";
import { registerConfigCommands } from "./config";
import { registerInfoCommand } from "./info";
import { registerMcpCommands } from "./mcp";
import { registerPlaybookCommands } from "./playbook";
import { registerRunsCommands } from "./runs";
import { registerServeCommand } from "./serve";
import { registerStateCommands } from "./state";
import { registerVersionHelpCommands } from "./version-help";

export * from "./action";
export * from "./config";
export * from "./info";
export * from "./mcp";
export * from "./playbook";
export * from "./runs";
export * from "./serve";
export * from "./state";
export * from "./version-help";

/**
 * 将所有运行时核心命令统一注册到 Commander 程序中。
 * 
 * @param program Commander 根程序对象
 * @param context 运行时上下文环境
 */
export function registerAllRuntimeCommands(program: Command, context?: RuntimeCliContext): void {
  registerInfoCommand(program, context);
  registerActionCommands(program, context);
  registerPlaybookCommands(program, context);
  registerConfigCommands(program, context);
  registerStateCommands(program, context);
  registerRunsCommands(program, context);
  registerServeCommand(program, context);
  registerMcpCommands(program, context);
  registerVersionHelpCommands(program, context);
}
