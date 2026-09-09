import { ExitCode, type ExitCodeValue } from "./types";

/**
 * 命令行标准错误基类。
 */
export class CliError extends Error {
  readonly exitCode: ExitCodeValue;
  readonly code: string;
  readonly details?: unknown;

  constructor(
    message: string,
    exitCode: ExitCodeValue = ExitCode.FAILURE,
    code: string = "CLI_ERROR",
    details?: unknown
  ) {
    super(message);
    this.name = "CliError";
    this.exitCode = exitCode;
    this.code = code;
    this.details = details;
  }
}

/**
 * 命令行参数与选项校验错误（退出码为 2）。
 */
export class ArgumentError extends CliError {
  constructor(message: string, details?: unknown) {
    super(message, ExitCode.INVALID_ARGUMENT, "INVALID_ARGUMENT", details);
    this.name = "ArgumentError";
  }
}

/**
 * 业务逻辑或框架执行失败错误（退出码为 1）。
 */
export class ExecutionError extends CliError {
  constructor(message: string, details?: unknown, code: string = "EXECUTION_FAILURE") {
    super(message, ExitCode.FAILURE, code, details);
    this.name = "ExecutionError";
  }
}

/**
 * 用户中断信号错误（退出码为 130）。
 */
export class SigintError extends CliError {
  constructor(message: string = "Interrupted by SIGINT") {
    super(message, ExitCode.SIGINT, "SIGINT_INTERRUPTED");
    this.name = "SigintError";
  }
}

/**
 * 标准化错误信息解析结果。
 */
export interface FormattedError {
  code: string;
  message: string;
  exitCode: ExitCodeValue;
  details?: unknown;
}

/**
 * 解析并格式化任意异常为结构化错误对象。
 * 
 * @param err 待解析的异常对象
 */
export function formatError(err: unknown): FormattedError {
  if (err instanceof CliError) {
    return {
      code: err.code,
      message: err.message,
      exitCode: err.exitCode,
      details: err.details,
    };
  }

  // Commander.js 原生错误处理
  if (typeof err === "object" && err !== null && "code" in err && typeof (err as any).code === "string") {
    const commanderErr = err as { code: string; message: string; exitCode?: number };
    const code = commanderErr.code;

    // 参数类异常
    if (
      code.startsWith("commander.unknownOption") ||
      code.startsWith("commander.missingArgument") ||
      code.startsWith("commander.missingMandatoryOptionValue") ||
      code.startsWith("commander.optionMissingArgument") ||
      code.startsWith("commander.invalidArgument") ||
      code.startsWith("commander.excessArguments")
    ) {
      return {
        code: "INVALID_ARGUMENT",
        message: commanderErr.message,
        exitCode: ExitCode.INVALID_ARGUMENT,
      };
    }

    // 正常退出（如 --help 或 --version）
    if (code === "commander.helpDisplayed" || code === "commander.version") {
      return {
        code: "SUCCESS",
        message: commanderErr.message,
        exitCode: ExitCode.SUCCESS,
      };
    }
  }

  if (err instanceof Error) {
    return {
      code: "ERROR",
      message: err.message,
      exitCode: ExitCode.FAILURE,
    };
  }

  return {
    code: "UNKNOWN_ERROR",
    message: String(err),
    exitCode: ExitCode.FAILURE,
  };
}
