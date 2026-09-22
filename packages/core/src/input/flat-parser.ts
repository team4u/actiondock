import type { JsonValue } from "@actiondock/sdk";
import {
  invalidFlatArgument,
  invalidJsonLiteral,
  flatInputLimitExceeded,
} from "./flat-errors";
import {
  isFlatPathPropertyName,
  isForbiddenActionInputPropertyName,
} from "./flat-predicates";
import { validateJsonValue } from "../json/value-validator";

/** 最大赋值表达式总数 */
export const DEFAULT_MAX_ASSIGNMENTS = 1000;

/** 最大路径段深度 */
export const DEFAULT_MAX_PATH_DEPTH = 32;

/** 原始路径字符串最大字节数 */
export const DEFAULT_MAX_PATH_LENGTH = 1024;

/** 单个属性名最大字节数 */
export const DEFAULT_MAX_PROPERTY_KEY_LENGTH = 128;

/** 原始值字符串最大字节数 (1 MiB) */
export const DEFAULT_MAX_RAW_VALUE_LENGTH = 1024 * 1024;

/** JSON 字面量最大字节数 (1 MiB) */
export const DEFAULT_MAX_JSON_LITERAL_LENGTH = 1024 * 1024;

/** 原始输入总字节数上限 (10 MiB) */
export const DEFAULT_MAX_TOTAL_RAW_BYTES = 10 * 1024 * 1024;

/** 数组索引数值上限 */
export const DEFAULT_MAX_ARRAY_INDEX = 10_000;

/** 物化后总大小字节上限 (10 MiB) */
export const DEFAULT_MAX_MATERIALIZED_SIZE_BYTES = 10 * 1024 * 1024;

/**
 * 扁平赋值表达式结构。
 */
export interface FlatAssignment {
  raw: string;
  path: Array<string | number>;
  operator: "=" | ":=";
  rawValue: string;
  value: JsonValue;
}

/**
 * 扁平解析器配置选项。
 */
export interface FlatParserOptions {
  maxAssignments?: number;
  maxPathDepth?: number;
  maxPathLength?: number;
  maxPropertyKeyLength?: number;
  maxRawValueLength?: number;
  maxJsonLiteralLength?: number;
  maxArrayIndex?: number;
  maxTotalRawBytes?: number;
}

const ARRAY_INDEX_REGEX = /^(0|[1-9][0-9]*)$/;

/**
 * 解析单个扁平赋值表达式。
 *
 * 安全规范：
 * - 错误信息与 details 中严禁回显未经脱敏的原始 rawValue 或 token，防止敏感凭据泄露至日志。
 * - 资源限制统一使用 UTF-8 字节计算。
 */
function parseSingleFlatAssignment(
  token: string,
  options?: FlatParserOptions
): FlatAssignment {
  const maxPathDepth = options?.maxPathDepth ?? DEFAULT_MAX_PATH_DEPTH;
  const maxPathLength = options?.maxPathLength ?? DEFAULT_MAX_PATH_LENGTH;
  const maxPropertyKeyLength =
    options?.maxPropertyKeyLength ?? DEFAULT_MAX_PROPERTY_KEY_LENGTH;
  const maxRawValueLength =
    options?.maxRawValueLength ?? DEFAULT_MAX_RAW_VALUE_LENGTH;
  const maxJsonLiteralLength =
    options?.maxJsonLiteralLength ?? DEFAULT_MAX_JSON_LITERAL_LENGTH;
  const maxArrayIndex = options?.maxArrayIndex ?? DEFAULT_MAX_ARRAY_INDEX;

  const colonEqIndex = token.indexOf(":=");
  const eqIndex = token.indexOf("=");

  let opIndex = -1;
  let operator: "=" | ":=" = "=";

  if (colonEqIndex !== -1 && eqIndex !== -1) {
    if (colonEqIndex < eqIndex) {
      opIndex = colonEqIndex;
      operator = ":=";
    } else {
      opIndex = eqIndex;
      operator = "=";
    }
  } else if (colonEqIndex !== -1) {
    opIndex = colonEqIndex;
    operator = ":=";
  } else if (eqIndex !== -1) {
    opIndex = eqIndex;
    operator = "=";
  } else {
    throw invalidFlatArgument(
      `Missing assignment operator in flat argument (length: ${token.length})`,
      { length: token.length, reason: "MISSING_OPERATOR" }
    );
  }

  const rawPath = token.slice(0, opIndex);
  const rawValue = token.slice(opIndex + operator.length);
  const rawValueBytes = Buffer.byteLength(rawValue, "utf8");

  if (rawPath.length === 0) {
    throw invalidFlatArgument(
      `Empty path in flat assignment with operator '${operator}'`,
      { operator, valueLength: rawValueBytes, reason: "EMPTY_PATH" }
    );
  }

  const pathByteLength = Buffer.byteLength(rawPath, "utf8");
  if (pathByteLength > maxPathLength) {
    throw flatInputLimitExceeded(
      `Path length (${pathByteLength} bytes) exceeds limit (${maxPathLength} bytes)`,
      { path: rawPath, length: pathByteLength, maxPathLength, reason: "MAX_PATH_BYTES" }
    );
  }

  if (
    rawPath.startsWith(".") ||
    rawPath.endsWith(".") ||
    rawPath.includes("..")
  ) {
    throw invalidFlatArgument(
      `Invalid dot notation in path: "${rawPath}"`,
      { path: rawPath, reason: "INVALID_DOT_NOTATION" }
    );
  }

  const rawSegments = rawPath.split(".");
  if (rawSegments.length > maxPathDepth) {
    throw flatInputLimitExceeded(
      `Path depth (${rawSegments.length}) exceeds limit (${maxPathDepth}) in path: "${rawPath}"`,
      { path: rawPath, depth: rawSegments.length, maxPathDepth, reason: "MAX_PATH_DEPTH" }
    );
  }

  const path: Array<string | number> = [];
  for (const seg of rawSegments) {
    if (seg.length === 0) {
      throw invalidFlatArgument(
        `Empty path segment in path: "${rawPath}"`,
        { path: rawPath, reason: "INVALID_SEGMENT" }
      );
    }

    if (isForbiddenActionInputPropertyName(seg)) {
      throw invalidFlatArgument(
        `Forbidden property "${seg}" in path: "${rawPath}"`,
        { path: rawPath, segment: seg, reason: "FORBIDDEN_PROPERTY" }
      );
    }

    const segByteLength = Buffer.byteLength(seg, "utf8");
    if (segByteLength > maxPropertyKeyLength) {
      throw flatInputLimitExceeded(
        `Path segment length (${segByteLength} bytes) exceeds limit (${maxPropertyKeyLength} bytes) in path: "${rawPath}"`,
        { path: rawPath, segment: seg, length: segByteLength, maxPropertyKeyLength, reason: "MAX_PROPERTY_KEY_BYTES" }
      );
    }

    if (ARRAY_INDEX_REGEX.test(seg)) {
      const index = Number(seg);
      if (index > maxArrayIndex) {
        throw flatInputLimitExceeded(
          `Array index (${index}) exceeds limit (${maxArrayIndex}) in path: "${rawPath}"`,
          { path: rawPath, segment: seg, index, maxArrayIndex, reason: "MAX_ARRAY_INDEX" }
        );
      }
      path.push(index);
    } else if (isFlatPathPropertyName(seg)) {
      path.push(seg);
    } else {
      throw invalidFlatArgument(
        `Invalid path segment "${seg}" in path: "${rawPath}"`,
        { path: rawPath, segment: seg, reason: "INVALID_SEGMENT" }
      );
    }
  }

  if (rawValueBytes > maxRawValueLength) {
    throw flatInputLimitExceeded(
      `Raw value length (${rawValueBytes} bytes) exceeds limit (${maxRawValueLength} bytes) for path "${rawPath}"`,
      { path: rawPath, operator, valueLength: rawValueBytes, maxRawValueLength, reason: "MAX_RAW_VALUE_BYTES" }
    );
  }

  let value: JsonValue;
  if (operator === "=") {
    value = rawValue;
  } else {
    if (rawValueBytes > maxJsonLiteralLength) {
      throw flatInputLimitExceeded(
        `JSON literal length (${rawValueBytes} bytes) exceeds limit (${maxJsonLiteralLength} bytes) for path "${rawPath}"`,
        { path: rawPath, operator: ":=", valueLength: rawValueBytes, maxJsonLiteralLength, reason: "MAX_JSON_LITERAL_BYTES" }
      );
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(rawValue);
    } catch {
      throw invalidJsonLiteral(
        `Failed to parse JSON literal for path "${rawPath}" (length: ${rawValueBytes} bytes)`,
        { path: rawPath, operator: ":=", valueLength: rawValueBytes, reason: "SYNTAX_ERROR" }
      );
    }

    const check = validateJsonValue(parsed);
    if (!check.valid) {
      throw invalidJsonLiteral(
        `Invalid JSON literal for path "${rawPath}": ${check.reason}`,
        {
          path: rawPath,
          operator: ":=",
          valueLength: rawValueBytes,
          reason:
            check.code === "NON_FINITE_NUMBER"
              ? "NON_FINITE_NUMBER"
              : check.code === "MAX_JSON_DEPTH"
                ? "MAX_JSON_DEPTH"
                : "INVALID_JSON_VALUE",
        }
      );
    }

    value = parsed as JsonValue;
  }

  return {
    raw: token,
    path,
    operator,
    rawValue,
    value,
  };
}

/**
 * 解析扁平赋值表达式列表。
 *
 * @param tokens 待解析的表达式字符串列表
 * @param options 解析安全阈值配置选项
 * @returns 解析后的结构化赋值列表
 */
export function parseFlatAssignments(
  tokens: string[],
  options?: FlatParserOptions
): FlatAssignment[] {
  const maxAssignments = options?.maxAssignments ?? DEFAULT_MAX_ASSIGNMENTS;
  if (tokens.length > maxAssignments) {
    throw flatInputLimitExceeded(
      `Total assignments (${tokens.length}) exceeds limit (${maxAssignments})`,
      { count: tokens.length, maxAssignments, reason: "MAX_ASSIGNMENTS" }
    );
  }

  const maxTotalRawBytes = options?.maxTotalRawBytes ?? DEFAULT_MAX_TOTAL_RAW_BYTES;
  let totalRawBytes = 0;
  for (const token of tokens) {
    totalRawBytes += Buffer.byteLength(token, "utf8");
    if (totalRawBytes > maxTotalRawBytes) {
      throw flatInputLimitExceeded(
        `Total raw input bytes (${totalRawBytes}) exceeds limit (${maxTotalRawBytes})`,
        { totalBytes: totalRawBytes, maxTotalRawBytes, reason: "MAX_TOTAL_RAW_BYTES" }
      );
    }
  }

  return tokens.map((token) => parseSingleFlatAssignment(token, options));
}
