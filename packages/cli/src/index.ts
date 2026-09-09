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

  const isMachine = argv.includes("--json") || argv.includes("--envelope");

  try {
    await program.parseAsync(argv);
    return typeof process.exitCode === "number" ? process.exitCode : 0;
  } catch (err: unknown) {
    if (err instanceof CommanderError) {
      if (err.exitCode === 0) {
        return 0;
      }
    }

    const formatted = formatError(err);
    if (isMachine) {
      const errorEnv = {
        ok: false,
        error: {
          code: formatted.code,
          message: formatted.message,
          ...(formatted.details !== undefined ? { details: formatted.details } : {}),
        },
      };
      console.log(JSON.stringify(errorEnv, null, 2));
    } else {
      const msg = formatted.message.startsWith("Error: ")
        ? formatted.message
        : `Error: ${formatted.message}`;
      console.error(msg);
    }
    process.exitCode = formatted.exitCode;
    return formatted.exitCode;
  }
}

import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const isDirectRun =
  Boolean(process.argv[1]) &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectRun) {
  main().catch((err) => {
    console.error("Fatal error:", err);
    process.exitCode = 1;
  });
}

