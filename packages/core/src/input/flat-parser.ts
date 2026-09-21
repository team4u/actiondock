import type { JsonValue } from "@actiondock/sdk";
import {
  invalidFlatArgument,
  invalidJsonLiteral,
  flatInputLimitExceeded,
} from "./flat-errors";

/** 最大赋值表达式总数 */
export const DEFAULT_MAX_ASSIGNMENTS = 1000;

/** 最大路径段深度 */
export const DEFAULT_MAX_PATH_DEPTH = 32;

/** 原始路径字符串最大长度 */
export const DEFAULT_MAX_PATH_LENGTH = 1024;

/** 单个属性名最大长度 */
export const DEFAULT_MAX_PROPERTY_KEY_LENGTH = 128;

/** 原始值字符串最大长度 */
export const DEFAULT_MAX_RAW_VALUE_LENGTH = 1024 * 1024; // 1 MiB

/** JSON 字面量最大长度 */
export const DEFAULT_MAX_JSON_LITERAL_LENGTH = 1024 * 1024; // 1 MiB

/** 数组索引数值上限 */
export const DEFAULT_MAX_ARRAY_INDEX = 10_000;

/** 物化后总大小字节上限 */
export const DEFAULT_MAX_MATERIALIZED_SIZE_BYTES = 10 * 1024 * 1024; // 10 MiB

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
}

const DANGEROUS_PROPERTIES = new Set(["__proto__", "constructor", "prototype"]);
const ARRAY_INDEX_REGEX = /^(0|[1-9][0-9]*)$/;
const PROPERTY_KEY_REGEX = /^[A-Za-z_][A-Za-z0-9_-]*$/;

/**
 * 递归校验 JSON 数据中所有数值必须满足 Number.isFinite。
 */
function assertFiniteNumbers(val: unknown, token: string): void {
  if (typeof val === "number") {
    if (!Number.isFinite(val)) {
      throw invalidJsonLiteral(
        `Non-finite number found in JSON literal in flat assignment: "${token}"`,
        { token, value: val }
      );
    }
  } else if (Array.isArray(val)) {
    for (const item of val) {
      assertFiniteNumbers(item, token);
    }
  } else if (val !== null && typeof val === "object") {
    for (const key of Object.keys(val)) {
      assertFiniteNumbers((val as Record<string, unknown>)[key], token);
    }
  }
}

/**
 * 解析单个扁平赋值表达式。
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
      `Missing assignment operator in token: "${token}"`,
      { token }
    );
  }

  const rawPath = token.slice(0, opIndex);
  const rawValue = token.slice(opIndex + operator.length);

  if (rawPath.length === 0) {
    throw invalidFlatArgument(
      `Empty path in flat assignment: "${token}"`,
      { token }
    );
  }

  if (rawPath.length > maxPathLength) {
    throw flatInputLimitExceeded(
      `Path length (${rawPath.length}) exceeds limit (${maxPathLength}) in token: "${token}"`,
      { token, length: rawPath.length, maxPathLength }
    );
  }

  if (
    rawPath.startsWith(".") ||
    rawPath.endsWith(".") ||
    rawPath.includes("..")
  ) {
    throw invalidFlatArgument(
      `Invalid dot notation in path: "${rawPath}"`,
      { token, rawPath }
    );
  }

  const rawSegments = rawPath.split(".");
  if (rawSegments.length > maxPathDepth) {
    throw flatInputLimitExceeded(
      `Path depth (${rawSegments.length}) exceeds limit (${maxPathDepth}) in token: "${token}"`,
      { token, depth: rawSegments.length, maxPathDepth }
    );
  }

  const path: Array<string | number> = [];
  for (const seg of rawSegments) {
    if (seg.length === 0) {
      throw invalidFlatArgument(
        `Empty path segment in path: "${rawPath}"`,
        { token, rawPath }
      );
    }

    if (DANGEROUS_PROPERTIES.has(seg)) {
      throw invalidFlatArgument(
        `Forbidden property "${seg}" in path: "${rawPath}"`,
        { token, rawPath, segment: seg }
      );
    }

    if (seg.length > maxPropertyKeyLength) {
      throw flatInputLimitExceeded(
        `Path segment length (${seg.length}) exceeds limit (${maxPropertyKeyLength}) in token: "${token}"`,
        { token, segment: seg, length: seg.length, maxPropertyKeyLength }
      );
    }

    if (ARRAY_INDEX_REGEX.test(seg)) {
      const index = Number(seg);
      if (index > maxArrayIndex) {
        throw flatInputLimitExceeded(
          `Array index (${index}) exceeds limit (${maxArrayIndex}) in token: "${token}"`,
          { token, segment: seg, index, maxArrayIndex }
        );
      }
      path.push(index);
    } else if (PROPERTY_KEY_REGEX.test(seg)) {
      path.push(seg);
    } else {
      throw invalidFlatArgument(
        `Invalid path segment "${seg}" in path: "${rawPath}"`,
        { token, rawPath, segment: seg }
      );
    }
  }

  if (rawValue.length > maxRawValueLength) {
    throw flatInputLimitExceeded(
      `Raw value length (${rawValue.length}) exceeds limit (${maxRawValueLength}) in token: "${token}"`,
      { token, length: rawValue.length, maxRawValueLength }
    );
  }

  let value: JsonValue;
  if (operator === "=") {
    value = rawValue;
  } else {
    if (rawValue.length > maxJsonLiteralLength) {
      throw flatInputLimitExceeded(
        `JSON literal length (${rawValue.length}) exceeds limit (${maxJsonLiteralLength}) in token: "${token}"`,
        { token, length: rawValue.length, maxJsonLiteralLength }
      );
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(rawValue);
    } catch (err: unknown) {
      throw invalidJsonLiteral(
        `Failed to parse JSON literal in flat assignment "${token}": ${err instanceof Error ? err.message : String(err)}`,
        { token, rawValue }
      );
    }

    assertFiniteNumbers(parsed, token);
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
      { count: tokens.length, maxAssignments }
    );
  }

  return tokens.map((token) => parseSingleFlatAssignment(token, options));
}
