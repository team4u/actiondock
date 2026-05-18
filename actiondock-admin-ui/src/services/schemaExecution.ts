import type { SchemaFieldDefinition } from "../services/schema";
import type { ValidationErrorData } from "../shared/types";
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
    case "object":
      return typeof value === "object" && value !== null && !Array.isArray(value);
    case "array":
      return Array.isArray(value);
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

export function buildSchemaFieldMergedState(
  newFields: SchemaFieldDefinition[],
  previousFormValues: Record<string, unknown>,
  previousJsonText: string
): {
  formValues: Record<string, unknown>;
  jsonText: string;
} {
  const defaults = buildSchemaFieldInitialValues(newFields);

  const mergedFormValues: Record<string, unknown> = {};
  for (const field of newFields) {
    const previous = previousFormValues[field.name];
    if (previous !== undefined && isMatchingSchemaFieldValue(field, previous)) {
      mergedFormValues[field.name] = previous;
    } else if (defaults[field.name] !== undefined) {
      mergedFormValues[field.name] = defaults[field.name];
    }
  }

  let mergedJsonText: string;
  try {
    const previousJson = JSON.parse(previousJsonText || "{}");
    if (typeof previousJson === "object" && previousJson !== null && !Array.isArray(previousJson)) {
      const mergedJson: Record<string, unknown> = {};
      for (const field of newFields) {
        const previousJsonValue = (previousJson as Record<string, unknown>)[field.name];
        if (previousJsonValue !== undefined && isMatchingSchemaFieldValue(field, previousJsonValue)) {
          mergedJson[field.name] = previousJsonValue;
        } else if (defaults[field.name] !== undefined) {
          mergedJson[field.name] = defaults[field.name];
        }
      }
      mergedJsonText = prettyJson(mergedJson);
    } else {
      mergedJsonText = prettyJson(mergedFormValues);
    }
  } catch {
    mergedJsonText = prettyJson(mergedFormValues);
  }

  return { formValues: mergedFormValues, jsonText: mergedJsonText };
}

export function buildSchemaFieldRefillState(
  fields: SchemaFieldDefinition[],
  input: Record<string, unknown> | undefined
): {
  formValues: Record<string, unknown>;
  jsonText: string;
  compatibleWithSchemaForm: boolean;
} {
  const source = input ?? {};
  const fieldMap = new Map(fields.map((field) => [field.name, field]));
  const formValues: Record<string, unknown> = {};
  let compatibleWithSchemaForm = true;

  Object.entries(source).forEach(([name, value]) => {
    const field = fieldMap.get(name);
    if (!field || !isMatchingSchemaFieldValue(field, value)) {
      compatibleWithSchemaForm = false;
      return;
    }
    formValues[name] = value;
  });

  return {
    formValues,
    jsonText: prettyJson(source),
    compatibleWithSchemaForm
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
    case "object":
      return {};
    case "array":
      return [];
    case "string":
    default:
      return `${field.name}-example`;
  }
}

export function buildSchemaFieldExampleValues(
  fields: SchemaFieldDefinition[]
): Record<string, unknown> {
  return fields.reduce<Record<string, unknown>>((result, field) => {
    if (field.kind === "object" && field.children) {
      result[field.name] = buildSchemaFieldExampleValues(field.children);
      return result;
    }

    if (field.kind === "array" && field.items) {
      if (field.items.kind === "object" && field.items.children) {
        result[field.name] = [buildSchemaFieldExampleValues(field.items.children)];
      } else {
        result[field.name] = [buildSchemaFieldPlaceholderValue(field.items)];
      }
      return result;
    }

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
