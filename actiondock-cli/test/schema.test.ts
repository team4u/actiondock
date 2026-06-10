import { describe, expect, it } from "vitest";

import { extractSchemaFields, splitSchemaFields } from "../src/lib/schema.js";
import { buildSchemaReplacePatch } from "../src/lib/script.js";

describe("extractSchemaFields", () => {
  it("extracts top-level fields and classifies enum/object support", () => {
    const fields = extractSchemaFields({
      type: "object",
      required: ["name", "payload"],
      properties: {
        name: { type: "string", description: "user name" },
        enabled: { type: "boolean" },
        status: { type: "string", enum: ["active", "disabled"] },
        payload: { type: "object" }
      }
    });

    expect(fields).toEqual([
      expect.objectContaining({ name: "name", kind: "string", required: true, supportsFlag: true }),
      expect.objectContaining({ name: "enabled", kind: "boolean", required: false, supportsFlag: true }),
      expect.objectContaining({ name: "status", kind: "enum", enumValues: ["active", "disabled"], supportsFlag: true }),
      expect.objectContaining({ name: "payload", kind: "object", required: true, supportsFlag: false })
    ]);

    const split = splitSchemaFields(fields);
    expect(split.flagFields.map((field) => field.name)).toEqual(["name", "enabled", "status"]);
    expect(split.jsonOnlyFields.map((field) => field.name)).toEqual(["payload"]);
  });
});

describe("buildSchemaReplacePatch", () => {
  it("adds null entries for removed properties", () => {
    const current = {
      type: "object",
      required: ["name", "count"],
      properties: {
        name: { type: "string" },
        count: { type: "integer" },
        payload: { type: "object" }
      }
    };
    const newSchema = {
      type: "object",
      required: ["name"],
      properties: {
        name: { type: "string" }
      }
    };
    const patch = buildSchemaReplacePatch(current, newSchema);
    expect(patch.properties).toEqual({
      name: { type: "string" },
      count: null,
      payload: null
    });
  });

  it("preserves all top-level keys from new schema", () => {
    const current = {
      type: "object",
      properties: { old: { type: "string" } }
    };
    const newSchema = {
      type: "object",
      required: ["new"],
      properties: { new: { type: "boolean" } },
      description: "new description"
    };
    const patch = buildSchemaReplacePatch(current, newSchema);
    expect(patch).toEqual({
      type: "object",
      required: ["new"],
      description: "new description",
      properties: {
        new: { type: "boolean" },
        old: null
      }
    });
  });

  it("handles null current schema (no existing properties to null)", () => {
    const patch = buildSchemaReplacePatch(null, {
      type: "object",
      properties: { name: { type: "string" } }
    });
    expect(patch.properties).toEqual({ name: { type: "string" } });
  });

  it("handles undefined current schema", () => {
    const patch = buildSchemaReplacePatch(undefined, {
      type: "object",
      properties: { name: { type: "string" } }
    });
    expect(patch.properties).toEqual({ name: { type: "string" } });
  });

  it("handles new schema without properties key (all current properties nulled)", () => {
    const current = {
      type: "object",
      properties: { a: { type: "string" }, b: { type: "number" } }
    };
    const newSchema = { type: "object" };
    const patch = buildSchemaReplacePatch(current, newSchema);
    expect(patch.properties).toEqual({ a: null, b: null });
  });

  it("handles empty new properties (all current properties nulled)", () => {
    const current = {
      type: "object",
      properties: { a: { type: "string" } }
    };
    const newSchema = { type: "object", properties: {} };
    const patch = buildSchemaReplacePatch(current, newSchema);
    expect(patch.properties).toEqual({ a: null });
  });
});
