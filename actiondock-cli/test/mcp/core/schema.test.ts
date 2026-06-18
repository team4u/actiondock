import { describe, expect, it } from "vitest";
import * as z from "zod";

import { jsonSchemaToZod } from "../../../src/mcp/core/schema.js";

describe("jsonSchemaToZod", () => {
  it("converts primitive types", () => {
    expect(jsonSchemaToZod({ type: "string" })).toBeInstanceOf(z.ZodString);
    expect(jsonSchemaToZod({ type: "number" })).toBeInstanceOf(z.ZodNumber);
    expect(jsonSchemaToZod({ type: "integer" })).toBeInstanceOf(z.ZodNumber);
    expect(jsonSchemaToZod({ type: "boolean" })).toBeInstanceOf(z.ZodBoolean);
  });

  it("validates integer accepts whole numbers only", () => {
    const schema = z.object({ n: jsonSchemaToZod({ type: "integer" }) });
    expect(schema.safeParse({ n: 3 }).success).toBe(true);
    expect(schema.safeParse({ n: 3.5 }).success).toBe(false);
  });

  it("converts string with enum into a ZodEnum", () => {
    const converted = jsonSchemaToZod({ type: "string", enum: ["a", "b"] });
    expect(converted).toBeInstanceOf(z.ZodEnum);
    const schema = z.object({ v: converted });
    expect(schema.safeParse({ v: "a" }).success).toBe(true);
    expect(schema.safeParse({ v: "c" }).success).toBe(false);
  });

  it("converts string with empty enum into a plain string", () => {
    expect(jsonSchemaToZod({ type: "string", enum: [] })).toBeInstanceOf(z.ZodString);
  });

  it("converts arrays", () => {
    const converted = jsonSchemaToZod({ type: "array", items: { type: "string" } });
    expect(converted).toBeInstanceOf(z.ZodArray);
    const schema = z.object({ list: converted });
    expect(schema.safeParse({ list: ["a", "b"] }).success).toBe(true);
    expect(schema.safeParse({ list: [1] }).success).toBe(false);
  });

  it("converts objects with required and optional fields", () => {
    const converted = jsonSchemaToZod({
      type: "object",
      required: ["name"],
      properties: {
        name: { type: "string" },
        age: { type: "number" }
      }
    });
    const schema = z.object({ input: converted });
    expect(schema.safeParse({ input: { name: "bob" } }).success).toBe(true);
    expect(schema.safeParse({ input: {} }).success).toBe(false);
    expect(schema.safeParse({ input: { name: "bob", age: 3 } }).success).toBe(true);
  });

  it("returns z.record for objects without properties", () => {
    expect(jsonSchemaToZod({ type: "object" })).toBeInstanceOf(z.ZodRecord);
  });

  it("falls back to z.unknown for unrecognized types", () => {
    expect(jsonSchemaToZod({ type: "whatever" })).toBeInstanceOf(z.ZodUnknown);
  });

  it("falls back to z.unknown for null/non-object schemas", () => {
    expect(jsonSchemaToZod(null)).toBeInstanceOf(z.ZodUnknown);
    expect(jsonSchemaToZod(undefined)).toBeInstanceOf(z.ZodUnknown);
    expect(jsonSchemaToZod("not-an-object")).toBeInstanceOf(z.ZodUnknown);
  });

  it("wraps a non-object root as z.object({ input: z.record(z.unknown()) })", () => {
    const converted = jsonSchemaToZod(null, true);
    expect(converted).toBeInstanceOf(z.ZodObject);
    expect(converted.safeParse({ input: { anything: 1 } }).success).toBe(true);
  });
});
