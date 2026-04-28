import { describe, expect, it } from "vitest";

import { extractSchemaFields, splitSchemaFields } from "../src/lib/schema.js";

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
