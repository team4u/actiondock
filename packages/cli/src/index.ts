import { CommanderError } from "commander";
import { createCliProgram, CLI_VERSION } from "./commands";
import { formatError, SigintError } from "./errors";
import { renderError } from "./renderer";
import { ExitCode, type InvocationControl, type CliContext } from "./types";

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
 * @param control 可选的中断与取消控制契约
 * @returns 进程退出码
 */
export async function main(
  argv: string[] = process.argv,
  control?: InvocationControl
): Promise<number> {
  const context: CliContext = { control, exitCode: 0 };
  const program = createCliProgram(context);

  const isMachine = argv.includes("--json");
  const normalizedArgv =
    argv.length >= 2 &&
    (argv[0].endsWith("node") ||
      argv[0].endsWith("bun") ||
      argv[0].endsWith("tsx") ||
      argv[1].includes("/") ||
      argv[1].includes("\\") ||
      argv[1].endsWith(".js") ||
      argv[1].endsWith(".ts"))
      ? argv
      : ["node", "ad", ...argv];

  try {
    await program.parseAsync(normalizedArgv);
    if (control?.cancellationSource === "sigint" && control?.signal?.aborted) {
      return ExitCode.SIGINT;
    }
    return (context.exitCode && context.exitCode !== 0)
      ? context.exitCode
      : (typeof process.exitCode === "number" ? process.exitCode : 0);
  } catch (err: unknown) {
    if (
      control?.cancellationSource === "sigint" &&
      (control?.signal?.aborted || (err as any)?.name === "AbortError" || (err as any)?.code === "SIGINT_INTERRUPTED" || err instanceof SigintError)
    ) {
      return ExitCode.SIGINT;
    }
    if (err instanceof CommanderError) {
      if (err.exitCode === 0) {
        return 0;
      }
    }

    // 复用 renderer 的 renderError 统一错误信封，消除手工拼装的双实现
    renderError(err, {
      json: isMachine,
      context,
    });
    return formatError(err).exitCode;
  }
}

/**
 * 命令行独立进程适配器。
 * 仅在命令行可执行入口调用，负责全局 SIGINT 监听与退出状态码写入。
 */
export async function runCliProcess(argv: string[] = process.argv): Promise<void> {
  const controller = new AbortController();
  const control: InvocationControl = {
    signal: controller.signal,
  };
  let sigintCount = 0;
  const sigintHandler = () => {
    sigintCount++;
    if (sigintCount === 1) {
      control.cancellationSource = "sigint";
      controller.abort(new Error("Interrupted by SIGINT"));
    } else {
      process.exitCode = 130;
      process.exit(130);
    }
  };
  process.on("SIGINT", sigintHandler);
  try {
    const exitCode = await main(argv, control);
    process.exitCode = exitCode;
  } finally {
    process.removeListener("SIGINT", sigintHandler);
  }
}

import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const isDirectRun =
  Boolean(process.argv[1]) &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectRun) {
  runCliProcess().catch((err) => {
    console.error("Fatal error:", err);
    process.exitCode = 1;
  });
}

