import { describe, expect, it } from "bun:test";
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
      expect(err).toBeInstanceOf(FlatInputError);
      expect(err.code).toBe(INVALID_JSON_LITERAL);
      expect((err.details as any)?.reason).toBe("SYNTAX_ERROR");
      expect((err.details as any)?.path).toBe("/foo");
    });

    it("非有限数值映射为 INVALID_JSON_LITERAL + NON_FINITE_NUMBER", () => {
      const err = mapInputValidationFailure("flat-json-literal", {
        valid: false,
        code: "NON_FINITE_NUMBER",
        reason: "Number is non-finite or NaN (Infinity)",
        path: "/num",
      });
      expect(err).toBeInstanceOf(FlatInputError);
      expect(err.code).toBe(INVALID_JSON_LITERAL);
      expect((err.details as any)?.reason).toBe("NON_FINITE_NUMBER");
      expect((err.details as any)?.path).toBe("/num");
    });

    it("最大深度超限映射为 INVALID_JSON_LITERAL + MAX_JSON_DEPTH", () => {
      const err = mapInputValidationFailure("flat-json-literal", {
        valid: false,
        code: "MAX_JSON_DEPTH",
        reason: "Max JSON depth limit exceeded",
        path: "/deep",
      });
      expect(err).toBeInstanceOf(FlatInputError);
      expect(err.code).toBe(INVALID_JSON_LITERAL);
      expect((err.details as any)?.reason).toBe("MAX_JSON_DEPTH");
      expect((err.details as any)?.path).toBe("/deep");
    });

    it("其他非法 JsonValue 映射为 INVALID_JSON_LITERAL + INVALID_JSON_VALUE", () => {
      const err = mapInputValidationFailure("flat-json-literal", {
        valid: false,
        code: "INVALID_JSON_OBJECT",
        reason: "Object prototype must be Object.prototype or null",
        path: "/date",
      });
      expect(err).toBeInstanceOf(FlatInputError);
      expect(err.code).toBe(INVALID_JSON_LITERAL);
      expect((err.details as any)?.reason).toBe("INVALID_JSON_VALUE");
      expect((err.details as any)?.path).toBe("/date");
    });
  });

  describe("Full JSON（inline / file / stdin）映射", () => {
    it("语法错误映射为 INVALID_JSON + SYNTAX_ERROR 且携带正确 source", () => {
      const errInline = mapInputValidationFailure("full-json-inline", {
        valid: false,
        code: "SYNTAX_ERROR",
        reason: "JSON syntax error",
      });
      expect(errInline).toBeInstanceOf(InputError);
      expect(errInline.code).toBe(INVALID_JSON);
      expect((errInline.details as any)?.reason).toBe("SYNTAX_ERROR");
      expect((errInline.details as any)?.source).toBe("inline-json");

      const errFile = mapInputValidationFailure("full-json-file", {
        valid: false,
        code: "SYNTAX_ERROR",
        reason: "JSON syntax error",
      });
      expect(errFile.code).toBe(INVALID_JSON);
      expect((errFile.details as any)?.reason).toBe("SYNTAX_ERROR");
      expect((errFile.details as any)?.source).toBe("file");

      const errStdin = mapInputValidationFailure("full-json-stdin", {
        valid: false,
        code: "SYNTAX_ERROR",
        reason: "JSON syntax error",
      });
      expect(errStdin.code).toBe(INVALID_JSON);
      expect((errStdin.details as any)?.reason).toBe("SYNTAX_ERROR");
      expect((errStdin.details as any)?.source).toBe("stdin");
    });

    it("非法 UTF-8 映射为 INVALID_JSON + INVALID_UTF8", () => {
      const err = mapInputValidationFailure("full-json-file", {
        valid: false,
        code: "INVALID_UTF8",
        reason: "Invalid UTF-8 byte sequence",
      });
      expect(err.code).toBe(INVALID_JSON);
      expect((err.details as any)?.reason).toBe("INVALID_UTF8");
      expect((err.details as any)?.source).toBe("file");
    });

    it("非有限数值映射为 INVALID_JSON + NON_FINITE_NUMBER", () => {
      const err = mapInputValidationFailure("full-json-inline", {
        valid: false,
        code: "NON_FINITE_NUMBER",
        reason: "NaN detected",
        path: "/val",
      });
      expect(err.code).toBe(INVALID_JSON);
      expect((err.details as any)?.reason).toBe("NON_FINITE_NUMBER");
      expect((err.details as any)?.path).toBe("/val");
      expect((err.details as any)?.source).toBe("inline-json");
    });

    it("最大深度超限映射为 INVALID_JSON + MAX_JSON_DEPTH", () => {
      const err = mapInputValidationFailure("full-json-inline", {
        valid: false,
        code: "MAX_JSON_DEPTH",
        reason: "Depth limit exceeded",
      });
      expect(err.code).toBe(INVALID_JSON);
      expect((err.details as any)?.reason).toBe("MAX_JSON_DEPTH");
    });

    it("其他非法 JsonValue 映射为 INVALID_JSON + INVALID_JSON_VALUE", () => {
      const err = mapInputValidationFailure("full-json-inline", {
        valid: false,
        code: "CIRCULAR_REFERENCE",
        reason: "Circular reference detected",
      });
      expect(err.code).toBe(INVALID_JSON);
      expect((err.details as any)?.reason).toBe("INVALID_JSON_VALUE");
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
      expect(err).toBeInstanceOf(FlatInputError);
      expect(err.code).toBe(FLAT_INPUT_LIMIT_EXCEEDED);
      expect((err.details as any)?.reason).toBe("MAX_MATERIALIZED_JSON_DEPTH");
      expect((err.details as any)?.path).toBe("/nested");
    });

    it("物化后字节超限映射为 FLAT_INPUT_LIMIT_EXCEEDED + MAX_MATERIALIZED_BYTES", () => {
      const err = mapInputValidationFailure("flat-materialized", {
        valid: false,
        code: "MAX_MATERIALIZED_BYTES",
        reason: "Size exceeded",
      });
      expect(err).toBeInstanceOf(FlatInputError);
      expect(err.code).toBe(FLAT_INPUT_LIMIT_EXCEEDED);
      expect((err.details as any)?.reason).toBe("MAX_MATERIALIZED_BYTES");
    });

    it("其他物化非法 JsonValue 映射为 FLAT_INPUT_LIMIT_EXCEEDED + INVALID_JSON_VALUE", () => {
      const err = mapInputValidationFailure("flat-materialized", {
        valid: false,
        code: "INVALID_JSON_OBJECT",
        reason: "Invalid object structure",
      });
      expect(err).toBeInstanceOf(FlatInputError);
      expect(err.code).toBe(FLAT_INPUT_LIMIT_EXCEEDED);
      expect((err.details as any)?.reason).toBe("INVALID_JSON_VALUE");
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
      expect(err).toBeInstanceOf(InputError);
      expect(err.code).toBe(INPUT_POLICY_VIOLATION);
      expect((err.details as any)?.reason).toBe("FORBIDDEN_PROPERTY");
      expect((err.details as any)?.property).toBe("constructor");
      expect((err.details as any)?.path).toBe("/user/constructor");
    });

    it("最大深度超限映射为 INPUT_LIMIT_EXCEEDED + MAX_JSON_DEPTH", () => {
      const err = mapInputValidationFailure("cli-pre-target", {
        valid: false,
        code: "MAX_JSON_DEPTH",
        reason: "Depth limit exceeded",
        path: "/deep",
      });
      expect(err).toBeInstanceOf(InputError);
      expect(err.code).toBe(INPUT_LIMIT_EXCEEDED);
      expect((err.details as any)?.reason).toBe("MAX_JSON_DEPTH");
    });

    it("CLI 预处理输入中非有限数值映射为 INVALID_JSON + NON_FINITE_NUMBER", () => {
      const err = mapInputValidationFailure("cli-pre-target", {
        valid: false,
        code: "NON_FINITE_NUMBER",
        reason: "NaN detected",
        path: "/num",
      });
      expect(err.code).toBe(INVALID_JSON);
      expect((err.details as any)?.reason).toBe("NON_FINITE_NUMBER");
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
      expect(err).toBeInstanceOf(InputError);
      expect(err.code).toBe(INPUT_NOT_JSON);
      expect((err.details as any)?.reason).toBe("CIRCULAR_REFERENCE");
      expect((err.details as any)?.path).toBe("/self");
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
      expect(err).toBeInstanceOf(InputError);
      expect(err.code).toBe(INPUT_VALIDATION_FAILED);
      expect(Array.isArray(err.details)).toBe(true);
      expect(err.details).toEqual([
        'Forbidden property "__proto__" is not allowed in Action input',
      ]);
    });
  });
});
