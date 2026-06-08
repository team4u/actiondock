import { inspect } from "node:util";

import type { SchemaFieldDescriptor } from "../types.js";

export function formatSupplement(field: SchemaFieldDescriptor): string {
  const fragments: string[] = [];
  if (field.enumValues.length > 0) {
    fragments.push(`enum=${field.enumValues.join("|")}`);
  }
  if (field.defaultValue !== undefined) {
    fragments.push(`default=${JSON.stringify(field.defaultValue)}`);
  }
  if (field.description) {
    fragments.push(field.description);
  }
  return fragments.length > 0 ? ` (${fragments.join("; ")})` : "";
}

export function indent(text: string): string {
  return text
    .split("\n")
    .map((line) => `  ${line}`)
    .join("\n");
}

export function formatValue(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return inspect(value, { depth: 6, colors: false });
  }
}
