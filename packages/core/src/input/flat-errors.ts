import {
  INVALID_JSON,
  INVALID_JSON_LITERAL,
  INVALID_FLAT_ARGUMENT,
  INPUT_PATH_CONFLICT,
  FLAT_INPUT_LIMIT_EXCEEDED,
  INPUT_CONFLICT,
  INPUT_FILE_NOT_FOUND,
  INPUT_FILE_READ_FAILED,
} from "../errors";

export {
  INVALID_JSON,
  INVALID_JSON_LITERAL,
  INVALID_FLAT_ARGUMENT,
  INPUT_PATH_CONFLICT,
  FLAT_INPUT_LIMIT_EXCEEDED,
  INPUT_CONFLICT,
  INPUT_FILE_NOT_FOUND,
  INPUT_FILE_READ_FAILED,
};

/**
 * 输入领域通用结构化异常类。
 */
export class InputError extends Error {
  public readonly code: string;
  public readonly details?: Record<string, unknown>;

  constructor(code: string, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = "InputError";
    this.code = code;
    this.details = details;
    Object.setPrototypeOf(this, InputError.prototype);
  }
}

/**
 * 扁平输入结构化异常类（继承 InputError 保持既有捕获兼容）。
 */
export class FlatInputError extends InputError {
  constructor(code: string, message: string, details?: Record<string, unknown>) {
    super(code, message, details);
    this.name = "FlatInputError";
    Object.setPrototypeOf(this, FlatInputError.prototype);
  }
}

/**
 * 构造 INVALID_JSON 异常（用于完整 JSON 文档解析失败）。
 */
export function invalidJson(
  message: string,
  details?: Record<string, unknown>
): InputError {
  return new InputError(INVALID_JSON, message, details);
}

/**
 * 构造 INVALID_JSON_LITERAL 异常（仅用于 path:=json 字面量解析失败）。
 */
export function invalidJsonLiteral(
  message: string,
  details?: Record<string, unknown>
): FlatInputError {
  return new FlatInputError(INVALID_JSON_LITERAL, message, details);
}

/**
 * 构造 INVALID_FLAT_ARGUMENT 异常。
 */
export function invalidFlatArgument(
  message: string,
  details?: Record<string, unknown>
): FlatInputError {
  return new FlatInputError(INVALID_FLAT_ARGUMENT, message, details);
}

/**
 * 构造 INPUT_PATH_CONFLICT 异常。
 */
export function inputPathConflict(
  message: string,
  details?: Record<string, unknown>
): FlatInputError {
  return new FlatInputError(INPUT_PATH_CONFLICT, message, details);
}

/**
 * 构造 FLAT_INPUT_LIMIT_EXCEEDED 异常。
 */
export function flatInputLimitExceeded(
  message: string,
  details?: Record<string, unknown>
): FlatInputError {
  return new FlatInputError(FLAT_INPUT_LIMIT_EXCEEDED, message, details);
}

/**
 * 构造 INPUT_CONFLICT 异常。
 */
export function inputConflict(
  message: string,
  details?: Record<string, unknown>
): InputError {
  return new InputError(INPUT_CONFLICT, message, details);
}

/**
 * 构造 INPUT_FILE_NOT_FOUND 异常。
 */
export function inputFileNotFound(
  filePath: string,
  details?: Record<string, unknown>
): InputError {
  return new InputError(
    INPUT_FILE_NOT_FOUND,
    `Input file not found: ${filePath}`,
    { filePath, ...details }
  );
}

/**
 * 构造 INPUT_FILE_READ_FAILED 异常。
 */
export function inputFileReadFailed(
  source: string,
  cause: unknown,
  details?: Record<string, unknown>
): InputError {
  const reason = cause instanceof Error ? cause.message : String(cause);
  return new InputError(
    INPUT_FILE_READ_FAILED,
    `Failed to read input from ${source}: ${reason}`,
    { source, ...details }
  );
}
