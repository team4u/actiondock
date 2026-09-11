import { CommanderError } from "commander";
import { createCliProgram, CLI_VERSION } from "./commands";
import { formatError } from "./errors";
import { renderError } from "./renderer";

export * from "./types";
export * from "./errors";
export * from "./renderer";
export * from "./prompt";
export * from "./standalone";
export * from "./utils";
export * from "./services";
export * from "./commands";

/**
 * ActionDock CLI 主执行入口函数。
 *
 * @param argv 命令行参数数组（默认使用 process.argv）
 * @returns 进程退出码
 */
export async function main(argv: string[] = process.argv): Promise<number> {
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

    // 复用 renderer 的 renderError 统一错误信封，消除手工拼装的双实现
    renderError(err, {
      json: isMachine,
      envelope: isMachine,
    });
    process.exitCode = formatError(err).exitCode;
    return process.exitCode;
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
