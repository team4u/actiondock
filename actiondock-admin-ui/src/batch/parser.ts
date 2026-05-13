import Papa from "papaparse";
import type { SchemaFieldDefinition } from "../services/schema";
import type {
  BatchDraftItem,
  BatchSourceDraft,
  BatchValidationResult,
  CsvColumnMapping,
  CsvSourceData
} from "./types";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function createItemId(rowIndex: number): string {
  return `row_${rowIndex}_${Math.random().toString(36).slice(2, 8)}`;
}

function findField(fields: SchemaFieldDefinition[], name: string): SchemaFieldDefinition | undefined {
  return fields.find((field) => field.name === name);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isInteger(value: unknown): value is number {
  return isFiniteNumber(value) && Number.isInteger(value);
}

function isRecordLike(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isCsvMappableKind(kind: SchemaFieldDefinition["kind"]): boolean {
  return ["string", "number", "integer", "boolean", "enum"].includes(kind);
}

export function getCsvMappableFields(
  supportedFields: SchemaFieldDefinition[]
): SchemaFieldDefinition[] {
  return supportedFields.filter((field) => isCsvMappableKind(field.kind));
}

function matchesFieldType(field: SchemaFieldDefinition, value: unknown): boolean {
  switch (field.kind) {
    case "string":
      return typeof value === "string";
    case "number":
      return isFiniteNumber(value);
    case "integer":
      return isInteger(value);
    case "boolean":
      return typeof value === "boolean";
    case "enum":
      return typeof value === "string" && Boolean(field.enumValues?.includes(value));
    case "object":
      return isRecordLike(value);
    case "array":
      return Array.isArray(value);
    default:
      return false;
  }
}

function detectValueType(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (typeof value === "object") return "object";
  return typeof value;
}

export function parseJsonArraySource(text: string): Array<Record<string, unknown>> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text || "[]");
  } catch (error) {
    const detail = error instanceof Error ? error.message : "格式错误";
    throw new Error(`JSON 数组不是合法 JSON: ${detail}`);
  }

  if (!Array.isArray(parsed)) {
    throw new Error("JSON 数组顶层必须是数组");
  }

  return parsed.map((item, index) => {
    if (!isRecord(item)) {
      throw new Error(`第 ${index + 1} 条必须是对象`);
    }
    return item;
  });
}

export function parseJsonLinesSource(text: string): Array<Record<string, unknown>> {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  return lines.map((line, index) => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch (error) {
      const detail = error instanceof Error ? error.message : "格式错误";
      throw new Error(`第 ${index + 1} 行 JSONL 解析失败: ${detail}`);
    }
    if (!isRecord(parsed)) {
      throw new Error(`第 ${index + 1} 行必须是对象`);
    }
    return parsed;
  });
}

export function parseCsvSource(text: string): CsvSourceData {
  const result = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: "greedy",
    transformHeader: (header) => header.trim()
  });

  const blockingErrors = result.errors.filter((error) => !isIgnorableCsvError(error));
  if (blockingErrors.length > 0) {
    const first = blockingErrors[0];
    const rowNumber = typeof first.row === "number" ? first.row + 1 : 1;
    throw new Error(`CSV 解析失败: 第 ${rowNumber} 行 ${first.message}`);
  }

  const headers = result.meta.fields?.filter((field) => field.length > 0) ?? [];
  if (headers.length === 0) {
    throw new Error("CSV 缺少表头");
  }

  return {
    headers,
    rows: result.data.map((row) =>
      headers.reduce<Record<string, string>>((resultRow, header) => {
        resultRow[header] = row[header] ?? "";
        return resultRow;
      }, {})
    )
  };
}

function isIgnorableCsvError(error: Papa.ParseError): boolean {
  return error.type === "Delimiter" && error.code === "UndetectableDelimiter";
}

export function buildAutoCsvMapping(
  headers: string[],
  supportedFields: SchemaFieldDefinition[]
): CsvColumnMapping {
  const exactMap = new Map(supportedFields.map((field) => [field.name, field.name]));
  const lowerMap = new Map(supportedFields.map((field) => [field.name.toLowerCase(), field.name]));

  return headers.reduce<CsvColumnMapping>((mapping, header) => {
    mapping[header] = exactMap.get(header) ?? lowerMap.get(header.toLowerCase()) ?? null;
    return mapping;
  }, {});
}

export function validateBatchInput(
  input: Record<string, unknown>,
  supportedFields: SchemaFieldDefinition[]
): BatchValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const issues: BatchValidationResult["issues"] = [];
  const fieldMap = new Map(supportedFields.map((field) => [field.name, field]));

  for (const field of supportedFields) {
    const value = input[field.name];
    if (value === undefined) {
      if (field.required) {
        const message = `${field.label} 必填`;
        errors.push(message);
        issues.push({ field: field.name, message });
      }
      continue;
    }

    if (value === null) {
      const message = `${field.label} 不能为空`;
      errors.push(message);
      issues.push({ field: field.name, message });
      continue;
    }

    if (!matchesFieldType(field, value)) {
      const message =
        field.kind === "enum"
          ? `${field.label} 必须是枚举值之一: ${(field.enumValues ?? []).join(", ")}`
          : `${field.label} 类型应为 ${field.kind}，当前为 ${detectValueType(value)}`;
      errors.push(message);
      issues.push({ field: field.name, message });
    }
  }

  for (const key of Object.keys(input)) {
    if (!fieldMap.has(key)) {
      warnings.push(`字段 ${key} 未在 inputSchema 中声明，将按原样提交`);
    }
  }

  return { errors, warnings, issues };
}

export function buildDraftFromObjectRows(
  rows: Array<Record<string, unknown>>,
  supportedFields: SchemaFieldDefinition[]
): BatchSourceDraft {
  const items = rows.map<BatchDraftItem>((row, index) => {
    const validation = validateBatchInput(row, supportedFields);
    return {
      id: createItemId(index + 1),
      rowIndex: index + 1,
      input: row,
      errors: validation.errors,
      warnings: validation.warnings
    };
  });

  return {
    items,
    summary: buildDraftSummary(items)
  };
}

export function buildDraftFromCsvSource(args: {
  csv: CsvSourceData;
  mapping: CsvColumnMapping;
  supportedFields: SchemaFieldDefinition[];
  unsupportedFields: string[];
}): BatchSourceDraft {
  const { csv, mapping, supportedFields, unsupportedFields } = args;
  const items = csv.rows.map<BatchDraftItem>((row, index) => {
    const errors: string[] = [];
    const warnings: string[] = [];
    const input: Record<string, unknown> = {};

    if (supportedFields.length === 0) {
      errors.push("当前脚本没有可映射的简单输入字段，CSV 模式不可用");
    }
    if (unsupportedFields.length > 0) {
      warnings.push(`复杂字段仍需改用 JSON/JSONL：${unsupportedFields.join("、")}`);
    }

    for (const header of csv.headers) {
      const fieldName = mapping[header];
      const rawValue = row[header] ?? "";
      if (!fieldName) {
        if (rawValue.trim().length > 0) {
          warnings.push(`列 ${header} 未映射，将忽略该值`);
        }
        continue;
      }

      const field = findField(supportedFields, fieldName);
      if (!field) {
        warnings.push(`列 ${header} 映射到未知字段 ${fieldName}，将忽略`);
        continue;
      }

      const parsed = parseCsvCellValue(rawValue, field);
      if (parsed.error) {
        errors.push(`列 ${header}: ${parsed.error}`);
        continue;
      }
      if (parsed.value !== undefined) {
        input[field.name] = parsed.value;
      }
    }

    const validation = validateBatchInput(input, supportedFields);

    return {
      id: createItemId(index + 1),
      rowIndex: index + 1,
      input,
      errors: [...errors, ...validation.errors],
      warnings: [...warnings, ...validation.warnings]
    };
  });

  return {
    items,
    summary: buildDraftSummary(items)
  };
}

function buildDraftSummary(items: BatchDraftItem[]) {
  return {
    totalCount: items.length,
    validCount: items.filter((item) => item.errors.length === 0).length,
    invalidCount: items.filter((item) => item.errors.length > 0).length,
    warningCount: items.reduce((total, item) => total + item.warnings.length, 0)
  };
}

function parseCsvCellValue(rawValue: string, field: SchemaFieldDefinition): {
  value?: unknown;
  error?: string;
} {
  const trimmed = rawValue.trim();
  if (trimmed.length === 0) {
    return { value: undefined };
  }

  if (field.kind === "string") {
    return { value: rawValue };
  }

  if (field.kind === "enum") {
    if (field.enumValues?.includes(trimmed)) {
      return { value: trimmed };
    }
    return {
      error: `${field.label} 必须是枚举值之一: ${(field.enumValues ?? []).join(", ")}`
    };
  }

  if (field.kind === "boolean") {
    const normalized = trimmed.toLowerCase();
    if (["true", "1", "yes", "y"].includes(normalized)) {
      return { value: true };
    }
    if (["false", "0", "no", "n"].includes(normalized)) {
      return { value: false };
    }
    return { error: `${field.label} 需要布尔值（true/false）` };
  }

  if (field.kind === "number" || field.kind === "integer") {
    const value = Number(trimmed);
    if (!Number.isFinite(value)) {
      return { error: `${field.label} 需要数字` };
    }
    if (field.kind === "integer" && !Number.isInteger(value)) {
      return { error: `${field.label} 需要整数` };
    }
    return { value };
  }

  return { value: trimmed };
}
