import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildCliInputAdviceV1,
  buildInputTransportV1,
  buildCliInputEncodingV1,
  buildInputPolicyV1,
  formatInputErrorForCli,
  toCliInputErrorEnvelope,
  InputError,
} from "../../src/input";
import { INVALID_ARGUMENT } from "../../src/errors";

describe("Phase 9: Input Advice v1 与元数据构建器", () => {
  describe("Schema Sanity 阶段（Section 44）", () => {
    it("合法根形状通过：undefined, boolean, plain object", () => {
      const advUndefined = buildCliInputAdviceV1(undefined);
      assert.strictEqual(advUndefined.analysisStatus, "ok");
      assert.strictEqual(advUndefined.schemaState, "absent");

      const advFalse = buildCliInputAdviceV1(false);
      assert.strictEqual(advFalse.analysisStatus, "ok");
      assert.strictEqual(advFalse.schemaState, "reject-all");

      const advTrue = buildCliInputAdviceV1(true);
      assert.strictEqual(advTrue.analysisStatus, "ok");
      assert.strictEqual(advTrue.schemaState, "any");

      const advObj = buildCliInputAdviceV1({ type: "object", properties: { name: { type: "string" } } });
      assert.strictEqual(advObj.analysisStatus, "ok");
      assert.strictEqual(advObj.schemaState, "object");
    });

    it("非法根形状判为 malformed / MALFORMED_SCHEMA", () => {
      for (const invalidRoot of [null, "string", 123, [1, 2], () => {}]) {
        const adv = buildCliInputAdviceV1(invalidRoot);
        assert.strictEqual(adv.analysisStatus, "malformed");
        assert.strictEqual(adv.analysisCode, "MALFORMED_SCHEMA");
        assert.strictEqual(adv.schemaState, "complex");
        assert.strictEqual(adv.schemaRecommendedMode, "full-json");
        assert.deepStrictEqual(adv.fields, []);
      }
    });

    it("非法 type 关键字判为 malformed", () => {
      // 1. 非 string 也非 array
      const adv1 = buildCliInputAdviceV1({ type: 123 });
      assert.strictEqual(adv1.analysisStatus, "malformed");
      assert.strictEqual(adv1.analysisCode, "MALFORMED_SCHEMA");

      // 2. 未识别的类型字符串
      const adv2 = buildCliInputAdviceV1({ type: "custom-type" });
      assert.strictEqual(adv2.analysisStatus, "malformed");
      assert.strictEqual(adv2.analysisCode, "MALFORMED_SCHEMA");

      // 3. 空数组
      const adv3 = buildCliInputAdviceV1({ type: [] });
      assert.strictEqual(adv3.analysisStatus, "malformed");
      assert.strictEqual(adv3.analysisCode, "MALFORMED_SCHEMA");

      // 4. 重复类型
      const adv4 = buildCliInputAdviceV1({ type: ["string", "string"] });
      assert.strictEqual(adv4.analysisStatus, "malformed");
      assert.strictEqual(adv4.analysisCode, "MALFORMED_SCHEMA");
    });

    it("非法 properties 与 property schema 判为 malformed", () => {
      // 1. properties 非 plain object
      const adv1 = buildCliInputAdviceV1({ properties: "invalid" });
      assert.strictEqual(adv1.analysisStatus, "malformed");
      assert.strictEqual(adv1.analysisCode, "MALFORMED_SCHEMA");

      // 2. 字段 schema 既不是 boolean 也不是 plain object
      const adv2 = buildCliInputAdviceV1({
        type: "object",
        properties: { name: "invalid" },
      });
      assert.strictEqual(adv2.analysisStatus, "malformed");
      assert.strictEqual(adv2.analysisCode, "MALFORMED_SCHEMA");

      // 3. 字段 schema 内部包含未识别类型
      const adv3 = buildCliInputAdviceV1({
        type: "object",
        properties: { name: { type: "unknown" } },
      });
      assert.strictEqual(adv3.analysisStatus, "malformed");
      assert.strictEqual(adv3.analysisCode, "MALFORMED_SCHEMA");
    });

    it("非法 required 关键字判为 malformed", () => {
      // 1. 非 array
      const adv1 = buildCliInputAdviceV1({ type: "object", required: "name" });
      assert.strictEqual(adv1.analysisStatus, "malformed");
      assert.strictEqual(adv1.analysisCode, "MALFORMED_SCHEMA");

      // 2. 数组包含非 string
      const adv2 = buildCliInputAdviceV1({ type: "object", required: [123] });
      assert.strictEqual(adv2.analysisStatus, "malformed");
      assert.strictEqual(adv2.analysisCode, "MALFORMED_SCHEMA");

      // 3. 重复字段
      const adv3 = buildCliInputAdviceV1({ type: "object", required: ["a", "a"] });
      assert.strictEqual(adv3.analysisStatus, "malformed");
      assert.strictEqual(adv3.analysisCode, "MALFORMED_SCHEMA");
    });

    it("非法 additionalProperties 与 items 判定", () => {
      // 1. additionalProperties 既非 boolean 也非 plain object
      const adv1 = buildCliInputAdviceV1({
        type: "object",
        additionalProperties: "invalid",
      });
      assert.strictEqual(adv1.analysisStatus, "malformed");
      assert.strictEqual(adv1.analysisCode, "MALFORMED_SCHEMA");

      // 2. items 为元组数组时判为 unsupported / UNSUPPORTED_SCHEMA_SHAPE
      const adv2 = buildCliInputAdviceV1({
        type: "array",
        items: [{ type: "string" }, { type: "number" }],
      });
      assert.strictEqual(adv2.analysisStatus, "unsupported");
      assert.strictEqual(adv2.analysisCode, "UNSUPPORTED_SCHEMA_SHAPE");
      assert.strictEqual(adv2.schemaState, "complex");

      // 3. items 既非 boolean 也非 object/array
      const adv3 = buildCliInputAdviceV1({
        type: "array",
        items: 123,
      });
      assert.strictEqual(adv3.analysisStatus, "malformed");
      assert.strictEqual(adv3.analysisCode, "MALFORMED_SCHEMA");
    });

    it("非法 enum 与 const 判定", () => {
      // 1. enum 非 array 或为空
      const adv1 = buildCliInputAdviceV1({ enum: "not-array" });
      assert.strictEqual(adv1.analysisStatus, "malformed");
      const adv2 = buildCliInputAdviceV1({ enum: [] });
      assert.strictEqual(adv2.analysisStatus, "malformed");

      // 2. const 为非法 JSON 字面量类型（如函数、undefined、NaN 等）
      const adv3 = buildCliInputAdviceV1({ const: () => {} });
      assert.strictEqual(adv3.analysisStatus, "malformed");
      const adv4 = buildCliInputAdviceV1({ const: NaN });
      assert.strictEqual(adv4.analysisStatus, "malformed");
    });

    it("非法 applicators 判定", () => {
      assert.strictEqual(buildCliInputAdviceV1({ oneOf: "not-array" }).analysisStatus, "malformed");
      assert.strictEqual(buildCliInputAdviceV1({ anyOf: "not-array" }).analysisStatus, "malformed");
      assert.strictEqual(buildCliInputAdviceV1({ allOf: "not-array" }).analysisStatus, "malformed");
      assert.strictEqual(buildCliInputAdviceV1({ $ref: 123 }).analysisStatus, "malformed");
      assert.strictEqual(buildCliInputAdviceV1({ not: 123 }).analysisStatus, "malformed");
    });
  });

  describe("语义分类阶段（Section 45）", () => {
    it("absent 语义", () => {
      const adv = buildCliInputAdviceV1(undefined);
      assert.strictEqual(adv.schemaState, "absent");
      assert.strictEqual(adv.analysisStatus, "ok");
      assert.strictEqual(adv.schemaRecommendedMode, "full-json");
      assert.strictEqual(adv.requiredSatisfiable, null);
    });

    it("reject-all 语义", () => {
      const adv = buildCliInputAdviceV1(false);
      assert.strictEqual(adv.schemaState, "reject-all");
      assert.strictEqual(adv.inputFeasibility, "known-impossible");
      assert.strictEqual(adv.feasibilityCode, "SCHEMA_REJECTS_ALL");
      assert.strictEqual(adv.schemaRecommendedMode, "none");
      assert.strictEqual(adv.requiredSatisfiable, false);
    });

    it("any 语义", () => {
      const advTrue = buildCliInputAdviceV1(true);
      assert.strictEqual(advTrue.schemaState, "any");
      assert.strictEqual(advTrue.schemaRecommendedMode, "full-json");

      const advEmpty = buildCliInputAdviceV1({});
      assert.strictEqual(advEmpty.schemaState, "any");
      assert.strictEqual(advEmpty.schemaRecommendedMode, "full-json");
    });

    it("object 语义", () => {
      const adv = buildCliInputAdviceV1({
        type: "object",
        properties: {
          name: { type: "string" },
        },
      });
      assert.strictEqual(adv.schemaState, "object");
      assert.strictEqual(adv.flatCandidate, true);
      assert.strictEqual(adv.schemaRecommendedMode, "flat");
    });

    it("json-only 语义（显式单一非对象类型）", () => {
      for (const type of ["string", "number", "integer", "boolean", "array"]) {
        const adv = buildCliInputAdviceV1({ type });
        assert.strictEqual(adv.schemaState, "json-only");
        assert.strictEqual(adv.schemaRecommendedMode, "full-json");
        assert.strictEqual(adv.requiredSatisfiable, false);
      }
    });

    it("complex 语义（applicators / union type / 无显式 type 带 properties）", () => {
      // 1. oneOf / anyOf / allOf / $ref
      assert.strictEqual(buildCliInputAdviceV1({ oneOf: [{ type: "string" }] }).schemaState, "complex");
      assert.strictEqual(buildCliInputAdviceV1({ anyOf: [{ type: "string" }] }).schemaState, "complex");
      assert.strictEqual(buildCliInputAdviceV1({ allOf: [{ type: "string" }] }).schemaState, "complex");
      assert.strictEqual(buildCliInputAdviceV1({ $ref: "#/definitions/Foo" }).schemaState, "complex");

      // 2. 联合类型 union type
      assert.strictEqual(buildCliInputAdviceV1({ type: ["string", "number"] }).schemaState, "complex");

      // 3. 无显式 type 但具备 properties / required / additionalProperties
      assert.strictEqual(buildCliInputAdviceV1({
          properties: { name: { type: "string" } },
        }).schemaState, "complex");
    });
  });

  describe("enum / const 规则（Section 46）", () => {
    it("显式单一 type 决定 operator，enum/const 不改变操作符", () => {
      // string + enum -> = / string
      const adv1 = buildCliInputAdviceV1({
        type: "object",
        properties: {
          status: { type: "string", enum: ["active", "inactive"] },
        },
      });
      const f1 = adv1.fields.find((f) => f.path === "status");
      assert.strictEqual(f1?.operator, "=");
      assert.strictEqual(f1?.encoding, "string");
      assert.strictEqual(f1?.assignmentTemplate, "status=TEXT");

      // integer + const -> := / json-number
      const adv2 = buildCliInputAdviceV1({
        type: "object",
        properties: {
          version: { type: "integer", const: 1 },
        },
      });
      const f2 = adv2.fields.find((f) => f.path === "version");
      assert.strictEqual(f2?.operator, ":=");
      assert.strictEqual(f2?.encoding, "json-number");
      assert.strictEqual(f2?.assignmentTemplate, "version:=NUMBER");

      // boolean + const -> := / json-boolean
      const adv3 = buildCliInputAdviceV1({
        type: "object",
        properties: {
          enabled: { type: "boolean", const: true },
        },
      });
      const f3 = adv3.fields.find((f) => f.path === "enabled");
      assert.strictEqual(f3?.operator, ":=");
      assert.strictEqual(f3?.encoding, "json-boolean");
      assert.strictEqual(f3?.assignmentTemplate, "enabled:=BOOLEAN");
    });

    it("无显式 type 时不推断类型，推荐 full-json 且 flatSafe 为 false", () => {
      const adv = buildCliInputAdviceV1({
        type: "object",
        properties: {
          status: { enum: ["a", "b"] },
          code: { const: 1 },
        },
      });

      const fStatus = adv.fields.find((f) => f.path === "status");
      assert.strictEqual(fStatus?.flatSafe, false);
      assert.strictEqual(fStatus?.operator, undefined);
      assert.strictEqual(fStatus?.fallback, "stdin-json");
      assert.strictEqual(fStatus?.reason, "UNSAFE_FLAT_PROPERTY");

      const fCode = adv.fields.find((f) => f.path === "code");
      assert.strictEqual(fCode?.flatSafe, false);
      assert.strictEqual(fCode?.operator, undefined);
      assert.strictEqual(fCode?.fallback, "stdin-json");
      assert.strictEqual(fCode?.reason, "UNSAFE_FLAT_PROPERTY");
    });
  });

  describe("输入可行性判定（Section 47）与 feasibilityCode", () => {
    it("schema 为 false 判定为 SCHEMA_REJECTS_ALL", () => {
      const adv = buildCliInputAdviceV1(false);
      assert.strictEqual(adv.inputFeasibility, "known-impossible");
      assert.strictEqual(adv.feasibilityCode, "SCHEMA_REJECTS_ALL");
      assert.strictEqual(adv.schemaRecommendedMode, "none");
    });

    it("必填属性包含全局禁止字段判定为 REQUIRED_FIELD_FORBIDDEN", () => {
      for (const forbidden of ["__proto__", "constructor", "prototype"]) {
        const adv = buildCliInputAdviceV1({
          type: "object",
          properties: {
            [forbidden]: { type: "string" },
          },
          required: [forbidden],
        });
        assert.strictEqual(adv.inputFeasibility, "known-impossible");
        assert.strictEqual(adv.feasibilityCode, "REQUIRED_FIELD_FORBIDDEN");
        assert.strictEqual(adv.schemaRecommendedMode, "none");
      }
    });

    it("必填属性 schema 为 false 判定为 REQUIRED_FIELD_REJECTS_ALL", () => {
      const adv = buildCliInputAdviceV1({
        type: "object",
        properties: {
          blocked: false,
          allowed: { type: "string" },
        },
        required: ["blocked"],
      });
      assert.strictEqual(adv.inputFeasibility, "known-impossible");
      assert.strictEqual(adv.feasibilityCode, "REQUIRED_FIELD_REJECTS_ALL");
      assert.strictEqual(adv.schemaRecommendedMode, "none");
    });

    it("必填属性未声明且 additionalProperties: false 判定为 REQUIRED_FIELD_DISALLOWED_BY_ADDITIONAL_PROPERTIES", () => {
      const adv = buildCliInputAdviceV1({
        type: "object",
        properties: {
          name: { type: "string" },
        },
        required: ["name", "undeclared_key"],
        additionalProperties: false,
      });
      assert.strictEqual(adv.inputFeasibility, "known-impossible");
      assert.strictEqual(adv.feasibilityCode, 
        "REQUIRED_FIELD_DISALLOWED_BY_ADDITIONAL_PROPERTIES"
      );
      assert.strictEqual(adv.schemaRecommendedMode, "none");
    });

    it("正常属性或未声明但允许附加属性判定为 possible-or-unknown", () => {
      const adv = buildCliInputAdviceV1({
        type: "object",
        properties: {
          name: { type: "string" },
        },
        required: ["name", "undeclared_key"],
        additionalProperties: true,
      });
      assert.strictEqual(adv.inputFeasibility, "possible-or-unknown");
      assert.strictEqual(adv.feasibilityCode, undefined);
    });
  });

  describe("requiredSatisfiable 与 schemaRecommendedMode 计算（Section 48 & 49）", () => {
    it("object 无必填项时 requiredSatisfiable 为 true，有 flat 字段时推荐 flat", () => {
      const adv = buildCliInputAdviceV1({
        type: "object",
        properties: {
          name: { type: "string" },
        },
      });
      assert.strictEqual(adv.requiredSatisfiable, true);
      assert.strictEqual(adv.flatCandidate, true);
      assert.strictEqual(adv.schemaRecommendedMode, "flat");
    });

    it("object 必填项皆可安全扁平赋值时 requiredSatisfiable 为 true，推荐 flat", () => {
      const adv = buildCliInputAdviceV1({
        type: "object",
        properties: {
          name: { type: "string" },
          age: { type: "number" },
        },
        required: ["name", "age"],
      });
      assert.strictEqual(adv.requiredSatisfiable, true);
      assert.strictEqual(adv.flatCandidate, true);
      assert.strictEqual(adv.schemaRecommendedMode, "flat");
    });

    it("object 必填项包含非 flatSafe 字段时 requiredSatisfiable 为 false，推荐 full-json", () => {
      const adv = buildCliInputAdviceV1({
        type: "object",
        properties: {
          "user name": { type: "string" },
        },
        required: ["user name"],
      });
      assert.strictEqual(adv.requiredSatisfiable, false);
      assert.strictEqual(adv.flatCandidate, false);
      assert.strictEqual(adv.schemaRecommendedMode, "full-json");
    });

    it("object 必填项未声明且 additionalProperties 允许时 requiredSatisfiable 为 null", () => {
      const adv = buildCliInputAdviceV1({
        type: "object",
        properties: {
          name: { type: "string" },
        },
        required: ["name", "extra"],
        additionalProperties: true,
      });
      assert.strictEqual(adv.requiredSatisfiable, null);
      assert.strictEqual(adv.flatCandidate, false);
      assert.strictEqual(adv.schemaRecommendedMode, "full-json");
    });
  });

  describe("字段建议生成（Section 50）", () => {
    it("全局禁止字段 inputAllowed: false, reason: FORBIDDEN_PROPERTY, fallback: null", () => {
      const adv = buildCliInputAdviceV1({
        type: "object",
        properties: {
          constructor: { type: "string" },
        },
      });
      const f = adv.fields.find((field) => field.path === "constructor");
      assert.notStrictEqual(f, undefined);
      assert.strictEqual(f?.inputAllowed, false);
      assert.strictEqual(f?.flatSafe, false);
      assert.strictEqual(f?.reason, "FORBIDDEN_PROPERTY");
      assert.strictEqual(f?.fallback, null);
    });

    it("Flat 不可表达但允许字段 inputAllowed: true, flatSafe: false, fallback: stdin-json", () => {
      const adv = buildCliInputAdviceV1({
        type: "object",
        properties: {
          "foo.bar": { type: "string" },
        },
      });
      const f = adv.fields.find((field) => field.path === "foo.bar");
      assert.notStrictEqual(f, undefined);
      assert.strictEqual(f?.inputAllowed, true);
      assert.strictEqual(f?.flatSafe, false);
      assert.strictEqual(f?.reason, "UNSAFE_FLAT_PROPERTY");
      assert.strictEqual(f?.fallback, "stdin-json");
    });

    it("标量与复合类型字段映射正确", () => {
      const adv = buildCliInputAdviceV1({
        type: "object",
        properties: {
          str: { type: "string" },
          num: { type: "number" },
          bool: { type: "boolean" },
          nil: { type: "null" },
          arr: { type: "array" },
          obj: { type: "object" },
          anyVal: true,
        },
      });

      const fStr = adv.fields.find((f) => f.path === "str");
      assert.strictEqual(fStr?.operator, "=");
      assert.strictEqual(fStr?.encoding, "string");

      const fNum = adv.fields.find((f) => f.path === "num");
      assert.strictEqual(fNum?.operator, ":=");
      assert.strictEqual(fNum?.encoding, "json-number");

      const fBool = adv.fields.find((f) => f.path === "bool");
      assert.strictEqual(fBool?.operator, ":=");
      assert.strictEqual(fBool?.encoding, "json-boolean");

      const fNil = adv.fields.find((f) => f.path === "nil");
      assert.strictEqual(fNil?.operator, ":=");
      assert.strictEqual(fNil?.encoding, "json-null");

      const fArr = adv.fields.find((f) => f.path === "arr");
      assert.strictEqual(fArr?.operator, ":=");
      assert.strictEqual(fArr?.encoding, "json-array");

      const fObj = adv.fields.find((f) => f.path === "obj");
      assert.strictEqual(fObj?.operator, ":=");
      assert.strictEqual(fObj?.encoding, "json-object");

      const fAny = adv.fields.find((f) => f.path === "anyVal");
      assert.strictEqual(fAny?.operator, ":=");
      assert.strictEqual(fAny?.encoding, "json");
    });
  });

  describe("共享构建器（Section 55）", () => {
    it("buildInputTransportV1 返回标准传输元数据", () => {
      const transport = buildInputTransportV1();
      assert.strictEqual(transport.version, 1);
      assert.strictEqual(transport.defaultInputMode, "empty-object");
      assert.strictEqual(transport.fullJson.inlineOption, "--input");
      assert.strictEqual(transport.fullJson.fileOption, "--input-file");
      assert.strictEqual(transport.fullJson.stdinValue, "-");
      assert.strictEqual(transport.fullJson.preferredLargeInputMode, "stdin");
      assert.strictEqual(transport.fullJson.encoding, "utf-8");
      assert.strictEqual(transport.fullJson.maxInputBytes, 10 * 1024 * 1024);
      assert.strictEqual(transport.fullJson.maxJsonDepth, 256);
    });

    it("buildCliInputEncodingV1 返回标准编码元数据与限制常量", () => {
      const encoding = buildCliInputEncodingV1();
      assert.strictEqual(encoding.name, "flat-json-value");
      assert.strictEqual(encoding.version, 1);
      assert.strictEqual(encoding.scope, "cli-argv");
      assert.strictEqual(encoding.root, "object");
      assert.strictEqual(encoding.operators.string, "=");
      assert.strictEqual(encoding.operators.json, ":=");
      assert.strictEqual(encoding.limits.maxAssignments, 1000);
      assert.strictEqual(encoding.limits.maxPathDepth, 32);
      assert.strictEqual(encoding.limits.maxPathBytes, 1024);
      assert.strictEqual(encoding.limits.maxPropertyKeyBytes, 128);
      assert.strictEqual(encoding.limits.maxRawValueBytes, 1024 * 1024);
      assert.strictEqual(encoding.limits.maxJsonLiteralBytes, 1024 * 1024);
      assert.strictEqual(encoding.limits.maxTotalRawBytes, 10 * 1024 * 1024);
      assert.strictEqual(encoding.limits.maxArrayIndex, 10000);
      assert.strictEqual(encoding.limits.maxMaterializedBytes, 10 * 1024 * 1024);
      assert.strictEqual(encoding.limits.maxJsonDepth, 256);
    });

    it("buildInputPolicyV1 返回 cli-pre-target 与禁止属性名", () => {
      const policy = buildInputPolicyV1();
      assert.strictEqual(policy.version, 1);
      assert.strictEqual(policy.scope, "cli-pre-target");
      assert.strictEqual(policy.propertyScope, "recursive");
      assert.ok((policy.forbiddenPropertyNames).includes("__proto__"));
      assert.ok((policy.forbiddenPropertyNames).includes("constructor"));
      assert.ok((policy.forbiddenPropertyNames).includes("prototype"));
    });


    it("toCliInputErrorEnvelope 与 formatInputErrorForCli 格式化", () => {
      const err = new InputError(INVALID_ARGUMENT, "Something failed", { path: "a.b" });
      const envelope = toCliInputErrorEnvelope(err);
      assert.strictEqual(envelope.ok, false);
      assert.strictEqual(envelope.error.code, INVALID_ARGUMENT);
      assert.strictEqual(envelope.error.message, "Something failed");
      assert.deepStrictEqual(envelope.error.details, { path: "a.b" });

      const formatted = formatInputErrorForCli(err);
      assert.strictEqual(formatted, "Error: Something failed");
    });
  });
});
