import fs from "node:fs";

import { ActionDockCliError, isRecord } from "./error.js";
import type { SchemaFieldDescriptor } from "./types.js";

export interface ParsedDynamicInput {
  input: Record<string, unknown>;
  dynamicFields: string[];
}

export interface InputJsonLabels {
  jsonFlag: string;
  fileFlag: string;
}

const DEFAULT_BOOLEAN_FLAGS = new Set(["draft", "json"]);
const DEFAULT_VALUE_FLAGS = new Set([
  "server",
  "token",
  "profile",
  "mode",
  "response-view",
  "input-json",
  "input-file",
  "args-json",
  "args-file",
  "script-input-json",
  "script-input-file",
  "value-json",
  "value-file",
  "expires-at",
  "expected-version"
]);

export function collectDynamicFlags(
  argv: string[],
  options: {
    positionals: string[];
    booleanFlags?: Iterable<string>;
    valueFlags?: Iterable<string>;
  }
): Map<string, string | boolean> {
  const result = new Map<string, string | boolean>();
  const positionalQueue = [...options.positionals];
  const knownBooleanFlags = new Set([...DEFAULT_BOOLEAN_FLAGS, ...(options.booleanFlags ?? [])]);
  const knownValueFlags = new Set([...DEFAULT_VALUE_FLAGS, ...(options.valueFlags ?? [])]);

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token) {
      continue;
    }

    if (!token.startsWith("-")) {
      if (positionalQueue.length > 0 && token === positionalQueue[0]) {
        positionalQueue.shift();
        continue;
      }
      throw new ActionDockCliError(`不支持额外的位置参数: ${token}`, 2);
    }

    if (token === "--") {
      throw new ActionDockCliError("不支持 `--` 后附加自由参数，请直接使用 `--name value` 形式。", 2);
    }

    if (token.startsWith("--")) {
      const withoutPrefix = token.slice(2);
      const [name, inlineValue] = splitInlineFlag(withoutPrefix);
      if (!name) {
        continue;
      }

      if (knownBooleanFlags.has(name)) {
        continue;
      }

      if (knownValueFlags.has(name)) {
        if (inlineValue === undefined) {
          index += 1;
        }
        continue;
      }

      if (inlineValue !== undefined) {
        result.set(name, inlineValue);
        continue;
      }

      const next = argv[index + 1];
      if (next === undefined || next.startsWith("-")) {
        result.set(name, true);
        continue;
      }

      result.set(name, next);
      index += 1;
      continue;
    }

    throw new ActionDockCliError(`不支持短参数: ${token}`, 2);
  }

  return result;
}

export function parseInputObject(
  inputJson: string | undefined,
  inputFile: string | undefined,
  labels: InputJsonLabels = {
    jsonFlag: "`--input-json`",
    fileFlag: "`--input-file`"
  }
): Record<string, unknown> {
  const parsed = parseJsonInput(inputJson, inputFile, labels);
  if (parsed === undefined) {
    return {};
  }
  if (!isRecord(parsed)) {
    throw new ActionDockCliError(`${resolveJsonSourceName(inputJson, inputFile, labels)} 顶层必须是 JSON 对象。`, 2);
  }
  return parsed;
}

export function parseJsonValueInput(
  inputJson: string | undefined,
  inputFile: string | undefined,
  labels: InputJsonLabels
): unknown {
  return parseJsonInput(inputJson, inputFile, labels);
}

function parseJsonInput(
  inputJson: string | undefined,
  inputFile: string | undefined,
  labels: InputJsonLabels
): unknown {
  if (inputJson && inputFile) {
    throw new ActionDockCliError(`${labels.jsonFlag} 和 ${labels.fileFlag} 不能同时使用。`, 2);
  }

  if (inputJson) {
    return parseJsonText(inputJson, labels.jsonFlag);
  }

  if (inputFile) {
    const text = fs.readFileSync(inputFile, "utf8");
    return parseJsonText(text, labels.fileFlag);
  }

  return undefined;
}

export function buildInputFromSchema(
  baseInput: Record<string, unknown>,
  dynamicFlags: Map<string, string | boolean>,
  fields: SchemaFieldDescriptor[],
  labels: InputJsonLabels = {
    jsonFlag: "`--input-json`",
    fileFlag: "`--input-file`"
  }
): ParsedDynamicInput {
  const result: Record<string, unknown> = { ...baseInput };
  const dynamicFieldNames: string[] = [];
  const fieldMap = new Map(fields.map((field) => [field.name, field]));

  for (const [name, rawValue] of dynamicFlags.entries()) {
    const field = fieldMap.get(name);

    if (!field) {
      if (fields.length > 0) {
        throw new ActionDockCliError(`未知参数: --${name}`, 2);
      }
      result[name] = fallbackValue(rawValue);
      dynamicFieldNames.push(name);
      continue;
    }

    if (!field.supportsFlag) {
      throw new ActionDockCliError(`字段 ${name} 属于 ${field.kind}，请改用 ${labels.jsonFlag} 或 ${labels.fileFlag} 提供。`, 2);
    }

    result[name] = coerceValue(field, rawValue);
    dynamicFieldNames.push(name);
  }

  const missingRequired = fields
    .filter((field) => field.required)
    .filter((field) => !Object.hasOwn(result, field.name));

  if (missingRequired.length > 0) {
    throw new ActionDockCliError(
      `缺少必填参数: ${missingRequired.map((field) => `--${field.name}`).join(", ")}`,
      2,
      missingRequired.map((field) => ({ field: field.name, kind: field.kind }))
    );
  }

  return { input: result, dynamicFields: dynamicFieldNames };
}

function parseJsonText(text: string, source: string): unknown {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new ActionDockCliError(`${source} 不是合法 JSON: ${detail}`, 2);
  }

  return parsed;
}

function resolveJsonSourceName(
  inputJson: string | undefined,
  inputFile: string | undefined,
  labels: InputJsonLabels
): string {
  if (inputJson) {
    return labels.jsonFlag;
  }
  if (inputFile) {
    return labels.fileFlag;
  }
  return "JSON 输入";
}

function fallbackValue(rawValue: string | boolean): unknown {
  if (typeof rawValue === "boolean") {
    return rawValue;
  }
  if (rawValue === "true") return true;
  if (rawValue === "false") return false;
  return rawValue;
}

function coerceValue(field: SchemaFieldDescriptor, rawValue: string | boolean): unknown {
  if (field.kind === "boolean") {
    return parseBoolean(rawValue, field.name);
  }

  if (typeof rawValue === "boolean") {
    throw new ActionDockCliError(`字段 ${field.name} 需要显式值，例如 \`--${field.name} value\`。`, 2);
  }

  switch (field.kind) {
    case "string":
      return rawValue;
    case "number":
      return parseNumber(rawValue, field.name);
    case "integer":
      return parseInteger(rawValue, field.name);
    case "enum":
      if (!field.enumValues.includes(rawValue)) {
        throw new ActionDockCliError(
          `字段 ${field.name} 只能是以下值之一: ${field.enumValues.join(", ")}`,
          2
        );
      }
      return rawValue;
    default:
      return rawValue;
  }
}

function parseBoolean(value: string | boolean, fieldName: string): boolean {
  if (typeof value === "boolean") {
    return value;
  }
  const normalized = value.toLowerCase();
  if (["true", "1", "yes", "on"].includes(normalized)) return true;
  if (["false", "0", "no", "off"].includes(normalized)) return false;
  throw new ActionDockCliError(`字段 ${fieldName} 需要布尔值，例如 true/false。`, 2);
}

function parseNumber(value: string, fieldName: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new ActionDockCliError(`字段 ${fieldName} 需要数字。`, 2);
  }
  return parsed;
}

function parseInteger(value: string, fieldName: string): number {
  if (!/^-?\d+$/.test(value)) {
    throw new ActionDockCliError(`字段 ${fieldName} 需要整数。`, 2);
  }
  return Number(value);
}

function splitInlineFlag(flag: string): [string, string | undefined] {
  const index = flag.indexOf("=");
  if (index < 0) {
    return [flag, undefined];
  }
  return [flag.slice(0, index), flag.slice(index + 1)];
}
