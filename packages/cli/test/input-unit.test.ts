import assert from "node:assert/strict";
import { describe, it } from "node:test";

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
import {
  INVALID_ARGUMENT,
  INVALID_FLAT_ARGUMENT,
  INPUT_LIMIT_EXCEEDED,
} from "@actiondock/core";

describe("CLI Action Input Resolution - Unit Tests", () => {
  it("stripBom removes leading BOM character and preserves clean string", () => {
    assert.strictEqual(stripBom("\uFEFFhello"), "hello");
    assert.strictEqual(stripBom("hello"), "hello");
    assert.strictEqual(stripBom("\uFEFF{\"a\":1}"), "{\"a\":1}");
    assert.strictEqual(stripBom(""), "");
  });

  it("parseJson correctly parses valid JSON objects, arrays, and primitives", () => {
    assert.deepStrictEqual(parseJson("{\"name\":\"Alice\"}", "--input"), { name: "Alice" });
    assert.deepStrictEqual(parseJson("[1, 2, 3]", "--input"), [1, 2, 3]);
    assert.strictEqual(parseJson("\"hello\"", "--input"), "hello");
    assert.strictEqual(parseJson("123", "--input"), 123);
    assert.strictEqual(parseJson("true", "--input"), true);
    assert.deepStrictEqual(parseJson("\uFEFF{\"name\":\"WithBOM\"}", "--input"), { name: "WithBOM" });
  });

  it("parseJson throws InputError with INVALID_JSON code on invalid JSON", () => {
    assert.throws(() => parseJson("{bad json}", "--input"), InputError);
    try {
      parseJson("{bad json}", "--input");
      assert.strictEqual(true, false);
    } catch (err: any) {
      assert.ok(err instanceof InputError);
      assert.strictEqual(err.code, "INVALID_JSON");
      assert.ok((err.message).includes("Invalid JSON input from --input"));
    }

    try {
      parseJson("", "input.json");
      assert.strictEqual(true, false);
    } catch (err: any) {
      assert.ok(err instanceof InputError);
      assert.strictEqual(err.code, "INVALID_JSON");
      assert.ok((err.message).includes("Invalid JSON input from input.json"));
    }
  });

  it("parseJson throws InputError with INVALID_JSON on 1e400 (Infinity) or deep structure", () => {
    assert.throws(() => parseJson("1e400", "--input"), InputError);
    try {
      parseJson("1e400", "--input");
      assert.strictEqual(true, false);
    } catch (err: any) {
      assert.ok(err instanceof InputError);
      assert.strictEqual(err.code, "INVALID_JSON");
      assert.ok((err.message).includes("Number is non-finite or NaN"));
    }

    let deep = "1";
    for (let i = 0; i < 260; i++) {
      deep = `{"inner":${deep}}`;
    }
    assert.throws(() => parseJson(deep, "--input"), InputError);
    try {
      parseJson(deep, "--input");
      assert.strictEqual(true, false);
    } catch (err: any) {
      assert.ok(err instanceof InputError);
      assert.strictEqual(err.code, "INVALID_JSON");
      assert.ok((err.message).includes("Max JSON depth limit"));
    }
  });

  it("readStdin reads full stream content", async () => {
    const stream = Readable.from(["hello ", "world"]);
    const text = await readStdin(stream);
    assert.strictEqual(text, "hello world");
  });

  it("readStdin strips leading BOM and keeps lenient UTF-8 decoding", async () => {
    const bomStream = Readable.from([Buffer.from("\uFEFFhello", "utf-8")]);
    const text = await readStdin(bomStream);
    assert.strictEqual(text, "hello");

    // 非法 UTF-8 字节在宽松模式下以替换字符呈现，不抛出异常
    const invalidStream = Readable.from([Buffer.from([0xff, 0xfe, 0x61])]);
    const lenient = await readStdin(invalidStream);
    assert.strictEqual(lenient.includes(String.fromCodePoint(0xfffd)), true);
  });

  it("readStdin rejects input exceeding default 10MB bound with INPUT_LIMIT_EXCEEDED", async () => {
    // 默认 10MB 上限保护：超出即抛结构化异常，错误消息对用户友好
    const huge = Buffer.alloc(10 * 1024 * 1024 + 1, 0x61);
    const stream = Readable.from([huge]);
    try {
      await readStdin(stream);
      assert.strictEqual(true, false);
    } catch (err: any) {
      assert.ok(err instanceof InputError);
      assert.strictEqual(err.code, INPUT_LIMIT_EXCEEDED);
      assert.ok((err.message).includes("Stdin input exceeds maximum limit"));
    }
  });

  it("resolveActionInput returns {} when neither input nor inputFile is provided", async () => {
    const res = await resolveActionInput({});
    assert.deepStrictEqual(res, {});
  });

  it("resolveActionInput throws INPUT_CONFLICT when both input and inputFile are specified", async () => {
    try {
      await resolveActionInput({ input: "{\"a\":1}", inputFile: "test.json" });
      assert.strictEqual(true, false);
    } catch (err: any) {
      assert.ok(err instanceof InputError);
      assert.ok(!(err instanceof FlatInputError));
      assert.strictEqual(err.code, "INPUT_CONFLICT");
      assert.ok((err.message).includes("mutually exclusive"));
    }
  });

  it("resolveActionInput parses inline JSON", async () => {
    const res = await resolveActionInput({ input: "{\"name\":\"Test\"}" });
    assert.deepStrictEqual(res, { name: "Test" });
  });

  it("resolveActionInput reads and parses from stdin when inputFile is '-'", async () => {
    const stream = Readable.from(["{\"from\":\"stdin\"}"]);
    const res = await resolveActionInput({ inputFile: "-", stdin: stream });
    assert.deepStrictEqual(res, { from: "stdin" });
  });

  it("resolveActionInput throws INPUT_FILE_NOT_FOUND when file does not exist", async () => {
    try {
      await resolveActionInput({ inputFile: "nonexistent_file_12345.json" });
      assert.strictEqual(true, false);
    } catch (err: any) {
      assert.ok(err instanceof InputError);
      assert.ok(!(err instanceof FlatInputError));
      assert.strictEqual(err.code, "INPUT_FILE_NOT_FOUND");
      assert.strictEqual(err.message, "Input file not found: nonexistent_file_12345.json");
    }
  });

  it("resolveActionInput throws INPUT_FILE_READ_FAILED when reading file fails", async () => {
    try {
      await resolveActionInput({ inputFile: tmpdir() });
      assert.strictEqual(true, false);
    } catch (err: any) {
      assert.ok(err instanceof InputError);
      assert.ok(!(err instanceof FlatInputError));
      assert.strictEqual(err.code, "INPUT_FILE_READ_FAILED");
    }
  });

  it("verifies InputError and FlatInputError inheritance", () => {
    const baseErr = new InputError(INVALID_ARGUMENT, "test message");
    assert.ok(baseErr instanceof InputError);
    assert.ok(!(baseErr instanceof FlatInputError));

    const flatErr = new FlatInputError(INVALID_FLAT_ARGUMENT, "flat message");
    assert.ok(flatErr instanceof FlatInputError);
    assert.ok(flatErr instanceof InputError);
  });
});
