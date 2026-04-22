import type { SchemaFieldDefinition } from "./schema";
import type { ValidationErrorData } from "./types";
import { prettyJson } from "./utils";

function readSchemaFieldDefaultValue(field: SchemaFieldDefinition): unknown {
  const value = field.defaultValue;

  switch (field.kind) {
    case "boolean":
      return typeof value === "boolean" ? value : undefined;
    case "number":
    case "integer":
      return typeof value === "number" ? value : undefined;
    case "enum":
      return typeof value === "string" && field.enumValues?.includes(value) ? value : undefined;
    case "string":
      return typeof value === "string" ? value : undefined;
    default:
      return undefined;
  }
}

export function buildSchemaFieldInitialValues(
  fields: SchemaFieldDefinition[]
): Record<string, unknown> {
  return fields.reduce<Record<string, unknown>>((result, field) => {
    const value = readSchemaFieldDefaultValue(field);
    if (value !== undefined) {
      result[field.name] = value;
    }
    return result;
  }, {});
}

export function buildSchemaFieldInitialState(fields: SchemaFieldDefinition[]): {
  formValues: Record<string, unknown>;
  jsonText: string;
} {
  const formValues = buildSchemaFieldInitialValues(fields);
  return {
    formValues,
    jsonText: prettyJson(formValues)
  };
}

export function buildSchemaExecutionInput(
  fields: SchemaFieldDefinition[],
  values: Record<string, unknown> | undefined
): Record<string, unknown> {
  return fields.reduce<Record<string, unknown>>((result, field) => {
    const value = values?.[field.name];
    if (value === undefined || value === null) {
      return result;
    }
    if (value === "" && field.defaultValue !== "") {
      return result;
    }
    result[field.name] = value;
    return result;
  }, {});
}

export function formatSchemaFieldSupplement(field: SchemaFieldDefinition): string | null {
  const segments: string[] = [];

  if (field.description) {
    segments.push(field.description);
  }
  if (field.defaultValue !== undefined) {
    segments.push(`默认值: ${JSON.stringify(field.defaultValue)}`);
  }
  if (field.examples && field.examples.length > 0) {
    segments.push(`示例: ${field.examples.map((item) => JSON.stringify(item)).join(" / ")}`);
  }

  return segments.length > 0 ? segments.join("  ") : null;
}

export function formatSchemaFieldDescription(field: SchemaFieldDefinition): string | null {
  const description = field.description?.trim();
  return description ? description : null;
}

export function isValidationErrorData(value: unknown): value is ValidationErrorData {
  return Boolean(value) && typeof value === "object" && Array.isArray((value as ValidationErrorData).fieldErrors);
}
