import { formatError } from "@actiondock/runtime-cli";
import { setupNodeRuntime } from "@actiondock/runtime-node";
import { CommanderError } from "commander";
import { createCliProgram } from "./commands";

export * from "./commands";

/**
 * ActionDock CLI 主执行入口函数。
 * 
 * @param argv 命令行参数数组（默认使用 process.argv）
 * @returns 进程退出码
 */
export async function main(argv: string[] = process.argv): Promise<number> {
  setupNodeRuntime();
  const program = createCliProgram();

  try {
    await program.parseAsync(argv);
    return 0;
  } catch (err: unknown) {
    if (err instanceof CommanderError) {
      if (err.exitCode === 0) {
        return 0;
      }
    }

    const formatted = formatError(err);
    const msg = formatted.message.startsWith("Error: ")
      ? formatted.message
      : `Error: ${formatted.message}`;
    console.error(msg);
    process.exitCode = formatted.exitCode;
    return formatted.exitCode;
  }
}

if ((import.meta as any).main) {
  main().catch((err) => {
    console.error("Fatal error:", err);
    process.exitCode = 1;
  });
}

