import { describe, expect, it } from "vitest";
import type { SchemaFieldDefinition } from "../services/schema";
import {
  buildSchemaFieldExampleValues,
  buildSchemaFieldMergedState,
  buildSchemaFieldRefillState
} from "../services/schemaExecution";

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

describe("buildSchemaFieldMergedState", () => {
  it("preserves all values when schema is unchanged", () => {
    const fields: SchemaFieldDefinition[] = [
      { name: "name", label: "Name", kind: "string", required: true },
      { name: "count", label: "Count", kind: "integer", required: false }
    ];
    const previous = { name: "test", count: 5 };

    const result = buildSchemaFieldMergedState(fields, previous, '{"name":"test","count":5}');

    expect(result.formValues).toEqual({ name: "test", count: 5 });
    expect(JSON.parse(result.jsonText)).toEqual({ name: "test", count: 5 });
  });

  it("uses defaults for new fields and preserves existing values", () => {
    const fields: SchemaFieldDefinition[] = [
      { name: "name", label: "Name", kind: "string", required: true },
      { name: "enabled", label: "Enabled", kind: "boolean", required: false, defaultValue: true }
    ];
    const previous = { name: "test" };

    const result = buildSchemaFieldMergedState(fields, previous, '{"name":"test"}');

    expect(result.formValues).toEqual({ name: "test", enabled: true });
  });

  it("drops removed fields", () => {
    const fields: SchemaFieldDefinition[] = [
      { name: "name", label: "Name", kind: "string", required: true }
    ];
    const previous = { name: "test", removedField: "gone" };

    const result = buildSchemaFieldMergedState(fields, previous, '{"name":"test","removedField":"gone"}');

    expect(result.formValues).toEqual({ name: "test" });
    expect(JSON.parse(result.jsonText)).toEqual({ name: "test" });
  });

  it("resets to default when field type changes incompatibly", () => {
    const fields: SchemaFieldDefinition[] = [
      { name: "count", label: "Count", kind: "number", required: false, defaultValue: 0 }
    ];
    const previous = { count: "not-a-number" };

    const result = buildSchemaFieldMergedState(fields, previous, '{"count":"not-a-number"}');

    expect(result.formValues).toEqual({ count: 0 });
  });

  it("resets enum when current value is no longer valid", () => {
    const fields: SchemaFieldDefinition[] = [
      { name: "status", label: "Status", kind: "enum", required: false, enumValues: ["active", "inactive"], defaultValue: "active" }
    ];
    const previous = { status: "deleted" };

    const result = buildSchemaFieldMergedState(fields, previous, '{"status":"deleted"}');

    expect(result.formValues).toEqual({ status: "active" });
  });

  it("preserves enum value that is still valid after enum values change", () => {
    const fields: SchemaFieldDefinition[] = [
      { name: "status", label: "Status", kind: "enum", required: false, enumValues: ["active", "inactive", "pending"] }
    ];
    const previous = { status: "active" };

    const result = buildSchemaFieldMergedState(fields, previous, '{"status":"active"}');

    expect(result.formValues).toEqual({ status: "active" });
  });

  it("falls back to form-derived JSON when previous JSON is invalid", () => {
    const fields: SchemaFieldDefinition[] = [
      { name: "name", label: "Name", kind: "string", required: true }
    ];
    const previous = { name: "test" };

    const result = buildSchemaFieldMergedState(fields, previous, "not valid json{");

    expect(result.formValues).toEqual({ name: "test" });
    expect(JSON.parse(result.jsonText)).toEqual({ name: "test" });
  });

  it("handles empty previous values and empty fields", () => {
    const result = buildSchemaFieldMergedState([], {}, "{}");

    expect(result.formValues).toEqual({});
    expect(result.jsonText).toBe("{}");
  });
});

describe("buildSchemaFieldRefillState", () => {
  it("keeps compatible history input available for both form and json", () => {
    const fields: SchemaFieldDefinition[] = [
      { name: "name", label: "Name", kind: "string", required: true },
      { name: "count", label: "Count", kind: "integer", required: false }
    ];

    const result = buildSchemaFieldRefillState(fields, {
      name: "Alice",
      count: 3
    });

    expect(result.compatibleWithSchemaForm).toBe(true);
    expect(result.formValues).toEqual({ name: "Alice", count: 3 });
    expect(JSON.parse(result.jsonText)).toEqual({ name: "Alice", count: 3 });
  });

  it("falls back to json preservation when history input has unsupported fields", () => {
    const fields: SchemaFieldDefinition[] = [
      { name: "name", label: "Name", kind: "string", required: true }
    ];

    const result = buildSchemaFieldRefillState(fields, {
      name: "Alice",
      metadata: { nested: true }
    });

    expect(result.compatibleWithSchemaForm).toBe(false);
    expect(result.formValues).toEqual({ name: "Alice" });
    expect(JSON.parse(result.jsonText)).toEqual({
      name: "Alice",
      metadata: { nested: true }
    });
  });

  it("falls back to json preservation when a supported field has an incompatible type", () => {
    const fields: SchemaFieldDefinition[] = [
      { name: "count", label: "Count", kind: "integer", required: false }
    ];

    const result = buildSchemaFieldRefillState(fields, {
      count: "3"
    });

    expect(result.compatibleWithSchemaForm).toBe(false);
    expect(result.formValues).toEqual({});
    expect(JSON.parse(result.jsonText)).toEqual({ count: "3" });
  });
});
