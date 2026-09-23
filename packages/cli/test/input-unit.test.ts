import { describe, expect, it, setDefaultTimeout } from "bun:test";
setDefaultTimeout(120000);
import { tmpdir } from "node:os";
import { Readable } from "node:stream";
import {
  parseJson,
  readStdin,
  resolveActionInput,
  stripBom,
} from "../src/utils/input";
import {
  FlatInputError,
  InputError,
} from "@actiondock/core/project";
import { INVALID_ARGUMENT, INVALID_FLAT_ARGUMENT } from "@actiondock/core";

describe("CLI Action Input Resolution - Unit Tests", () => {
  it("stripBom removes leading BOM character and preserves clean string", () => {
    expect(stripBom("\uFEFFhello")).toBe("hello");
    expect(stripBom("hello")).toBe("hello");
    expect(stripBom("\uFEFF{\"a\":1}")).toBe("{\"a\":1}");
    expect(stripBom("")).toBe("");
  });

  it("parseJson correctly parses valid JSON objects, arrays, and primitives", () => {
    expect(parseJson("{\"name\":\"Alice\"}", "--input")).toEqual({ name: "Alice" });
    expect(parseJson("[1, 2, 3]", "--input")).toEqual([1, 2, 3]);
    expect(parseJson("\"hello\"", "--input")).toBe("hello");
    expect(parseJson("123", "--input")).toBe(123);
    expect(parseJson("true", "--input")).toBe(true);
    expect(parseJson("\uFEFF{\"name\":\"WithBOM\"}", "--input")).toEqual({ name: "WithBOM" });
  });

  it("parseJson throws InputError with INVALID_JSON code on invalid JSON", () => {
    expect(() => parseJson("{bad json}", "--input")).toThrow(InputError);
    try {
      parseJson("{bad json}", "--input");
      expect(true).toBe(false);
    } catch (err: any) {
      expect(err).toBeInstanceOf(InputError);
      expect(err.code).toBe("INVALID_JSON");
      expect(err.message).toContain("Invalid JSON input from --input");
    }

    try {
      parseJson("", "input.json");
      expect(true).toBe(false);
    } catch (err: any) {
      expect(err).toBeInstanceOf(InputError);
      expect(err.code).toBe("INVALID_JSON");
      expect(err.message).toContain("Invalid JSON input from input.json");
    }
  });

  it("parseJson throws InputError with INVALID_JSON on 1e400 (Infinity) or deep structure", () => {
    expect(() => parseJson("1e400", "--input")).toThrow(InputError);
    try {
      parseJson("1e400", "--input");
      expect(true).toBe(false);
    } catch (err: any) {
      expect(err).toBeInstanceOf(InputError);
      expect(err.code).toBe("INVALID_JSON");
      expect(err.message).toContain("Number is non-finite or NaN");
    }

    let deep = "1";
    for (let i = 0; i < 260; i++) {
      deep = `{"inner":${deep}}`;
    }
    expect(() => parseJson(deep, "--input")).toThrow(InputError);
    try {
      parseJson(deep, "--input");
      expect(true).toBe(false);
    } catch (err: any) {
      expect(err).toBeInstanceOf(InputError);
      expect(err.code).toBe("INVALID_JSON");
      expect(err.message).toContain("Max JSON depth limit");
    }
  });

  it("readStdin reads full stream content", async () => {
    const stream = Readable.from(["hello ", "world"]);
    const text = await readStdin(stream);
    expect(text).toBe("hello world");
  });

  it("resolveActionInput returns {} when neither input nor inputFile is provided", async () => {
    const res = await resolveActionInput({});
    expect(res).toEqual({});
  });

  it("resolveActionInput throws INPUT_CONFLICT when both input and inputFile are specified", async () => {
    try {
      await resolveActionInput({ input: "{\"a\":1}", inputFile: "test.json" });
      expect(true).toBe(false);
    } catch (err: any) {
      expect(err).toBeInstanceOf(InputError);
      expect(err).not.toBeInstanceOf(FlatInputError);
      expect(err.code).toBe("INPUT_CONFLICT");
      expect(err.message).toContain("mutually exclusive");
    }
  });

  it("resolveActionInput parses inline JSON", async () => {
    const res = await resolveActionInput({ input: "{\"name\":\"Test\"}" });
    expect(res).toEqual({ name: "Test" });
  });

  it("resolveActionInput reads and parses from stdin when inputFile is '-'", async () => {
    const stream = Readable.from(["{\"from\":\"stdin\"}"]);
    const res = await resolveActionInput({ inputFile: "-", stdin: stream });
    expect(res).toEqual({ from: "stdin" });
  });

  it("resolveActionInput throws INPUT_FILE_NOT_FOUND when file does not exist", async () => {
    try {
      await resolveActionInput({ inputFile: "nonexistent_file_12345.json" });
      expect(true).toBe(false);
    } catch (err: any) {
      expect(err).toBeInstanceOf(InputError);
      expect(err).not.toBeInstanceOf(FlatInputError);
      expect(err.code).toBe("INPUT_FILE_NOT_FOUND");
      expect(err.message).toBe("Input file not found: nonexistent_file_12345.json");
    }
  });

  it("resolveActionInput throws INPUT_FILE_READ_FAILED when reading file fails", async () => {
    try {
      await resolveActionInput({ inputFile: tmpdir() });
      expect(true).toBe(false);
    } catch (err: any) {
      expect(err).toBeInstanceOf(InputError);
      expect(err).not.toBeInstanceOf(FlatInputError);
      expect(err.code).toBe("INPUT_FILE_READ_FAILED");
    }
  });

  it("verifies InputError and FlatInputError inheritance", () => {
    const baseErr = new InputError(INVALID_ARGUMENT, "test message");
    expect(baseErr).toBeInstanceOf(InputError);
    expect(baseErr).not.toBeInstanceOf(FlatInputError);

    const flatErr = new FlatInputError(INVALID_FLAT_ARGUMENT, "flat message");
    expect(flatErr).toBeInstanceOf(FlatInputError);
    expect(flatErr).toBeInstanceOf(InputError);
  });
});
