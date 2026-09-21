import {
  INVALID_FLAT_ARGUMENT,
  INVALID_JSON_LITERAL,
  INPUT_PATH_CONFLICT,
  FLAT_INPUT_LIMIT_EXCEEDED,
  INPUT_CONFLICT,
} from "../errors";

export {
  INVALID_FLAT_ARGUMENT,
  INVALID_JSON_LITERAL,
  INPUT_PATH_CONFLICT,
  FLAT_INPUT_LIMIT_EXCEEDED,
  INPUT_CONFLICT,
};



/**
 * 扁平输入领域结构化异常类。
 */
export class FlatInputError extends Error {
  public readonly code: string;
  public readonly details?: Record<string, unknown>;

  constructor(code: string, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = "FlatInputError";
    this.code = code;
    this.details = details;
    Object.setPrototypeOf(this, FlatInputError.prototype);
  }
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
 * 构造 INVALID_JSON_LITERAL 异常。
 */
export function invalidJsonLiteral(
  message: string,
  details?: Record<string, unknown>
): FlatInputError {
  return new FlatInputError(INVALID_JSON_LITERAL, message, details);
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
): FlatInputError {
  return new FlatInputError(INPUT_CONFLICT, message, details);
}
