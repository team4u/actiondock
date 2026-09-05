import { Command, CommanderError } from "commander";
import { formatError } from "./errors";
import { registerAllRuntimeCommands } from "./commands";
import { renderError } from "./renderer";
import { ExitCode, type RuntimeProgramOptions } from "./types";

/**
 * 创建预注册所有运行时命令的 Commander 程序实例。
 * 
 * @param options 创建选项
 */
export function createRuntimeProgram(options?: RuntimeProgramOptions): Command {
  const program = new Command();

  const isStandalone = Boolean(options?.standalone);
  const name = options?.name || (isStandalone ? options!.standalone!.packageId : "ad");
  const version = options?.version || (isStandalone ? options!.standalone!.version : "2.0.2");
  const description =
    options?.description ||
    (isStandalone
      ? options?.standalone?.description || `${name} standalone ActionDock executable`
      : "ActionDock (ad) 2.0 - Toolchain for building and shipping standalone AI Agent Actions & Skills");

  program
    .name(name)
    .version(version, "-v, --version", "Display version information")
    .description(description)
    .option("--json", "Output results as JSON")
    .option("--envelope", "Wrap JSON output in standard envelope")
    .option("--data-dir <path>", "Custom database storage directory");

  // 自定义输出流
  if (options?.stdout || options?.stderr) {
    program.configureOutput({
      writeOut: (str) => {
        if (options.stdout) {
          options.stdout(str);
        } else {
          process.stdout.write(str);
        }
      },
      writeErr: (str) => {
        if (options.stderr) {
          options.stderr(str);
        } else {
          process.stderr.write(str);
        }
      },
    });
  }

  // 禁用 Commander 内部直接 process.exit，统一由顶层调度器管控退出码
  program.exitOverride((err) => {
    throw err;
  });

  // 注册所有运行时命令
  registerAllRuntimeCommands(program, options);

  return program;
}

/**
 * 解析命令行参数并执行运行时程序，返回标准化退出码。
 * 遵守退出码规范：成功为 0，业务或框架失败为 1，参数错误为 2，SIGINT 为 130。
 * 不得随意直接调用 process.exit()。
 * 
 * @param argv 命令行参数数组（默认使用 process.argv）
 * @param options 运行时配置选项
 */
export async function runRuntimeCli(
  argv: string[] = process.argv,
  options?: RuntimeProgramOptions
): Promise<number> {
  const isJson = argv.includes("--json") || Boolean(options?.defaultEnvelope);
  const program = createRuntimeProgram(options);

  try {
    await program.parseAsync(argv);
    return ExitCode.SUCCESS;
  } catch (err: unknown) {
    // 处理 Commander.js 原生触发的退出控制（如 --help 或 --version）
    if (err instanceof CommanderError) {
      if (err.exitCode === 0) {
        return ExitCode.SUCCESS;
      }
    }

    const formatted = formatError(err);

    // 渲染错误输出
    renderError(err, {
      json: isJson,
      envelope: options?.defaultEnvelope || argv.includes("--envelope"),
      context: options,
    });

    if (options?.setExitCode && typeof process !== "undefined") {
      process.exitCode = formatted.exitCode;
    }

    return formatted.exitCode;
  }
}
