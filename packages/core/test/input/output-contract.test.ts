import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  inspectActionTextFieldAnnotation,
  analyzeActionOutputContract,
} from "../../src/input";

describe("ActionDock 输出契约纯静态分析 (output-contract)", () => {
  describe("inspectActionTextFieldAnnotation 注解解析", () => {
    it("未声明 annotations 或无 actiondock.cli 时返回 declared: false", () => {
      assert.deepStrictEqual(inspectActionTextFieldAnnotation(undefined), {
        declared: false,
        valid: true,
      });
      assert.deepStrictEqual(inspectActionTextFieldAnnotation(null), {
        declared: false,
        valid: true,
      });
      assert.deepStrictEqual(inspectActionTextFieldAnnotation("string"), {
        declared: false,
        valid: true,
      });
      assert.deepStrictEqual(inspectActionTextFieldAnnotation({}), {
        declared: false,
        valid: true,
      });
      assert.deepStrictEqual(inspectActionTextFieldAnnotation({ other: "val" }), {
        declared: false,
        valid: true,
      });
      assert.deepStrictEqual(inspectActionTextFieldAnnotation({ "actiondock.cli": undefined }), {
        declared: false,
        valid: true,
      });
      assert.deepStrictEqual(inspectActionTextFieldAnnotation({ "actiondock.cli": {} }), {
        declared: false,
        valid: true,
      });
    });

    it("actiondock.cli 结构非法时返回 valid: false 与规范错误信息", () => {
      const resNull = inspectActionTextFieldAnnotation({ "actiondock.cli": null });
      assert.strictEqual(resNull.declared, true);
      assert.strictEqual(resNull.valid, false);
      assert.ok(resNull.error?.includes("expected an object, but received null"));

      const resArray = inspectActionTextFieldAnnotation({ "actiondock.cli": [1, 2] });
      assert.strictEqual(resArray.declared, true);
      assert.strictEqual(resArray.valid, false);
      assert.ok(resArray.error?.includes("expected an object, but received an array"));

      const resStr = inspectActionTextFieldAnnotation({ "actiondock.cli": "foo" });
      assert.strictEqual(resStr.declared, true);
      assert.strictEqual(resStr.valid, false);
      assert.ok(resStr.error?.includes("expected an object, but received string"));
    });

    it("textField 非字符串或空字符串时返回 valid: false", () => {
      const resNum = inspectActionTextFieldAnnotation({
        "actiondock.cli": { textField: 123 },
      });
      assert.strictEqual(resNum.valid, false);
      assert.ok(resNum.error?.includes("expected a string, but received number"));

      const resEmpty = inspectActionTextFieldAnnotation({
        "actiondock.cli": { textField: "" },
      });
      assert.strictEqual(resEmpty.valid, false);
      assert.ok(resEmpty.error?.includes("cannot be an empty string"));

      const resWhitespace = inspectActionTextFieldAnnotation({
        "actiondock.cli": { textField: "   " },
      });
      assert.strictEqual(resWhitespace.valid, false);
      assert.ok(resWhitespace.error?.includes("cannot be an empty string"));
    });

    it("正确解析非空合法 textField", () => {
      const res = inspectActionTextFieldAnnotation({
        "actiondock.cli": { textField: "summary" },
      });
      assert.deepStrictEqual(res, {
        declared: true,
        valid: true,
        textField: "summary",
      });
    });
  });

  describe("analyzeActionOutputContract 输出契约与 Schema 兼容性推导", () => {
    it("未声明默认正文时返回 declared: false，无错误且无警告", () => {
      const analysis = analyzeActionOutputContract({
        annotations: {},
        outputSchema: { type: "object" },
      });
      assert.strictEqual(analysis.declared, false);
      assert.strictEqual(analysis.valid, true);
      assert.strictEqual(analysis.errors.length, 0);
      assert.strictEqual(analysis.warnings.length, 0);
    });

    it("注解结构非法时报告确定错误并阻断", () => {
      const analysis = analyzeActionOutputContract({
        annotations: { "actiondock.cli": "invalid" },
      });
      assert.strictEqual(analysis.declared, true);
      assert.strictEqual(analysis.valid, false);
      assert.strictEqual(analysis.errors.length, 1);
      assert.ok(analysis.errors[0].includes("expected an object"));
    });

    it("outputSchema 缺失或为布尔 true 时输出警告诊断，不视为阻断错误", () => {
      const absent = analyzeActionOutputContract({
        annotations: { "actiondock.cli": { textField: "content" } },
      });
      assert.strictEqual(absent.valid, true);
      assert.strictEqual(absent.errors.length, 0);
      assert.ok(absent.warnings.some((w) => w.includes("Output schema is absent")));

      const arbitrary = analyzeActionOutputContract({
        annotations: { "actiondock.cli": { textField: "content" } },
        outputSchema: true,
      });
      assert.strictEqual(arbitrary.valid, true);
      assert.strictEqual(arbitrary.errors.length, 0);
      assert.ok(arbitrary.warnings.some((w) => w.includes("allows arbitrary values")));
    });

    it("outputSchema 为布尔 false 时报告确定错误", () => {
      const analysis = analyzeActionOutputContract({
        annotations: { "actiondock.cli": { textField: "content" } },
        outputSchema: false,
      });
      assert.strictEqual(analysis.valid, false);
      assert.ok(analysis.errors.some((e) => e.includes("explicitly rejects all outputs")));
    });

    it("outputSchema 明确根节点非 object 时报告确定错误", () => {
      const analysis1 = analyzeActionOutputContract({
        annotations: { "actiondock.cli": { textField: "content" } },
        outputSchema: { type: "string" },
      });
      assert.strictEqual(analysis1.valid, false);
      assert.ok(analysis1.errors.some((e) => e.includes("which does not allow an object")));

      const analysis2 = analyzeActionOutputContract({
        annotations: { "actiondock.cli": { textField: "content" } },
        outputSchema: { type: ["number", "boolean"] },
      });
      assert.strictEqual(analysis2.valid, false);
      assert.ok(analysis2.errors.some((e) => e.includes("which does not allow an object")));
    });

    it("目标字段在 Schema 中明确非 string 时报告确定错误", () => {
      const analysis = analyzeActionOutputContract({
        annotations: { "actiondock.cli": { textField: "count" } },
        outputSchema: {
          type: "object",
          properties: {
            count: { type: "number" },
          },
          required: ["count"],
        },
      });
      assert.strictEqual(analysis.valid, false);
      assert.ok(analysis.errors.some((e) => e.includes("does not allow string")));
    });

    it("目标字段在 Schema 中被明确禁止（false）时报告确定错误", () => {
      const analysis = analyzeActionOutputContract({
        annotations: { "actiondock.cli": { textField: "content" } },
        outputSchema: {
          type: "object",
          properties: {
            content: false,
          },
        },
      });
      assert.strictEqual(analysis.valid, false);
      assert.ok(analysis.errors.some((e) => e.includes("explicitly forbidden")));
    });

    it("目标字段未声明且 additionalProperties: false 时报告确定错误", () => {
      const analysis = analyzeActionOutputContract({
        annotations: { "actiondock.cli": { textField: "summary" } },
        outputSchema: {
          type: "object",
          properties: {
            status: { type: "string" },
          },
          additionalProperties: false,
          required: ["status"],
        },
      });
      assert.strictEqual(analysis.valid, false);
      assert.ok(analysis.errors.some((e) => e.includes("additionalProperties is false")));
    });

    it("目标字段未在 properties 声明但允许额外属性时给出风险诊断而非错误", () => {
      const analysis = analyzeActionOutputContract({
        annotations: { "actiondock.cli": { textField: "summary" } },
        outputSchema: {
          type: "object",
          properties: {
            status: { type: "string" },
          },
          additionalProperties: true,
        },
      });
      assert.strictEqual(analysis.valid, true);
      assert.strictEqual(analysis.errors.length, 0);
      assert.ok(analysis.warnings.some((w) => w.includes("allowed via additionalProperties")));
    });

    it("目标字段未声明为 required 时给出风险警告，不阻断合法执行", () => {
      const analysis = analyzeActionOutputContract({
        annotations: { "actiondock.cli": { textField: "summary" } },
        outputSchema: {
          type: "object",
          properties: {
            summary: { type: "string" },
          },
          required: [],
        },
      });
      assert.strictEqual(analysis.valid, true);
      assert.strictEqual(analysis.errors.length, 0);
      assert.ok(analysis.warnings.some((w) => w.includes("not marked as required")));
    });

    it("目标字段允许 null 或非字符串时给出风险警告", () => {
      const analysis = analyzeActionOutputContract({
        annotations: { "actiondock.cli": { textField: "summary" } },
        outputSchema: {
          type: "object",
          properties: {
            summary: { type: ["string", "null"] },
          },
          required: ["summary"],
        },
      });
      assert.strictEqual(analysis.valid, true);
      assert.strictEqual(analysis.errors.length, 0);
      assert.ok(analysis.warnings.some((w) => w.includes("allows non-string types (null)")));
    });

    it("包含复杂组合 Schema（oneOf/anyOf/allOf/$ref）时透明提示无法完全静态判定", () => {
      const analysis = analyzeActionOutputContract({
        annotations: { "actiondock.cli": { textField: "summary" } },
        outputSchema: {
          type: "object",
          properties: {
            summary: { type: "string" },
          },
          required: ["summary"],
          oneOf: [{ required: ["summary"] }],
        },
      });
      assert.strictEqual(analysis.valid, true);
      assert.strictEqual(analysis.errors.length, 0);
      assert.ok(analysis.warnings.some((w) => w.includes("complex composition keywords")));
    });

    it("合法 patternProperties 存在时降级为风险警告，不误报额外属性禁止错误", () => {
      // 场景 1：未声明 properties，存在 patternProperties 且 additionalProperties: false
      const analysis1 = analyzeActionOutputContract({
        annotations: { "actiondock.cli": { textField: "summary" } },
        outputSchema: {
          type: "object",
          patternProperties: {
            "^summary$": { type: "string" },
          },
          additionalProperties: false,
          required: ["summary"],
        },
      });
      assert.strictEqual(analysis1.valid, true);
      assert.strictEqual(analysis1.errors.length, 0);
      assert.ok(analysis1.warnings.some((w) => w.includes("governed by patternProperties")));

      // 场景 2：properties 存在但无目标字段，存在 patternProperties 且 additionalProperties: false
      const analysis2 = analyzeActionOutputContract({
        annotations: { "actiondock.cli": { textField: "summary" } },
        outputSchema: {
          type: "object",
          properties: {
            other: { type: "string" },
          },
          patternProperties: {
            "^s.*$": { type: "string" },
          },
          additionalProperties: false,
          required: ["summary"],
        },
      });
      assert.strictEqual(analysis2.valid, true);
      assert.strictEqual(analysis2.errors.length, 0);
      assert.ok(analysis2.warnings.some((w) => w.includes("governed by patternProperties")));
    });

    it("根 Schema 未指定 type 时给出 ROOT_TYPE_UNSPECIFIED 风险诊断", () => {
      const analysis = analyzeActionOutputContract({
        annotations: { "actiondock.cli": { textField: "summary" } },
        outputSchema: {
          properties: {
            summary: { type: "string" },
          },
          required: ["summary"],
        },
      });
      assert.strictEqual(analysis.valid, true);
      assert.strictEqual(analysis.errors.length, 0);
      assert.ok(
        analysis.warnings.some((w) =>
          w.includes("does not explicitly specify root type as 'object'")
        )
      );
    });

    it("根 Schema 允许非对象联合类型（如 [object, null]）时给出 ROOT_TYPE_ALLOWS_NON_OBJECT 警告", () => {
      const analysis = analyzeActionOutputContract({
        annotations: { "actiondock.cli": { textField: "summary" } },
        outputSchema: {
          type: ["object", "null"],
          properties: {
            summary: { type: "string" },
          },
          required: ["summary"],
        },
      });
      assert.strictEqual(analysis.valid, true);
      assert.strictEqual(analysis.errors.length, 0);
      assert.ok(analysis.warnings.some((w) => w.includes("allows non-object types (null)")));
    });

    it("目标字段为未指定类型的对象时给出 TEXT_FIELD_UNTYPED 风险提示", () => {
      const analysis = analyzeActionOutputContract({
        annotations: { "actiondock.cli": { textField: "summary" } },
        outputSchema: {
          type: "object",
          properties: {
            summary: { description: "summary without type" },
          },
          required: ["summary"],
        },
      });
      assert.strictEqual(analysis.valid, true);
      assert.strictEqual(analysis.errors.length, 0);
      assert.ok(analysis.warnings.some((w) => w.includes("does not specify a type")));
    });

    it("目标字段内部包含复杂组合（anyOf/oneOf/allOf/$ref）时给出风险诊断", () => {
      const analysis = analyzeActionOutputContract({
        annotations: { "actiondock.cli": { textField: "summary" } },
        outputSchema: {
          type: "object",
          properties: {
            summary: {
              anyOf: [{ type: "string" }, { type: "null" }],
            },
          },
          required: ["summary"],
        },
      });
      assert.strictEqual(analysis.valid, true);
      assert.strictEqual(analysis.errors.length, 0);
      assert.ok(analysis.warnings.some((w) => w.includes("complex composition keywords")));
    });

    it("TEXT_FIELD_NOT_REQUIRED 警告明确说明执行记录真实成功与正文提取失败的关系", () => {
      const analysis = analyzeActionOutputContract({
        annotations: { "actiondock.cli": { textField: "summary" } },
        outputSchema: {
          type: "object",
          properties: {
            summary: { type: "string" },
          },
        },
      });
      assert.strictEqual(analysis.valid, true);
      assert.ok(
        analysis.warnings.some((w) =>
          w.includes("business execution remains successful in run records")
        )
      );
    });

    it("规范声明（required + string 且 properties 声明）完全通过无错误无警告", () => {
      const analysis = analyzeActionOutputContract({
        annotations: { "actiondock.cli": { textField: "content" } },
        outputSchema: {
          type: "object",
          properties: {
            content: { type: "string", description: "正文内容" },
            path: { type: "string" },
          },
          required: ["content", "path"],
          additionalProperties: false,
        },
      });
      assert.strictEqual(analysis.valid, true);
      assert.strictEqual(analysis.errors.length, 0);
      assert.strictEqual(analysis.warnings.length, 0);
      assert.strictEqual(analysis.textField, "content");
    });
  });
});
