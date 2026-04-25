import { describe, expect, it } from "vitest";
import type { SchemaFieldDefinition } from "./schema";
import { buildSchemaFieldExampleValues } from "./schemaExecution";

describe("buildSchemaFieldExampleValues", () => {
  it("prefers the first matching schema example", () => {
    const fields: SchemaFieldDefinition[] = [
      {
        name: "message",
        label: "Message",
        kind: "string",
        required: true,
        examples: [1, "hello", "ignored"],
        defaultValue: "default-message"
      },
      {
        name: "enabled",
        label: "Enabled",
        kind: "boolean",
        required: false,
        examples: ["bad", false],
        defaultValue: true
      }
    ];

    expect(buildSchemaFieldExampleValues(fields)).toEqual({
      message: "hello",
      enabled: false
    });
  });

  it("falls back to valid defaults and then type placeholders", () => {
    const fields: SchemaFieldDefinition[] = [
      {
        name: "status",
        label: "Status",
        kind: "enum",
        required: false,
        enumValues: ["ready", "draft"],
        defaultValue: "draft"
      },
      {
        name: "count",
        label: "Count",
        kind: "integer",
        required: false,
        defaultValue: 3
      },
      {
        name: "price",
        label: "Price",
        kind: "number",
        required: false
      },
      {
        name: "note",
        label: "Note",
        kind: "string",
        required: false
      }
    ];

    expect(buildSchemaFieldExampleValues(fields)).toEqual({
      status: "draft",
      count: 3,
      price: 1,
      note: "note-example"
    });
  });

  it("ignores invalid examples and defaults before using placeholders", () => {
    const fields: SchemaFieldDefinition[] = [
      {
        name: "count",
        label: "Count",
        kind: "integer",
        required: false,
        examples: [1.5],
        defaultValue: 2.5
      },
      {
        name: "enabled",
        label: "Enabled",
        kind: "boolean",
        required: false,
        examples: ["true"],
        defaultValue: "false"
      },
      {
        name: "status",
        label: "Status",
        kind: "enum",
        required: false,
        enumValues: ["ready", "draft"],
        examples: ["invalid"],
        defaultValue: "missing"
      }
    ];

    expect(buildSchemaFieldExampleValues(fields)).toEqual({
      count: 1,
      enabled: true,
      status: "ready"
    });
  });
});
