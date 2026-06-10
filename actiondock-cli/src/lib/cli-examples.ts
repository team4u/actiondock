import { isRecord } from "./error.js";
import type { SchemaFieldDescriptor } from "./types.js";

type CliValue = string | number | boolean;

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\"'\"'`)}'`;
}

function buildCliFlag(name: string, value: CliValue): string {
  if (typeof value === "boolean") {
    return value ? `--${name}` : `--${name} ${shellQuote("false")}`;
  }
  return `--${name} ${shellQuote(String(value))}`;
}

function isFlatCliValue(value: unknown): value is CliValue {
  return typeof value === "string"
    || typeof value === "boolean"
    || (typeof value === "number" && Number.isFinite(value));
}

function isMatchingFieldValue(field: SchemaFieldDescriptor, value: unknown): boolean {
  switch (field.kind) {
    case "boolean":
      return typeof value === "boolean";
    case "number":
      return typeof value === "number" && Number.isFinite(value);
    case "integer":
      return typeof value === "number" && Number.isInteger(value);
    case "enum":
      return typeof value === "string" && field.enumValues.includes(value);
    case "object":
      return isRecord(value);
    case "array":
      return Array.isArray(value);
    case "string":
      return typeof value === "string";
    default:
      return value !== undefined;
  }
}

function placeholderValue(field: SchemaFieldDescriptor): unknown {
  switch (field.kind) {
    case "boolean":
      return true;
    case "integer":
    case "number":
      return 1;
    case "enum":
      return field.enumValues[0] ?? `${field.name}-example`;
    case "object":
      return {};
    case "array":
      return [];
    case "string":
    default:
      return `${field.name}-example`;
  }
}

function exampleValue(field: SchemaFieldDescriptor): unknown {
  const example = field.examples.find((item) => isMatchingFieldValue(field, item));
  if (example !== undefined) {
    return example;
  }
  if (field.defaultValue !== undefined && isMatchingFieldValue(field, field.defaultValue)) {
    return field.defaultValue;
  }
  return placeholderValue(field);
}

export function buildSchemaExampleObject(fields: SchemaFieldDescriptor[]): Record<string, unknown> {
  return fields.reduce<Record<string, unknown>>((result, field) => {
    result[field.name] = exampleValue(field);
    return result;
  }, {});
}

function buildObjectInputFlags(input: Record<string, unknown>, jsonFlagName: string): string[] {
  const result: string[] = [];
  const jsonRemainder: Record<string, unknown> = {};

  for (const [name, value] of Object.entries(input)) {
    if (isFlatCliValue(value)) {
      result.push(buildCliFlag(name, value));
    } else {
      jsonRemainder[name] = value;
    }
  }

  if (Object.keys(jsonRemainder).length > 0) {
    result.push(buildCliFlag(jsonFlagName, JSON.stringify(jsonRemainder)));
  }

  return result;
}

export function buildScriptRunExampleCliCommand(params: {
  draft?: boolean;
  fields: SchemaFieldDescriptor[];
  scriptId: string;
}): {
  command: string;
  input: Record<string, unknown>;
} {
  const input = buildSchemaExampleObject(params.fields);
  const args = [
    shellQuote(params.scriptId),
    ...(params.draft ? ["--draft"] : []),
    ...buildObjectInputFlags(input, "input-json")
  ];
  return {
    command: ["actiondock script run", ...args].join(" "),
    input
  };
}

export function buildPluginInvokeExampleCliCommand(params: {
  action: string;
  args?: Record<string, unknown>;
  fields: SchemaFieldDescriptor[];
  pluginId: string;
}): {
  args: Record<string, unknown>;
  command: string;
} {
  const argsObject = params.args && Object.keys(params.args).length > 0
    ? params.args
    : buildSchemaExampleObject(params.fields);
  const commandArgs = [
    shellQuote(params.pluginId),
    shellQuote(params.action),
    ...buildObjectInputFlags(argsObject, "args-json")
  ];
  return {
    args: argsObject,
    command: ["actiondock plugin invoke", ...commandArgs].join(" ")
  };
}
