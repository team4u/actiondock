import {
  ActionDockError,
  INVALID_ARGUMENT,
  INVALID_PACKAGE_ID,
  PACKAGE_NOT_FOUND,
  ACTION_NOT_FOUND,
  NOT_FOUND,
  PATH_TRAVERSAL,
  INVALID_FLAT_ARGUMENT,
  INVALID_JSON,
  INVALID_JSON_LITERAL,
  INPUT_PATH_CONFLICT,
  FLAT_INPUT_LIMIT_EXCEEDED,
  INPUT_LIMIT_EXCEEDED,
  INPUT_POLICY_VIOLATION,
  INPUT_CONFLICT,
  INPUT_FILE_NOT_FOUND,
  INPUT_FILE_READ_FAILED,
  InputError,
} from "@actiondock/core";
import { ExitCode, type ExitCodeValue } from "./types";

/**
 * 扁平与解析输入错误码集合。
 */
const FLAT_ERROR_CODES = new Set<string>([
  INVALID_FLAT_ARGUMENT,
  INVALID_JSON,
  INVALID_JSON_LITERAL,
  INPUT_PATH_CONFLICT,
  FLAT_INPUT_LIMIT_EXCEEDED,
  INPUT_LIMIT_EXCEEDED,
  INPUT_POLICY_VIOLATION,
  INPUT_CONFLICT,
  INPUT_FILE_NOT_FOUND,
  INPUT_FILE_READ_FAILED,
]);

/**
 * CLI 信封错误码常量（仅 CLI 输出协议使用，属包内部码，就地常量化管理）。
 */
const CLI_CODE_SUCCESS = "SUCCESS";
const CLI_CODE_INVALID_ARGUMENT = "INVALID_ARGUMENT";
const CLI_CODE_ERROR = "ERROR";
const CLI_CODE_UNKNOWN_ERROR = "UNKNOWN_ERROR";

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
  constructor(message: string, details?: unknown, code: string = "INVALID_ARGUMENT") {
    super(message, ExitCode.INVALID_ARGUMENT, code, details);
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
 * 目标包寻址失败错误（-P 指定的包不在链接注册表也无法按路径寻址）。
 */
export function packageNotFoundError(pkg: string): ArgumentError {
  return new ArgumentError(`Package '${pkg}' not found in linked packages or path`);
}

/**
 * 当前目录不在 ActionDock 工程内错误。
 * `hint` 为命令专属的补救措施提示行（如 -P 参数用法）。
 */
export function notInProjectError(hint?: string): ArgumentError {
  const base = "Not in an ActionDock project (actiondock.json not found)";
  return new ArgumentError(hint ? `${base}.\n${hint}` : base);
}

/**
 * 当前目录无工程且全局注册表无任何链接包提示文案（非错误场景使用）。
 */
export const NO_PROJECT_NO_LINKED_MESSAGE =
  "No ActionDock project in current directory, and no packages linked.";

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

  if (err instanceof InputError) {
    return {
      code: err.code,
      message: err.message,
      exitCode: ExitCode.INVALID_ARGUMENT,
      details: err.details,
    };
  }

  if (err instanceof ActionDockError) {
    const isArgument =
      err.code === INVALID_ARGUMENT ||
      err.code === INVALID_PACKAGE_ID ||
      err.code === PACKAGE_NOT_FOUND ||
      err.code === ACTION_NOT_FOUND ||
      err.code === NOT_FOUND ||
      err.code === PATH_TRAVERSAL ||
      FLAT_ERROR_CODES.has(err.code);
    return {
      code: err.code,
      message: err.message,
      exitCode: isArgument ? ExitCode.INVALID_ARGUMENT : ExitCode.FAILURE,
      details: err.details,
    };
  }

  // Commander.js 原生错误处理
  if (typeof err === "object" && err !== null && "code" in err && typeof (err as any).code === "string") {
    const code = (err as any).code as string;

    if (FLAT_ERROR_CODES.has(code)) {
      return {
        code,
        message: (err as any).message || String(err),
        exitCode: ExitCode.INVALID_ARGUMENT,
        details: (err as any).details,
      };
    }

    const commanderErr = err as { code: string; message: string; exitCode?: number };

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
        code: CLI_CODE_INVALID_ARGUMENT,
        message: commanderErr.message,
        exitCode: ExitCode.INVALID_ARGUMENT,
      };
    }

    // 正常退出（如 --help 或 --version）
    if (code === "commander.helpDisplayed" || code === "commander.version") {
      return {
        code: CLI_CODE_SUCCESS,
        message: commanderErr.message,
        exitCode: ExitCode.SUCCESS,
      };
    }
  }

  if (err instanceof Error) {
    return {
      code: (err as any).code || CLI_CODE_ERROR,
      message: err.message,
      exitCode: ExitCode.FAILURE,
      details: (err as any).details,
    };
  }

  return {
    code: CLI_CODE_UNKNOWN_ERROR,
    message: String(err),
    exitCode: ExitCode.FAILURE,
  };
}
