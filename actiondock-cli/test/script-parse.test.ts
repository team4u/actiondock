import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ActionDockCliError } from "../src/lib/error.js";
import {
  buildSchemaReplacePatch,
  parsePatchObject,
  parseSchemaInput,
  resolveOptionalTextInput,
  resolveScriptSource,
  setPatchField,
} from "../src/lib/script.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ad-script-test-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

function writeTmpFile(content: string, name = "file.txt"): string {
  const file = path.join(tmpDir, name);
  fs.writeFileSync(file, content);
  return file;
}

const defaultSchemaLabels = {
  jsonFlag: "`--input-schema-json`",
  fileFlag: "`--input-schema-file`"
};

// ---------------------------------------------------------------------------
// resolveScriptSource
// ---------------------------------------------------------------------------
describe("resolveScriptSource", () => {
  it("returns inline source string", () => {
    expect(resolveScriptSource("print('hello')", undefined, true)).toBe("print('hello')");
  });

  it("reads source from file", () => {
    const file = writeTmpFile("print('from file')");
    expect(resolveScriptSource(undefined, file, true)).toBe("print('from file')");
  });

  it("throws when both source and sourceFile are provided", () => {
    expect(() => resolveScriptSource("inline", "file.txt", true)).toThrow(ActionDockCliError);
  });

  it("throws when required and neither source nor file provided", () => {
    expect(() => resolveScriptSource(undefined, undefined, true)).toThrow(ActionDockCliError);
  });

  it("returns undefined when not required and nothing provided", () => {
    expect(resolveScriptSource(undefined, undefined, false)).toBeUndefined();
  });

  it("returns inline source even when not required", () => {
    expect(resolveScriptSource("code", undefined, false)).toBe("code");
  });

  it("reads file source when not required", () => {
    const file = writeTmpFile("file-code");
    expect(resolveScriptSource(undefined, file, false)).toBe("file-code");
  });

  it("prefers inline source over file when both are given (error case)", () => {
    // This should throw, not prefer one
    expect(() => resolveScriptSource("inline", "file.txt", false)).toThrow(ActionDockCliError);
  });
});

// ---------------------------------------------------------------------------
// resolveOptionalTextInput
// ---------------------------------------------------------------------------
describe("resolveOptionalTextInput", () => {
  const labels = { valueFlag: "`--desc`", fileFlag: "`--desc-file`" };

  it("returns inline value", () => {
    expect(resolveOptionalTextInput("hello", undefined, labels)).toBe("hello");
  });

  it("reads value from file", () => {
    const file = writeTmpFile("from file");
    expect(resolveOptionalTextInput(undefined, file, labels)).toBe("from file");
  });

  it("throws when both value and file are provided", () => {
    expect(() => resolveOptionalTextInput("inline", "file.txt", labels)).toThrow(ActionDockCliError);
  });

  it("returns undefined when nothing provided", () => {
    expect(resolveOptionalTextInput(undefined, undefined, labels)).toBeUndefined();
  });

  it("returns empty string value when explicitly provided", () => {
    // Empty string is a valid explicit value
    expect(resolveOptionalTextInput("", undefined, labels)).toBe("");
  });
});

// ---------------------------------------------------------------------------
// parseSchemaInput
// ---------------------------------------------------------------------------
describe("parseSchemaInput", () => {
  it("parses valid JSON object", () => {
    const result = parseSchemaInput('{"type":"object"}', undefined, defaultSchemaLabels);
    expect(result).toEqual({ type: "object" });
  });

  it("parses schema from file", () => {
    const file = writeTmpFile(JSON.stringify({ type: "object", properties: {} }), "schema.json");
    const result = parseSchemaInput(undefined, file, defaultSchemaLabels);
    expect(result).toEqual({ type: "object", properties: {} });
  });

  it("returns undefined when nothing provided", () => {
    expect(parseSchemaInput(undefined, undefined, defaultSchemaLabels)).toBeUndefined();
  });

  it("throws when value is not an object (number)", () => {
    expect(() => parseSchemaInput("42", undefined, defaultSchemaLabels)).toThrow(ActionDockCliError);
  });

  it("throws when value is not an object (array)", () => {
    expect(() => parseSchemaInput("[1,2]", undefined, defaultSchemaLabels)).toThrow(ActionDockCliError);
  });

  it("throws when both json and file provided", () => {
    const file = writeTmpFile("{}", "schema.json");
    expect(() => parseSchemaInput("{}", file, defaultSchemaLabels)).toThrow(ActionDockCliError);
  });

  it("throws on invalid JSON", () => {
    expect(() => parseSchemaInput("{bad", undefined, defaultSchemaLabels)).toThrow(ActionDockCliError);
  });
});

// ---------------------------------------------------------------------------
// buildSchemaReplacePatch
// ---------------------------------------------------------------------------
describe("buildSchemaReplacePatch", () => {
  it("adds null entries for properties removed from current schema", () => {
    const current = {
      type: "object",
      properties: {
        name: { type: "string" },
        age: { type: "integer" },
        email: { type: "string" }
      }
    };
    const newSchema = {
      type: "object",
      properties: {
        name: { type: "string" },
        email: { type: "string" }
      }
    };
    const patch = buildSchemaReplacePatch(current, newSchema);
    expect(patch.properties).toEqual({
      name: { type: "string" },
      email: { type: "string" },
      age: null
    });
  });

  it("does not add null for properties that exist in both", () => {
    const current = { type: "object", properties: { a: { type: "string" } } };
    const newSchema = { type: "object", properties: { a: { type: "number" } } };
    const patch = buildSchemaReplacePatch(current, newSchema);
    expect(patch.properties).toEqual({ a: { type: "number" } });
  });

  it("handles null current schema", () => {
    const newSchema = { type: "object", properties: { x: { type: "string" } } };
    const patch = buildSchemaReplacePatch(null, newSchema);
    expect(patch.properties).toEqual({ x: { type: "string" } });
  });

  it("handles undefined current schema", () => {
    const newSchema = { type: "object", properties: { x: { type: "string" } } };
    const patch = buildSchemaReplacePatch(undefined, newSchema);
    expect(patch.properties).toEqual({ x: { type: "string" } });
  });

  it("handles current schema without properties", () => {
    const current = { type: "object" };
    const newSchema = { type: "object", properties: { x: { type: "string" } } };
    const patch = buildSchemaReplacePatch(current, newSchema);
    expect(patch.properties).toEqual({ x: { type: "string" } });
  });

  it("handles current schema with non-object properties", () => {
    const current = { type: "object", properties: "not-an-object" };
    const newSchema = { type: "object", properties: { x: { type: "string" } } };
    const patch = buildSchemaReplacePatch(current, newSchema);
    // current properties is invalid, so nothing to null
    expect(patch.properties).toEqual({ x: { type: "string" } });
  });

  it("handles current schema with null properties", () => {
    const current = { type: "object", properties: null };
    const newSchema = { type: "object", properties: { x: { type: "string" } } };
    const patch = buildSchemaReplacePatch(current, newSchema);
    expect(patch.properties).toEqual({ x: { type: "string" } });
  });

  it("handles current schema with array properties", () => {
    const current = { type: "object", properties: [1, 2, 3] };
    const newSchema = { type: "object", properties: { x: { type: "string" } } };
    const patch = buildSchemaReplacePatch(current, newSchema);
    expect(patch.properties).toEqual({ x: { type: "string" } });
  });

  it("nulled properties from current when new schema has no properties key", () => {
    const current = { type: "object", properties: { a: { type: "string" } } };
    const newSchema = { type: "object" };
    const patch = buildSchemaReplacePatch(current, newSchema);
    expect(patch.properties).toEqual({ a: null });
  });

  it("preserves all other top-level keys from new schema", () => {
    const current = { type: "object", properties: {} };
    const newSchema = {
      type: "object",
      required: ["name"],
      description: "desc",
      additionalProperties: false,
      properties: { name: { type: "string" } }
    };
    const patch = buildSchemaReplacePatch(current, newSchema);
    expect(patch.required).toEqual(["name"]);
    expect(patch.description).toBe("desc");
    expect(patch.additionalProperties).toBe(false);
  });

  it("new properties added that were not in current are kept", () => {
    const current = { type: "object", properties: { old: { type: "string" } } };
    const newSchema = { type: "object", properties: { new: { type: "number" }, old: { type: "string" } } };
    const patch = buildSchemaReplacePatch(current, newSchema);
    expect(patch.properties).toEqual({ new: { type: "number" }, old: { type: "string" } });
  });
});

// ---------------------------------------------------------------------------
// parsePatchObject
// ---------------------------------------------------------------------------
describe("parsePatchObject", () => {
  it("returns empty object when nothing provided", () => {
    expect(parsePatchObject(undefined, undefined)).toEqual({});
  });

  it("parses valid JSON patch object", () => {
    const result = parsePatchObject('{"name":"test","source":"code"}', undefined);
    expect(result.name).toBe("test");
    expect(result.source).toBe("code");
  });

  it("parses patch from file", () => {
    const file = writeTmpFile(JSON.stringify({ name: "from-file" }), "patch.json");
    const result = parsePatchObject(undefined, file);
    expect(result.name).toBe("from-file");
  });

  it("normalizes desc alias to description", () => {
    const result = parsePatchObject('{"desc":"my desc"}', undefined);
    expect(result.description).toBe("my desc");
    expect(result.desc).toBeUndefined();
  });

  it("normalizes inputSchemaPatch alias to inputSchema", () => {
    const result = parsePatchObject('{"inputSchemaPatch":{"type":"object"}}', undefined);
    expect(result.inputSchema).toEqual({ type: "object" });
    expect(result.inputSchemaPatch).toBeUndefined();
  });

  it("normalizes outputSchemaPatch alias to outputSchema", () => {
    const result = parsePatchObject('{"outputSchemaPatch":{"type":"object"}}', undefined);
    expect(result.outputSchema).toEqual({ type: "object" });
    expect(result.outputSchemaPatch).toBeUndefined();
  });

  it("throws when desc alias conflicts with explicit description", () => {
    expect(() => parsePatchObject('{"desc":"a","description":"b"}', undefined)).toThrow(ActionDockCliError);
  });

  it("throws when inputSchemaPatch conflicts with explicit inputSchema", () => {
    expect(() => parsePatchObject('{"inputSchemaPatch":{},"inputSchema":{}}', undefined)).toThrow(ActionDockCliError);
  });

  it("throws when outputSchemaPatch conflicts with explicit outputSchema", () => {
    expect(() => parsePatchObject('{"outputSchemaPatch":{},"outputSchema":{}}', undefined)).toThrow(ActionDockCliError);
  });

  it("throws when patch is not an object (array)", () => {
    expect(() => parsePatchObject("[1,2,3]", undefined)).toThrow(ActionDockCliError);
  });

  it("throws when patch is not an object (string)", () => {
    expect(() => parsePatchObject('"hello"', undefined)).toThrow(ActionDockCliError);
  });

  it("throws when both json and file provided", () => {
    const file = writeTmpFile("{}", "patch.json");
    expect(() => parsePatchObject("{}", file)).toThrow(ActionDockCliError);
  });

  it("throws on invalid JSON", () => {
    expect(() => parsePatchObject("{bad", undefined)).toThrow(ActionDockCliError);
  });
});

// ---------------------------------------------------------------------------
// setPatchField
// ---------------------------------------------------------------------------
describe("setPatchField", () => {
  it("sets a field on the patch object", () => {
    const patch: Record<string, unknown> = {};
    setPatchField(patch, "name", "test");
    expect(patch.name).toBe("test");
  });

  it("sets description field", () => {
    const patch: Record<string, unknown> = {};
    setPatchField(patch, "description", "my desc");
    expect(patch.description).toBe("my desc");
  });

  it("sets source field", () => {
    const patch: Record<string, unknown> = {};
    setPatchField(patch, "source", "print('hi')");
    expect(patch.source).toBe("print('hi')");
  });

  it("sets inputSchema field with an object", () => {
    const patch: Record<string, unknown> = {};
    const schema = { type: "object", properties: {} };
    setPatchField(patch, "inputSchema", schema);
    expect(patch.inputSchema).toEqual(schema);
  });

  it("sets outputSchema field with an object", () => {
    const patch: Record<string, unknown> = {};
    const schema = { type: "object" };
    setPatchField(patch, "outputSchema", schema);
    expect(patch.outputSchema).toEqual(schema);
  });

  it("sets pythonRequirements field", () => {
    const patch: Record<string, unknown> = {};
    setPatchField(patch, "pythonRequirements", "requests==2.28.0");
    expect(patch.pythonRequirements).toBe("requests==2.28.0");
  });

  it("throws when field is already present in the patch", () => {
    const patch: Record<string, unknown> = { name: "existing" };
    expect(() => setPatchField(patch, "name", "new")).toThrow(ActionDockCliError);
  });

  it("allows setting a field to undefined (when not already set)", () => {
    const patch: Record<string, unknown> = {};
    setPatchField(patch, "name", undefined);
    expect(patch.name).toBeUndefined();
    expect(Object.hasOwn(patch, "name")).toBe(true);
  });
});
