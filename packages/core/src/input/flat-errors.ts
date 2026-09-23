import {
  ActionDockError,
  type ErrorCode,
  INVALID_JSON,
  INVALID_JSON_LITERAL,
  INVALID_FLAT_ARGUMENT,
  INPUT_PATH_CONFLICT,
  FLAT_INPUT_LIMIT_EXCEEDED,
  INPUT_LIMIT_EXCEEDED,
  INPUT_POLICY_VIOLATION,
  INPUT_CONFLICT,
  INPUT_FILE_NOT_FOUND,
  INPUT_FILE_READ_FAILED,
  INPUT_NOT_JSON,
  INPUT_VALIDATION_FAILED,
} from "../errors";

export {
  INVALID_JSON,
  INVALID_JSON_LITERAL,
  INVALID_FLAT_ARGUMENT,
  INPUT_PATH_CONFLICT,
  FLAT_INPUT_LIMIT_EXCEEDED,
  INPUT_LIMIT_EXCEEDED,
  INPUT_POLICY_VIOLATION,
  INPUT_CONFLICT,
  INPUT_FILE_NOT_FOUND,
  INPUT_FILE_READ_FAILED,
  INPUT_NOT_JSON,
  INPUT_VALIDATION_FAILED,
};

/** 输入大小或深度超出限制的根因类型 */
export type InputLimitExceededReason =
  | "MAX_INPUT_BYTES"
  | "MAX_JSON_DEPTH"
  | string;

/** 扁平入参安全阈值超限的根因类型 */
export type FlatInputLimitExceededReason =
  | "MAX_ASSIGNMENTS"
  | "MAX_PATH_DEPTH"
  | "MAX_PATH_BYTES"
  | "MAX_PROPERTY_KEY_BYTES"
  | "MAX_RAW_VALUE_BYTES"
  | "MAX_JSON_LITERAL_BYTES"
  | "MAX_TOTAL_RAW_BYTES"
  | "MAX_ARRAY_INDEX"
  | "MAX_MATERIALIZED_BYTES"
  | "MAX_MATERIALIZED_JSON_DEPTH"
  | string;

/** 输入策略违规的根因类型 */
export type InputPolicyViolationReason =
  | "FORBIDDEN_PROPERTY"
  | string;

/** 非法扁平参数的根因类型 */
export type InvalidFlatArgumentReason =
  | "MISSING_OPERATOR"
  | "EMPTY_PATH"
  | "INVALID_DOT_NOTATION"
  | "INVALID_SEGMENT"
  | "FORBIDDEN_PROPERTY"
  | string;

/** 输入路径冲突的根因类型 */
export type InputPathConflictReason =
  | "ROOT_INDEX_NOT_ALLOWED"
  | "DUPLICATE_ASSIGNMENT"
  | "LEAF_CONTAINER_CONFLICT"
  | "OBJECT_ARRAY_CONFLICT"
  | "SPARSE_ARRAY"
  | "INCOMPLETE_CONTAINER"
  | string;

/** 非法完整 JSON 的根因类型 */
export type InvalidJsonReason =
  | "SYNTAX_ERROR"
  | "INVALID_UTF8"
  | "NON_FINITE_NUMBER"
  | "MAX_JSON_DEPTH"
  | "INVALID_JSON_VALUE"
  | string;

/** 非法 JSON 字面量的根因类型 */
export type InvalidJsonLiteralReason =
  | "SYNTAX_ERROR"
  | "NON_FINITE_NUMBER"
  | "MAX_JSON_DEPTH"
  | "INVALID_JSON_VALUE"
  | string;

/** 输入来源类型 */
export type InputValidationSource =
  | "flat-json-literal"
  | "flat-materialized"
  | "full-json-inline"
  | "full-json-file"
  | "full-json-stdin"
  | "cli-pre-target"
  | "runtime";

/**
 * 输入领域通用结构化异常类。
 */
export class InputError extends ActionDockError {
  public readonly details?: Record<string, unknown> | string[];

  constructor(
    code: ErrorCode,
    message: string,
    details?: Record<string, unknown> | string[]
  ) {
    super(code, message, details);
    this.name = "InputError";
    this.details = details;
    Object.setPrototypeOf(this, InputError.prototype);
  }
}

/**
 * 扁平输入结构化异常类（继承 InputError 保持既有捕获兼容）。
 */
export class FlatInputError extends InputError {
  constructor(code: ErrorCode, message: string, details?: Record<string, unknown>) {
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
 * 构造 INPUT_LIMIT_EXCEEDED 异常。
 */
export function inputLimitExceeded(
  message: string,
  details?: Record<string, unknown>
): InputError {
  return new InputError(INPUT_LIMIT_EXCEEDED, message, details);
}

/**
 * 构造 INPUT_POLICY_VIOLATION 异常。
 */
export function inputPolicyViolation(
  message: string,
  details?: Record<string, unknown>
): InputError {
  return new InputError(INPUT_POLICY_VIOLATION, message, details);
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

