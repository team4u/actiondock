import type { SchemaFieldDefinition } from "./schema";
import type { ValidationErrorData } from "./types";
import { prettyJson } from "./utils";

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isInteger(value: unknown): value is number {
  return isFiniteNumber(value) && Number.isInteger(value);
}

function isMatchingSchemaFieldValue(field: SchemaFieldDefinition, value: unknown): boolean {
  switch (field.kind) {
    case "boolean":
      return typeof value === "boolean";
    case "number":
      return isFiniteNumber(value);
    case "integer":
      return isInteger(value);
    case "enum":
      return typeof value === "string" && Boolean(field.enumValues?.includes(value));
    case "string":
      return typeof value === "string";
    default:
      return false;
  }
}

function readSchemaFieldDefaultValue(field: SchemaFieldDefinition): unknown {
  const value = field.defaultValue;
  return isMatchingSchemaFieldValue(field, value) ? value : undefined;
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

function buildSchemaFieldPlaceholderValue(field: SchemaFieldDefinition): unknown {
  switch (field.kind) {
    case "enum":
      return field.enumValues?.[0] ?? "";
    case "boolean":
      return true;
    case "integer":
    case "number":
      return 1;
    case "string":
    default:
      return `${field.name}-example`;
  }
}

export function buildSchemaFieldExampleValues(
  fields: SchemaFieldDefinition[]
): Record<string, unknown> {
  return fields.reduce<Record<string, unknown>>((result, field) => {
    const exampleValue = field.examples?.find((item) => isMatchingSchemaFieldValue(field, item));
    if (exampleValue !== undefined) {
      result[field.name] = exampleValue;
      return result;
    }

    const defaultValue = readSchemaFieldDefaultValue(field);
    if (defaultValue !== undefined) {
      result[field.name] = defaultValue;
      return result;
    }

    result[field.name] = buildSchemaFieldPlaceholderValue(field);
    return result;
  }, {});
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
