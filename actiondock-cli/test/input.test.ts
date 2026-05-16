import { describe, expect, it } from "vitest";

import { ActionDockCliError } from "../src/lib/error.js";
import { buildInputFromSchema, collectDynamicFlags, parseInputObject, parseJsonValueInput } from "../src/lib/input.js";
import type { SchemaFieldDescriptor } from "../src/lib/types.js";

const fields: SchemaFieldDescriptor[] = [
  {
    name: "name",
    label: "name",
    kind: "string",
    required: true,
    enumValues: [],
    examples: [],
    supportsFlag: true
  },
  {
    name: "count",
    label: "count",
    kind: "integer",
    required: false,
    enumValues: [],
    examples: [],
    supportsFlag: true
  },
  {
    name: "enabled",
    label: "enabled",
    kind: "boolean",
    required: false,
    enumValues: [],
    examples: [],
    supportsFlag: true
  },
  {
    name: "payload",
    label: "payload",
    kind: "object",
    required: false,
    enumValues: [],
    examples: [],
    supportsFlag: false
  }
];

describe("collectDynamicFlags", () => {
  it("extracts only dynamic flags from argv", () => {
    const result = collectDynamicFlags(
      ["plugin-a", "summarize", "--response-view", "result", "--topic", "ops", "--enabled", "--count=3"],
      { positionals: ["plugin-a", "summarize"] }
    );

    expect([...result.entries()]).toEqual([
      ["topic", "ops"],
      ["enabled", true],
      ["count", "3"]
    ]);
  });

  it("skips reserved connection profile flags", () => {
    const result = collectDynamicFlags(
      ["script-a", "--profile", "local", "--server=http://127.0.0.1:5177", "--token", "secret", "--name", "Alice"],
      { positionals: ["script-a"] }
    );

    expect([...result.entries()]).toEqual([
      ["name", "Alice"]
    ]);
  });
});

describe("parseInputObject", () => {
  it("parses a JSON object string", () => {
    expect(parseInputObject('{"name":"Alice"}', undefined)).toEqual({ name: "Alice" });
  });

  it("rejects non-object JSON", () => {
    expect(() => parseInputObject('["x"]', undefined)).toThrow(ActionDockCliError);
  });

  it("returns an empty object when object input is omitted", () => {
    expect(parseInputObject(undefined, undefined)).toEqual({});
  });
});

describe("parseJsonValueInput", () => {
  it("parses any valid JSON value", () => {
    expect(parseJsonValueInput('["x",1]', undefined, {
      jsonFlag: "`--value-json`",
      fileFlag: "`--value-file`"
    })).toEqual(["x", 1]);
  });
});

describe("buildInputFromSchema", () => {
  it("merges base input with dynamic flags and coerces types", () => {
    const dynamicFlags = new Map<string, string | boolean>([
      ["name", "Alice"],
      ["count", "3"],
      ["enabled", true]
    ]);

    const result = buildInputFromSchema({ payload: { foo: "bar" } }, dynamicFlags, fields);
    expect(result.input).toEqual({
      name: "Alice",
      count: 3,
      enabled: true,
      payload: { foo: "bar" }
    });
  });

  it("rejects JSON-only fields passed as flat flags", () => {
    const dynamicFlags = new Map<string, string | boolean>([
      ["name", "Alice"],
      ["payload", '{"x":1}']
    ]);

    expect(() => buildInputFromSchema({}, dynamicFlags, fields)).toThrow(ActionDockCliError);
  });

  it("uses command-specific JSON labels for JSON-only field errors", () => {
    const dynamicFlags = new Map<string, string | boolean>([
      ["name", "Alice"],
      ["payload", '{"x":1}']
    ]);

    expect(() => buildInputFromSchema({}, dynamicFlags, fields, {
      jsonFlag: "`--args-json`",
      fileFlag: "`--args-file`"
    })).toThrow("字段 payload 属于 object，请改用 `--args-json` 或 `--args-file` 提供。");
  });

  it("rejects missing required fields", () => {
    expect(() => buildInputFromSchema({}, new Map(), fields)).toThrow(ActionDockCliError);
  });
});
