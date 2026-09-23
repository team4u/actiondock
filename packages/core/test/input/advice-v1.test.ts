import { describe, expect, it } from "bun:test";
import {
  buildCliInputAdviceV1,
  buildInputTransportV1,
  buildCliInputEncodingV1,
  buildInputPolicyV1,
  buildCliDescribeInputMetadataV1,
  formatInputErrorForCli,
  toCliInputErrorEnvelope,
  InputError,
} from "../../src/input";
import { INVALID_ARGUMENT } from "../../src/errors";

describe("Phase 9: Input Advice v1 与元数据构建器", () => {
  describe("Schema Sanity 阶段（Section 44）", () => {
    it("合法根形状通过：undefined, boolean, plain object", () => {
      const advUndefined = buildCliInputAdviceV1(undefined);
      expect(advUndefined.analysisStatus).toBe("ok");
      expect(advUndefined.schemaState).toBe("absent");

      const advFalse = buildCliInputAdviceV1(false);
      expect(advFalse.analysisStatus).toBe("ok");
      expect(advFalse.schemaState).toBe("reject-all");

      const advTrue = buildCliInputAdviceV1(true);
      expect(advTrue.analysisStatus).toBe("ok");
      expect(advTrue.schemaState).toBe("any");

      const advObj = buildCliInputAdviceV1({ type: "object", properties: { name: { type: "string" } } });
      expect(advObj.analysisStatus).toBe("ok");
      expect(advObj.schemaState).toBe("object");
    });

    it("非法根形状判为 malformed / MALFORMED_SCHEMA", () => {
      for (const invalidRoot of [null, "string", 123, [1, 2], () => {}]) {
        const adv = buildCliInputAdviceV1(invalidRoot);
        expect(adv.analysisStatus).toBe("malformed");
        expect(adv.analysisCode).toBe("MALFORMED_SCHEMA");
        expect(adv.schemaState).toBe("complex");
        expect(adv.schemaRecommendedMode).toBe("full-json");
        expect(adv.fields).toEqual([]);
      }
    });

    it("非法 type 关键字判为 malformed", () => {
      // 1. 非 string 也非 array
      const adv1 = buildCliInputAdviceV1({ type: 123 });
      expect(adv1.analysisStatus).toBe("malformed");
      expect(adv1.analysisCode).toBe("MALFORMED_SCHEMA");

      // 2. 未识别的类型字符串
      const adv2 = buildCliInputAdviceV1({ type: "custom-type" });
      expect(adv2.analysisStatus).toBe("malformed");
      expect(adv2.analysisCode).toBe("MALFORMED_SCHEMA");

      // 3. 空数组
      const adv3 = buildCliInputAdviceV1({ type: [] });
      expect(adv3.analysisStatus).toBe("malformed");
      expect(adv3.analysisCode).toBe("MALFORMED_SCHEMA");

      // 4. 重复类型
      const adv4 = buildCliInputAdviceV1({ type: ["string", "string"] });
      expect(adv4.analysisStatus).toBe("malformed");
      expect(adv4.analysisCode).toBe("MALFORMED_SCHEMA");
    });

    it("非法 properties 与 property schema 判为 malformed", () => {
      // 1. properties 非 plain object
      const adv1 = buildCliInputAdviceV1({ properties: "invalid" });
      expect(adv1.analysisStatus).toBe("malformed");
      expect(adv1.analysisCode).toBe("MALFORMED_SCHEMA");

      // 2. 字段 schema 既不是 boolean 也不是 plain object
      const adv2 = buildCliInputAdviceV1({
        type: "object",
        properties: { name: "invalid" },
      });
      expect(adv2.analysisStatus).toBe("malformed");
      expect(adv2.analysisCode).toBe("MALFORMED_SCHEMA");

      // 3. 字段 schema 内部包含未识别类型
      const adv3 = buildCliInputAdviceV1({
        type: "object",
        properties: { name: { type: "unknown" } },
      });
      expect(adv3.analysisStatus).toBe("malformed");
      expect(adv3.analysisCode).toBe("MALFORMED_SCHEMA");
    });

    it("非法 required 关键字判为 malformed", () => {
      // 1. 非 array
      const adv1 = buildCliInputAdviceV1({ type: "object", required: "name" });
      expect(adv1.analysisStatus).toBe("malformed");
      expect(adv1.analysisCode).toBe("MALFORMED_SCHEMA");

      // 2. 数组包含非 string
      const adv2 = buildCliInputAdviceV1({ type: "object", required: [123] });
      expect(adv2.analysisStatus).toBe("malformed");
      expect(adv2.analysisCode).toBe("MALFORMED_SCHEMA");

      // 3. 重复字段
      const adv3 = buildCliInputAdviceV1({ type: "object", required: ["a", "a"] });
      expect(adv3.analysisStatus).toBe("malformed");
      expect(adv3.analysisCode).toBe("MALFORMED_SCHEMA");
    });

    it("非法 additionalProperties 与 items 判定", () => {
      // 1. additionalProperties 既非 boolean 也非 plain object
      const adv1 = buildCliInputAdviceV1({
        type: "object",
        additionalProperties: "invalid",
      });
      expect(adv1.analysisStatus).toBe("malformed");
      expect(adv1.analysisCode).toBe("MALFORMED_SCHEMA");

      // 2. items 为元组数组时判为 unsupported / UNSUPPORTED_SCHEMA_SHAPE
      const adv2 = buildCliInputAdviceV1({
        type: "array",
        items: [{ type: "string" }, { type: "number" }],
      });
      expect(adv2.analysisStatus).toBe("unsupported");
      expect(adv2.analysisCode).toBe("UNSUPPORTED_SCHEMA_SHAPE");
      expect(adv2.schemaState).toBe("complex");

      // 3. items 既非 boolean 也非 object/array
      const adv3 = buildCliInputAdviceV1({
        type: "array",
        items: 123,
      });
      expect(adv3.analysisStatus).toBe("malformed");
      expect(adv3.analysisCode).toBe("MALFORMED_SCHEMA");
    });

    it("非法 enum 与 const 判定", () => {
      // 1. enum 非 array 或为空
      const adv1 = buildCliInputAdviceV1({ enum: "not-array" });
      expect(adv1.analysisStatus).toBe("malformed");
      const adv2 = buildCliInputAdviceV1({ enum: [] });
      expect(adv2.analysisStatus).toBe("malformed");

      // 2. const 为非法 JSON 字面量类型（如函数、undefined、NaN 等）
      const adv3 = buildCliInputAdviceV1({ const: () => {} });
      expect(adv3.analysisStatus).toBe("malformed");
      const adv4 = buildCliInputAdviceV1({ const: NaN });
      expect(adv4.analysisStatus).toBe("malformed");
    });

    it("非法 applicators 判定", () => {
      expect(buildCliInputAdviceV1({ oneOf: "not-array" }).analysisStatus).toBe("malformed");
      expect(buildCliInputAdviceV1({ anyOf: "not-array" }).analysisStatus).toBe("malformed");
      expect(buildCliInputAdviceV1({ allOf: "not-array" }).analysisStatus).toBe("malformed");
      expect(buildCliInputAdviceV1({ $ref: 123 }).analysisStatus).toBe("malformed");
      expect(buildCliInputAdviceV1({ not: 123 }).analysisStatus).toBe("malformed");
    });
  });

  describe("语义分类阶段（Section 45）", () => {
    it("absent 语义", () => {
      const adv = buildCliInputAdviceV1(undefined);
      expect(adv.schemaState).toBe("absent");
      expect(adv.analysisStatus).toBe("ok");
      expect(adv.schemaRecommendedMode).toBe("full-json");
      expect(adv.requiredSatisfiable).toBeNull();
    });

    it("reject-all 语义", () => {
      const adv = buildCliInputAdviceV1(false);
      expect(adv.schemaState).toBe("reject-all");
      expect(adv.inputFeasibility).toBe("known-impossible");
      expect(adv.feasibilityCode).toBe("SCHEMA_REJECTS_ALL");
      expect(adv.schemaRecommendedMode).toBe("none");
      expect(adv.requiredSatisfiable).toBe(false);
    });

    it("any 语义", () => {
      const advTrue = buildCliInputAdviceV1(true);
      expect(advTrue.schemaState).toBe("any");
      expect(advTrue.schemaRecommendedMode).toBe("full-json");

      const advEmpty = buildCliInputAdviceV1({});
      expect(advEmpty.schemaState).toBe("any");
      expect(advEmpty.schemaRecommendedMode).toBe("full-json");
    });

    it("object 语义", () => {
      const adv = buildCliInputAdviceV1({
        type: "object",
        properties: {
          name: { type: "string" },
        },
      });
      expect(adv.schemaState).toBe("object");
      expect(adv.flatCandidate).toBe(true);
      expect(adv.schemaRecommendedMode).toBe("flat");
    });

    it("json-only 语义（显式单一非对象类型）", () => {
      for (const type of ["string", "number", "integer", "boolean", "array"]) {
        const adv = buildCliInputAdviceV1({ type });
        expect(adv.schemaState).toBe("json-only");
        expect(adv.schemaRecommendedMode).toBe("full-json");
        expect(adv.requiredSatisfiable).toBe(false);
      }
    });

    it("complex 语义（applicators / union type / 无显式 type 带 properties）", () => {
      // 1. oneOf / anyOf / allOf / $ref
      expect(buildCliInputAdviceV1({ oneOf: [{ type: "string" }] }).schemaState).toBe("complex");
      expect(buildCliInputAdviceV1({ anyOf: [{ type: "string" }] }).schemaState).toBe("complex");
      expect(buildCliInputAdviceV1({ allOf: [{ type: "string" }] }).schemaState).toBe("complex");
      expect(buildCliInputAdviceV1({ $ref: "#/definitions/Foo" }).schemaState).toBe("complex");

      // 2. 联合类型 union type
      expect(buildCliInputAdviceV1({ type: ["string", "number"] }).schemaState).toBe("complex");

      // 3. 无显式 type 但具备 properties / required / additionalProperties
      expect(
        buildCliInputAdviceV1({
          properties: { name: { type: "string" } },
        }).schemaState
      ).toBe("complex");
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
      expect(f1?.operator).toBe("=");
      expect(f1?.encoding).toBe("string");
      expect(f1?.assignmentTemplate).toBe("status=TEXT");

      // integer + const -> := / json-number
      const adv2 = buildCliInputAdviceV1({
        type: "object",
        properties: {
          version: { type: "integer", const: 1 },
        },
      });
      const f2 = adv2.fields.find((f) => f.path === "version");
      expect(f2?.operator).toBe(":=");
      expect(f2?.encoding).toBe("json-number");
      expect(f2?.assignmentTemplate).toBe("version:=NUMBER");

      // boolean + const -> := / json-boolean
      const adv3 = buildCliInputAdviceV1({
        type: "object",
        properties: {
          enabled: { type: "boolean", const: true },
        },
      });
      const f3 = adv3.fields.find((f) => f.path === "enabled");
      expect(f3?.operator).toBe(":=");
      expect(f3?.encoding).toBe("json-boolean");
      expect(f3?.assignmentTemplate).toBe("enabled:=BOOLEAN");
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
      expect(fStatus?.flatSafe).toBe(false);
      expect(fStatus?.operator).toBeUndefined();
      expect(fStatus?.fallback).toBe("stdin-json");
      expect(fStatus?.reason).toBe("UNSAFE_FLAT_PROPERTY");

      const fCode = adv.fields.find((f) => f.path === "code");
      expect(fCode?.flatSafe).toBe(false);
      expect(fCode?.operator).toBeUndefined();
      expect(fCode?.fallback).toBe("stdin-json");
      expect(fCode?.reason).toBe("UNSAFE_FLAT_PROPERTY");
    });
  });

  describe("输入可行性判定（Section 47）与 feasibilityCode", () => {
    it("schema 为 false 判定为 SCHEMA_REJECTS_ALL", () => {
      const adv = buildCliInputAdviceV1(false);
      expect(adv.inputFeasibility).toBe("known-impossible");
      expect(adv.feasibilityCode).toBe("SCHEMA_REJECTS_ALL");
      expect(adv.schemaRecommendedMode).toBe("none");
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
        expect(adv.inputFeasibility).toBe("known-impossible");
        expect(adv.feasibilityCode).toBe("REQUIRED_FIELD_FORBIDDEN");
        expect(adv.schemaRecommendedMode).toBe("none");
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
      expect(adv.inputFeasibility).toBe("known-impossible");
      expect(adv.feasibilityCode).toBe("REQUIRED_FIELD_REJECTS_ALL");
      expect(adv.schemaRecommendedMode).toBe("none");
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
      expect(adv.inputFeasibility).toBe("known-impossible");
      expect(adv.feasibilityCode).toBe(
        "REQUIRED_FIELD_DISALLOWED_BY_ADDITIONAL_PROPERTIES"
      );
      expect(adv.schemaRecommendedMode).toBe("none");
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
      expect(adv.inputFeasibility).toBe("possible-or-unknown");
      expect(adv.feasibilityCode).toBeUndefined();
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
      expect(adv.requiredSatisfiable).toBe(true);
      expect(adv.flatCandidate).toBe(true);
      expect(adv.schemaRecommendedMode).toBe("flat");
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
      expect(adv.requiredSatisfiable).toBe(true);
      expect(adv.flatCandidate).toBe(true);
      expect(adv.schemaRecommendedMode).toBe("flat");
    });

    it("object 必填项包含非 flatSafe 字段时 requiredSatisfiable 为 false，推荐 full-json", () => {
      const adv = buildCliInputAdviceV1({
        type: "object",
        properties: {
          "user name": { type: "string" },
        },
        required: ["user name"],
      });
      expect(adv.requiredSatisfiable).toBe(false);
      expect(adv.flatCandidate).toBe(false);
      expect(adv.schemaRecommendedMode).toBe("full-json");
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
      expect(adv.requiredSatisfiable).toBeNull();
      expect(adv.flatCandidate).toBe(false);
      expect(adv.schemaRecommendedMode).toBe("full-json");
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
      expect(f).toBeDefined();
      expect(f?.inputAllowed).toBe(false);
      expect(f?.flatSafe).toBe(false);
      expect(f?.reason).toBe("FORBIDDEN_PROPERTY");
      expect(f?.fallback).toBeNull();
    });

    it("Flat 不可表达但允许字段 inputAllowed: true, flatSafe: false, fallback: stdin-json", () => {
      const adv = buildCliInputAdviceV1({
        type: "object",
        properties: {
          "foo.bar": { type: "string" },
        },
      });
      const f = adv.fields.find((field) => field.path === "foo.bar");
      expect(f).toBeDefined();
      expect(f?.inputAllowed).toBe(true);
      expect(f?.flatSafe).toBe(false);
      expect(f?.reason).toBe("UNSAFE_FLAT_PROPERTY");
      expect(f?.fallback).toBe("stdin-json");
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
      expect(fStr?.operator).toBe("=");
      expect(fStr?.encoding).toBe("string");

      const fNum = adv.fields.find((f) => f.path === "num");
      expect(fNum?.operator).toBe(":=");
      expect(fNum?.encoding).toBe("json-number");

      const fBool = adv.fields.find((f) => f.path === "bool");
      expect(fBool?.operator).toBe(":=");
      expect(fBool?.encoding).toBe("json-boolean");

      const fNil = adv.fields.find((f) => f.path === "nil");
      expect(fNil?.operator).toBe(":=");
      expect(fNil?.encoding).toBe("json-null");

      const fArr = adv.fields.find((f) => f.path === "arr");
      expect(fArr?.operator).toBe(":=");
      expect(fArr?.encoding).toBe("json-array");

      const fObj = adv.fields.find((f) => f.path === "obj");
      expect(fObj?.operator).toBe(":=");
      expect(fObj?.encoding).toBe("json-object");

      const fAny = adv.fields.find((f) => f.path === "anyVal");
      expect(fAny?.operator).toBe(":=");
      expect(fAny?.encoding).toBe("json");
    });
  });

  describe("共享构建器（Section 55）", () => {
    it("buildInputTransportV1 返回标准传输元数据", () => {
      const transport = buildInputTransportV1();
      expect(transport.version).toBe(1);
      expect(transport.defaultInputMode).toBe("empty-object");
      expect(transport.fullJson.inlineOption).toBe("--input");
      expect(transport.fullJson.fileOption).toBe("--input-file");
      expect(transport.fullJson.stdinValue).toBe("-");
      expect(transport.fullJson.preferredLargeInputMode).toBe("stdin");
      expect(transport.fullJson.encoding).toBe("utf-8");
      expect(transport.fullJson.maxInputBytes).toBe(10 * 1024 * 1024);
      expect(transport.fullJson.maxJsonDepth).toBe(256);
    });

    it("buildCliInputEncodingV1 返回标准编码元数据与限制常量", () => {
      const encoding = buildCliInputEncodingV1();
      expect(encoding.name).toBe("flat-json-value");
      expect(encoding.version).toBe(1);
      expect(encoding.scope).toBe("cli-argv");
      expect(encoding.root).toBe("object");
      expect(encoding.operators.string).toBe("=");
      expect(encoding.operators.json).toBe(":=");
      expect(encoding.limits.maxAssignments).toBe(1000);
      expect(encoding.limits.maxPathDepth).toBe(32);
      expect(encoding.limits.maxPathBytes).toBe(1024);
      expect(encoding.limits.maxPropertyKeyBytes).toBe(128);
      expect(encoding.limits.maxRawValueBytes).toBe(1024 * 1024);
      expect(encoding.limits.maxJsonLiteralBytes).toBe(1024 * 1024);
      expect(encoding.limits.maxTotalRawBytes).toBe(10 * 1024 * 1024);
      expect(encoding.limits.maxArrayIndex).toBe(10000);
      expect(encoding.limits.maxMaterializedBytes).toBe(10 * 1024 * 1024);
      expect(encoding.limits.maxJsonDepth).toBe(256);
    });

    it("buildInputPolicyV1 返回 cli-pre-target 与禁止属性名", () => {
      const policy = buildInputPolicyV1();
      expect(policy.version).toBe(1);
      expect(policy.scope).toBe("cli-pre-target");
      expect(policy.propertyScope).toBe("recursive");
      expect(policy.forbiddenPropertyNames).toContain("__proto__");
      expect(policy.forbiddenPropertyNames).toContain("constructor");
      expect(policy.forbiddenPropertyNames).toContain("prototype");
    });

    it("buildCliDescribeInputMetadataV1 聚合全部元数据", () => {
      const metadata = buildCliDescribeInputMetadataV1({
        type: "object",
        properties: { name: { type: "string" } },
      });
      expect(metadata.inputTransport).toBeDefined();
      expect(metadata.inputEncoding).toBeDefined();
      expect(metadata.inputPolicy).toBeDefined();
      expect(metadata.inputAdvice).toBeDefined();
      expect(metadata.inputPolicy.scope).toBe("cli-pre-target");
      expect(metadata.inputAdvice.schemaState).toBe("object");
    });

    it("toCliInputErrorEnvelope 与 formatInputErrorForCli 格式化", () => {
      const err = new InputError(INVALID_ARGUMENT, "Something failed", { path: "a.b" });
      const envelope = toCliInputErrorEnvelope(err);
      expect(envelope.ok).toBe(false);
      expect(envelope.error.code).toBe(INVALID_ARGUMENT);
      expect(envelope.error.message).toBe("Something failed");
      expect(envelope.error.details).toEqual({ path: "a.b" });

      const formatted = formatInputErrorForCli(err);
      expect(formatted).toBe("Error: Something failed");
    });
  });
});
