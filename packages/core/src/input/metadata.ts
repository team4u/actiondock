import { DEFAULT_MAX_INPUT_BYTES } from "./file-input";
import { DEFAULT_MAX_JSON_DEPTH } from "../json/value-validator";
import {
  DEFAULT_MAX_ASSIGNMENTS,
  DEFAULT_MAX_PATH_DEPTH,
  DEFAULT_MAX_PATH_LENGTH,
  DEFAULT_MAX_PROPERTY_KEY_LENGTH,
  DEFAULT_MAX_RAW_VALUE_LENGTH,
  DEFAULT_MAX_JSON_LITERAL_LENGTH,
  DEFAULT_MAX_TOTAL_RAW_BYTES,
  DEFAULT_MAX_ARRAY_INDEX,
  DEFAULT_MAX_MATERIALIZED_SIZE_BYTES,
} from "./flat-parser";
import { FORBIDDEN_ACTION_INPUT_PROPERTIES } from "./flat-predicates";
import { buildCliInputAdviceV1, type CliInputAdviceV1 } from "./advice";

/**
 * CLI 输入传输机制元数据契约（v1）。
 */
export interface InputTransportV1 {
  version: 1;
  defaultInputMode: "empty-object";
  fullJson: {
    inlineOption: "--input";
    fileOption: "--input-file";
    stdinValue: "-";
    preferredLargeInputMode: "stdin";
    encoding: "utf-8";
    maxInputBytes: number;
    maxJsonDepth: number;
  };
}

/**
 * CLI 扁平编码规格元数据契约（v1）。
 */
export interface CliInputEncodingV1 {
  name: "flat-json-value";
  version: 1;
  scope: "cli-argv";
  root: "object";
  operators: {
    string: "=";
    json: ":=";
  };
  limits: {
    maxAssignments: number;
    maxPathDepth: number;
    maxPathBytes: number;
    maxPropertyKeyBytes: number;
    maxRawValueBytes: number;
    maxJsonLiteralBytes: number;
    maxTotalRawBytes: number;
    maxArrayIndex: number;
    maxMaterializedBytes: number;
    maxJsonDepth: number;
  };
}

/**
 * CLI 输入安全策略元数据契约（v1）。
 */
export interface InputPolicyV1 {
  version: 1;
  scope: "cli-pre-target";
  propertyScope: "recursive";
  forbiddenPropertyNames: readonly string[];
}

/**
 * CLI describe --json 输入元数据聚合契约（v1）。
 */
export interface CliDescribeInputMetadataV1 {
  inputTransport: InputTransportV1;
  inputEncoding: CliInputEncodingV1;
  inputPolicy: InputPolicyV1;
  inputAdvice: CliInputAdviceV1;
}

/**
 * CLI 输入错误信封结构契约。
 */
export interface CliInputErrorEnvelope {
  ok: false;
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

/**
 * 构造输入传输层元数据（v1）。
 */
export function buildInputTransportV1(): InputTransportV1 {
  return {
    version: 1,
    defaultInputMode: "empty-object",
    fullJson: {
      inlineOption: "--input",
      fileOption: "--input-file",
      stdinValue: "-",
      preferredLargeInputMode: "stdin",
      encoding: "utf-8",
      maxInputBytes: DEFAULT_MAX_INPUT_BYTES,
      maxJsonDepth: DEFAULT_MAX_JSON_DEPTH,
    },
  };
}

/**
 * 构造 CLI 扁平输入编码元数据（v1）。
 */
export function buildCliInputEncodingV1(): CliInputEncodingV1 {
  return {
    name: "flat-json-value",
    version: 1,
    scope: "cli-argv",
    root: "object",
    operators: {
      string: "=",
      json: ":=",
    },
    limits: {
      maxAssignments: DEFAULT_MAX_ASSIGNMENTS,
      maxPathDepth: DEFAULT_MAX_PATH_DEPTH,
      maxPathBytes: DEFAULT_MAX_PATH_LENGTH,
      maxPropertyKeyBytes: DEFAULT_MAX_PROPERTY_KEY_LENGTH,
      maxRawValueBytes: DEFAULT_MAX_RAW_VALUE_LENGTH,
      maxJsonLiteralBytes: DEFAULT_MAX_JSON_LITERAL_LENGTH,
      maxTotalRawBytes: DEFAULT_MAX_TOTAL_RAW_BYTES,
      maxArrayIndex: DEFAULT_MAX_ARRAY_INDEX,
      maxMaterializedBytes: DEFAULT_MAX_MATERIALIZED_SIZE_BYTES,
      maxJsonDepth: DEFAULT_MAX_JSON_DEPTH,
    },
  };
}

/**
 * 构造输入策略元数据（v1）。
 * 明确标注 scope 为 "cli-pre-target"，防止远端目标未隔离策略造成歧义。
 */
export function buildInputPolicyV1(): InputPolicyV1 {
  return {
    version: 1,
    scope: "cli-pre-target",
    propertyScope: "recursive",
    forbiddenPropertyNames: FORBIDDEN_ACTION_INPUT_PROPERTIES,
  };
}

/**
 * 聚合构造 CLI describe --json 所需的完整输入元数据。
 *
 * @param schema Action 的 inputSchema 定义
 * @returns 包含 transport、encoding、policy 与 advice 的聚合元数据对象
 */
export function buildCliDescribeInputMetadataV1(schema: unknown): CliDescribeInputMetadataV1 {
  return {
    inputTransport: buildInputTransportV1(),
    inputEncoding: buildCliInputEncodingV1(),
    inputPolicy: buildInputPolicyV1(),
    inputAdvice: buildCliInputAdviceV1(schema),
  };
}

/**
 * 格式化输入异常为 CLI 人类可读文本。
 */
export function formatInputErrorForCli(err: unknown): string {
  const message = (err as any)?.message || String(err);
  return `Error: ${message}`;
}

/**
 * 将输入异常转换为统一的 CLI 错误信封结构。
 */
export function toCliInputErrorEnvelope(err: unknown): CliInputErrorEnvelope {
  const code = (err as any)?.code || "INVALID_ARGUMENT";
  const message = (err as any)?.message || String(err);
  const details = (err as any)?.details;
  return {
    ok: false,
    error: {
      code,
      message,
      ...(details !== undefined ? { details } : {}),
    },
  };
}
