import { isRecord } from "./error.js";
import type { SchemaFieldDescriptor } from "./types.js";

export function extractSchemaFields(schema: Record<string, unknown> | undefined): SchemaFieldDescriptor[] {
  if (!isRecord(schema)) {
    return [];
  }
  const properties = isRecord(schema.properties) ? schema.properties : null;
  if (!properties) {
    return [];
  }
  const required = new Set(
    Array.isArray(schema.required) ? schema.required.filter((value): value is string => typeof value === "string") : []
  );

  return Object.entries(properties).map(([name, rawMeta]) => parseField(name, rawMeta, required.has(name)));
}

function parseField(name: string, rawMeta: unknown, required: boolean): SchemaFieldDescriptor {
  const meta = isRecord(rawMeta) ? rawMeta : {};
  const label = typeof meta.title === "string" && meta.title.trim() ? meta.title : name;
  const description = typeof meta.description === "string" && meta.description.trim() ? meta.description : undefined;
  const enumValues = Array.isArray(meta.enum) && meta.enum.every((item) => typeof item === "string")
    ? [...meta.enum]
    : [];
  const examples = Array.isArray(meta.examples) ? [...meta.examples] : [];
  const type = typeof meta.type === "string" ? meta.type : undefined;

  if (enumValues.length > 0) {
    return {
      name,
      label,
      kind: "enum",
      required,
      description,
      enumValues,
      defaultValue: meta.default,
      examples,
      supportsFlag: true
    };
  }

  const kind = type ?? "unknown";
  return {
    name,
    label,
    kind,
    required,
    description,
    enumValues,
    defaultValue: meta.default,
    examples,
    supportsFlag: kind === "string" || kind === "number" || kind === "integer" || kind === "boolean"
  };
}

export function splitSchemaFields(fields: SchemaFieldDescriptor[]) {
  return {
    flagFields: fields.filter((field) => field.supportsFlag),
    jsonOnlyFields: fields.filter((field) => !field.supportsFlag)
  };
}
