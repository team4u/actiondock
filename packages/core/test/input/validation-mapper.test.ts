import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  mapInputValidationFailure,
  InputError,
  FlatInputError,
  INVALID_JSON_LITERAL,
  INVALID_JSON,
  FLAT_INPUT_LIMIT_EXCEEDED,
  INPUT_LIMIT_EXCEEDED,
  INPUT_POLICY_VIOLATION,
  INPUT_NOT_JSON,
  INPUT_VALIDATION_FAILED,
} from "../../src/input";

describe("Source-Aware Validation Error Mapping (Section 19)", () => {
  describe("flat-json-literal 映射", () => {
    it("语法错误映射为 INVALID_JSON_LITERAL + SYNTAX_ERROR", () => {
      const err = mapInputValidationFailure("flat-json-literal", {
        valid: false,
        code: "SYNTAX_ERROR",
        reason: "Unexpected token",
        path: "/foo",
      });
      assert.ok(err instanceof FlatInputError);
      assert.strictEqual(err.code, INVALID_JSON_LITERAL);
      assert.strictEqual((err.details as any)?.reason, "SYNTAX_ERROR");
      assert.strictEqual((err.details as any)?.path, "/foo");
    });

    it("非有限数值映射为 INVALID_JSON_LITERAL + NON_FINITE_NUMBER", () => {
      const err = mapInputValidationFailure("flat-json-literal", {
        valid: false,
        code: "NON_FINITE_NUMBER",
        reason: "Number is non-finite or NaN (Infinity)",
        path: "/num",
      });
      assert.ok(err instanceof FlatInputError);
      assert.strictEqual(err.code, INVALID_JSON_LITERAL);
      assert.strictEqual((err.details as any)?.reason, "NON_FINITE_NUMBER");
      assert.strictEqual((err.details as any)?.path, "/num");
    });

    it("最大深度超限映射为 INVALID_JSON_LITERAL + MAX_JSON_DEPTH", () => {
      const err = mapInputValidationFailure("flat-json-literal", {
        valid: false,
        code: "MAX_JSON_DEPTH",
        reason: "Max JSON depth limit exceeded",
        path: "/deep",
      });
      assert.ok(err instanceof FlatInputError);
      assert.strictEqual(err.code, INVALID_JSON_LITERAL);
      assert.strictEqual((err.details as any)?.reason, "MAX_JSON_DEPTH");
      assert.strictEqual((err.details as any)?.path, "/deep");
    });

    it("其他非法 JsonValue 映射为 INVALID_JSON_LITERAL + INVALID_JSON_VALUE", () => {
      const err = mapInputValidationFailure("flat-json-literal", {
        valid: false,
        code: "INVALID_JSON_OBJECT",
        reason: "Object prototype must be Object.prototype or null",
        path: "/date",
      });
      assert.ok(err instanceof FlatInputError);
      assert.strictEqual(err.code, INVALID_JSON_LITERAL);
      assert.strictEqual((err.details as any)?.reason, "INVALID_JSON_VALUE");
      assert.strictEqual((err.details as any)?.path, "/date");
    });
  });

  describe("Full JSON（inline / file / stdin）映射", () => {
    it("语法错误映射为 INVALID_JSON + SYNTAX_ERROR 且携带正确 source", () => {
      const errInline = mapInputValidationFailure("full-json-inline", {
        valid: false,
        code: "SYNTAX_ERROR",
        reason: "JSON syntax error",
      });
      assert.ok(errInline instanceof InputError);
      assert.strictEqual(errInline.code, INVALID_JSON);
      assert.strictEqual((errInline.details as any)?.reason, "SYNTAX_ERROR");
      assert.strictEqual((errInline.details as any)?.source, "inline-json");

      const errFile = mapInputValidationFailure("full-json-file", {
        valid: false,
        code: "SYNTAX_ERROR",
        reason: "JSON syntax error",
      });
      assert.strictEqual(errFile.code, INVALID_JSON);
      assert.strictEqual((errFile.details as any)?.reason, "SYNTAX_ERROR");
      assert.strictEqual((errFile.details as any)?.source, "file");

      const errStdin = mapInputValidationFailure("full-json-stdin", {
        valid: false,
        code: "SYNTAX_ERROR",
        reason: "JSON syntax error",
      });
      assert.strictEqual(errStdin.code, INVALID_JSON);
      assert.strictEqual((errStdin.details as any)?.reason, "SYNTAX_ERROR");
      assert.strictEqual((errStdin.details as any)?.source, "stdin");
    });

    it("非法 UTF-8 映射为 INVALID_JSON + INVALID_UTF8", () => {
      const err = mapInputValidationFailure("full-json-file", {
        valid: false,
        code: "INVALID_UTF8",
        reason: "Invalid UTF-8 byte sequence",
      });
      assert.strictEqual(err.code, INVALID_JSON);
      assert.strictEqual((err.details as any)?.reason, "INVALID_UTF8");
      assert.strictEqual((err.details as any)?.source, "file");
    });

    it("非有限数值映射为 INVALID_JSON + NON_FINITE_NUMBER", () => {
      const err = mapInputValidationFailure("full-json-inline", {
        valid: false,
        code: "NON_FINITE_NUMBER",
        reason: "NaN detected",
        path: "/val",
      });
      assert.strictEqual(err.code, INVALID_JSON);
      assert.strictEqual((err.details as any)?.reason, "NON_FINITE_NUMBER");
      assert.strictEqual((err.details as any)?.path, "/val");
      assert.strictEqual((err.details as any)?.source, "inline-json");
    });

    it("最大深度超限映射为 INVALID_JSON + MAX_JSON_DEPTH", () => {
      const err = mapInputValidationFailure("full-json-inline", {
        valid: false,
        code: "MAX_JSON_DEPTH",
        reason: "Depth limit exceeded",
      });
      assert.strictEqual(err.code, INVALID_JSON);
      assert.strictEqual((err.details as any)?.reason, "MAX_JSON_DEPTH");
    });

    it("其他非法 JsonValue 映射为 INVALID_JSON + INVALID_JSON_VALUE", () => {
      const err = mapInputValidationFailure("full-json-inline", {
        valid: false,
        code: "CIRCULAR_REFERENCE",
        reason: "Circular reference detected",
      });
      assert.strictEqual(err.code, INVALID_JSON);
      assert.strictEqual((err.details as any)?.reason, "INVALID_JSON_VALUE");
    });
  });

  describe("flat-materialized 映射", () => {
    it("物化后深度超限映射为 FLAT_INPUT_LIMIT_EXCEEDED + MAX_MATERIALIZED_JSON_DEPTH", () => {
      const err = mapInputValidationFailure("flat-materialized", {
        valid: false,
        code: "MAX_JSON_DEPTH",
        reason: "Depth exceeded",
        path: "/nested",
      });
      assert.ok(err instanceof FlatInputError);
      assert.strictEqual(err.code, FLAT_INPUT_LIMIT_EXCEEDED);
      assert.strictEqual((err.details as any)?.reason, "MAX_MATERIALIZED_JSON_DEPTH");
      assert.strictEqual((err.details as any)?.path, "/nested");
    });

    it("物化后字节超限映射为 FLAT_INPUT_LIMIT_EXCEEDED + MAX_MATERIALIZED_BYTES", () => {
      const err = mapInputValidationFailure("flat-materialized", {
        valid: false,
        code: "MAX_MATERIALIZED_BYTES",
        reason: "Size exceeded",
      });
      assert.ok(err instanceof FlatInputError);
      assert.strictEqual(err.code, FLAT_INPUT_LIMIT_EXCEEDED);
      assert.strictEqual((err.details as any)?.reason, "MAX_MATERIALIZED_BYTES");
    });

    it("其他物化非法 JsonValue 映射为 FLAT_INPUT_LIMIT_EXCEEDED + INVALID_JSON_VALUE", () => {
      const err = mapInputValidationFailure("flat-materialized", {
        valid: false,
        code: "INVALID_JSON_OBJECT",
        reason: "Invalid object structure",
      });
      assert.ok(err instanceof FlatInputError);
      assert.strictEqual(err.code, FLAT_INPUT_LIMIT_EXCEEDED);
      assert.strictEqual((err.details as any)?.reason, "INVALID_JSON_VALUE");
    });
  });

  describe("cli-pre-target 映射", () => {
    it("禁止属性违规映射为 INPUT_POLICY_VIOLATION + FORBIDDEN_PROPERTY", () => {
      const err = mapInputValidationFailure("cli-pre-target", {
        valid: false,
        kind: "input-policy",
        code: "FORBIDDEN_PROPERTY",
        property: "constructor",
        path: "/user/constructor",
        reason: 'Forbidden property "constructor" is not allowed in Action input',
      });
      assert.ok(err instanceof InputError);
      assert.strictEqual(err.code, INPUT_POLICY_VIOLATION);
      assert.strictEqual((err.details as any)?.reason, "FORBIDDEN_PROPERTY");
      assert.strictEqual((err.details as any)?.property, "constructor");
      assert.strictEqual((err.details as any)?.path, "/user/constructor");
    });

    it("最大深度超限映射为 INPUT_LIMIT_EXCEEDED + MAX_JSON_DEPTH", () => {
      const err = mapInputValidationFailure("cli-pre-target", {
        valid: false,
        code: "MAX_JSON_DEPTH",
        reason: "Depth limit exceeded",
        path: "/deep",
      });
      assert.ok(err instanceof InputError);
      assert.strictEqual(err.code, INPUT_LIMIT_EXCEEDED);
      assert.strictEqual((err.details as any)?.reason, "MAX_JSON_DEPTH");
    });

    it("CLI 预处理输入中非有限数值映射为 INVALID_JSON + NON_FINITE_NUMBER", () => {
      const err = mapInputValidationFailure("cli-pre-target", {
        valid: false,
        code: "NON_FINITE_NUMBER",
        reason: "NaN detected",
        path: "/num",
      });
      assert.strictEqual(err.code, INVALID_JSON);
      assert.strictEqual((err.details as any)?.reason, "NON_FINITE_NUMBER");
    });
  });

  describe("runtime 映射", () => {
    it("非 JsonValue 映射为 INPUT_NOT_JSON 并保留既有契约", () => {
      const err = mapInputValidationFailure("runtime", {
        valid: false,
        kind: "json-value",
        code: "CIRCULAR_REFERENCE",
        reason: "Circular reference detected in object structure",
        path: "/self",
      });
      assert.ok(err instanceof InputError);
      assert.strictEqual(err.code, INPUT_NOT_JSON);
      assert.strictEqual((err.details as any)?.reason, "CIRCULAR_REFERENCE");
      assert.strictEqual((err.details as any)?.path, "/self");
    });

    it("禁止属性违规映射为 INPUT_VALIDATION_FAILED 且 details 保持 string[]", () => {
      const err = mapInputValidationFailure("runtime", {
        valid: false,
        kind: "input-policy",
        code: "FORBIDDEN_PROPERTY",
        property: "__proto__",
        path: "/__proto__",
        reason: 'Forbidden property "__proto__" is not allowed in Action input',
      });
      assert.ok(err instanceof InputError);
      assert.strictEqual(err.code, INPUT_VALIDATION_FAILED);
      assert.strictEqual(Array.isArray(err.details), true);
      assert.deepStrictEqual(err.details, [
        'Forbidden property "__proto__" is not allowed in Action input',
      ]);
    });
  });
});
