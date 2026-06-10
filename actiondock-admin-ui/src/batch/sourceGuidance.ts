import { buildSchemaFieldExampleValues } from "../services/schemaExecution";
import { prettyJson } from "../services/utils";
import type { SchemaFieldDefinition } from "../services/schema";
import { getCsvMappableFields } from "./parser";
import type { BatchInputSource } from "./types";

export interface BatchSourceGuidance {
  useCase: string;
  formatRules: string[];
  cautions: string[];
  example: string;
}

function createVariantValue(value: unknown, suffix: number): unknown {
  if (typeof value === "string") {
    return value.length > 0 ? `${value}-${suffix}` : `example-${suffix}`;
  }
  if (typeof value === "number") {
    return value + suffix;
  }
  if (typeof value === "boolean") {
    return suffix % 2 === 0 ? value : !value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => createVariantValue(item, suffix));
  }
  if (value && typeof value === "object") {
    return Object.entries(value).reduce<Record<string, unknown>>((result, [key, item]) => {
      result[key] = createVariantValue(item, suffix);
      return result;
    }, {});
  }
  return value;
}

function buildExampleRows(
  supportedFields: SchemaFieldDefinition[]
): Array<Record<string, unknown>> {
  const firstRow = buildSchemaFieldExampleValues(supportedFields);
  const secondRow = createVariantValue(firstRow, 2);
  return [firstRow, secondRow as Record<string, unknown>];
}

function escapeCsvCell(value: unknown): string {
  const text = value === undefined || value === null ? "" : String(value);
  if (!/[",\n]/.test(text)) {
    return text;
  }
  return `"${text.replace(/"/g, "\"\"")}"`;
}

function buildCsvExample(fields: SchemaFieldDefinition[]): string {
  const csvFields = getCsvMappableFields(fields);
  if (csvFields.length === 0) {
    return "";
  }

  const sampleValues = buildSchemaFieldExampleValues(csvFields);
  const headers = csvFields.map((field) => field.name);
  const row = csvFields.map((field) => escapeCsvCell(sampleValues[field.name]));
  return [headers.join(","), row.join(",")].join("\n");
}

export function buildBatchSourceExample(
  sourceType: BatchInputSource,
  supportedFields: SchemaFieldDefinition[]
): string {
  if (sourceType === "CSV") {
    return buildCsvExample(supportedFields);
  }

  const rows = buildExampleRows(supportedFields);
  if (sourceType === "JSONL") {
    return rows.map((row) => JSON.stringify(row)).join("\n");
  }

  return prettyJson(rows);
}

export function getBatchSourcePlaceholder(sourceType: BatchInputSource): string {
  switch (sourceType) {
    case "JSON_ARRAY":
      return '例如：[{"orderId":"A001"},{"orderId":"A002"}]';
    case "JSONL":
      return '例如：{"orderId":"A001"}\\n{"orderId":"A002"}';
    case "CSV":
      return "例如：orderId,retryCount";
    default:
      return "请输入批量数据";
  }
}

export function buildBatchSourceGuidance(args: {
  sourceType: BatchInputSource;
  supportedFields: SchemaFieldDefinition[];
  jsonOnlyFieldLabels: string[];
}): BatchSourceGuidance {
  const { sourceType, supportedFields, jsonOnlyFieldLabels } = args;
  const needsJsonFields = jsonOnlyFieldLabels.length > 0
    ? `以下字段建议改用 JSON 维护：${jsonOnlyFieldLabels.join("、")}`
    : null;

  if (sourceType === "JSONL") {
    return {
      useCase: "适合逐行粘贴或导入日志、流式结果、每行一条记录的数据源。",
      formatRules: [
        "每行必须是一个独立的 JSON 对象",
        "空行会自动忽略"
      ],
      cautions: [
        "适合逐条修改或追加记录，不需要再包一层数组",
        needsJsonFields ?? "复杂结构只做基础结构检查，完整校验仍由后端执行"
      ],
      example: buildBatchSourceExample(sourceType, supportedFields)
    };
  }

  if (sourceType === "CSV") {
    const csvFields = getCsvMappableFields(supportedFields);
    return {
      useCase: "适合表格类批量导入，只处理简单顶层字段。",
      formatRules: [
        "第一行必须是表头",
        "表头会先按字段名自动匹配，不匹配时可在参数映射里调整"
      ],
      cautions: [
        csvFields.length > 0
          ? "布尔值使用 true/false，数字列会自动转换为 number/integer"
          : "当前脚本没有可映射的简单字段，请改用 JSON 数组或 JSONL",
        needsJsonFields ?? "不支持 object / array 等复杂字段"
      ],
      example: buildBatchSourceExample(sourceType, supportedFields)
    };
  }

  return {
    useCase: "适合直接粘贴一批结构化对象，尤其是需要保留嵌套 object / array 时。",
    formatRules: [
      "顶层必须是数组",
      "数组中的每一项都必须是对象"
    ],
    cautions: [
      "一次粘贴整批数据最直观，也最适合先整体检查再提交",
      needsJsonFields ?? "复杂结构只做基础结构检查，完整校验仍由后端执行"
    ],
    example: buildBatchSourceExample(sourceType, supportedFields)
  };
}
