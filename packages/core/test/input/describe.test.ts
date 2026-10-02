import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildActionDescribePayload,
  formatActionDetail,
  ACTION_DESCRIBE_SYNTAX_REFERENCE,
  type ActionDescribePayload,
} from "../../src/input";

describe("ActionDock describe 输出统一设计", () => {
  describe("buildActionDescribePayload 统一数据模型构建", () => {
    it("构建扁平推荐模式载荷（flat 模式与 assignments 操作符）", () => {
      const spec = {
        id: "greet",
        packageId: "example",
        description: "Greet user",
        inputSchema: {
          type: "object",
          properties: {
            name: { type: "string" },
            age: { type: "number" },
            enabled: { type: "boolean" },
          },
          required: ["name"],
        },
        outputSchema: {
          type: "object",
        },
      };

      const payload = buildActionDescribePayload(spec);

      assert.strictEqual(payload.id, "greet");
      assert.strictEqual(payload.packageId, "example");
      assert.strictEqual(payload.description, "Greet user");
      assert.deepStrictEqual(payload.inputSchema, spec.inputSchema);
      assert.deepStrictEqual(payload.outputSchema, spec.outputSchema);

      assert.strictEqual((payload as any).inputTransport, undefined);
      assert.strictEqual((payload as any).inputEncoding, undefined);
      assert.strictEqual((payload as any).inputPolicy, undefined);

      assert.deepStrictEqual(payload.inputAdvice, {
        version: 1,
        recommendedMode: "flat",
        assignments: {
          name: "=",
          age: ":=",
          enabled: ":=",
        },
      });
      assert.deepStrictEqual(payload.syntaxReference, [...ACTION_DESCRIBE_SYNTAX_REFERENCE]);
    });

    it("空对象 Schema 推荐 flat 模式且 assignments 为空对象", () => {
      // 1. 带空 properties 对象的 Schema
      const specWithEmptyProps = {
        id: "empty-props",
        inputSchema: {
          type: "object",
          properties: {},
        },
      };
      const payload1 = buildActionDescribePayload(specWithEmptyProps);
      assert.deepStrictEqual(payload1.inputAdvice, {
        version: 1,
        recommendedMode: "flat",
        assignments: {},
      });

      // 2. 仅声明 type: "object" 的 Schema
      const specTypeOnly = {
        id: "type-only",
        inputSchema: {
          type: "object",
        },
      };
      const payload2 = buildActionDescribePayload(specTypeOnly);
      assert.deepStrictEqual(payload2.inputAdvice, {
        version: 1,
        recommendedMode: "flat",
        assignments: {},
      });
    });

    it("复杂 Schema 标记为 full-json 并给出 COMPLEX_SCHEMA 原因", () => {
      const spec = {
        id: "complex-action",
        inputSchema: {
          type: "object",
          properties: {
            param: { type: "string" },
          },
          oneOf: [{ required: ["param"] }],
        },
      };

      const payload = buildActionDescribePayload(spec);

      assert.strictEqual(payload.inputAdvice.recommendedMode, "full-json");
      assert.strictEqual(payload.inputAdvice.reason, "COMPLEX_SCHEMA");
      assert.strictEqual(payload.inputAdvice.assignments, undefined);
      assert.strictEqual(payload.syntaxReference, undefined);
    });

    it("非对象根模式标记为 full-json 并给出 NON_OBJECT_SCHEMA 原因", () => {
      const spec = {
        id: "array-action",
        inputSchema: {
          type: "array",
          items: { type: "string" },
        },
      };

      const payload = buildActionDescribePayload(spec);

      assert.strictEqual(payload.inputAdvice.recommendedMode, "full-json");
      assert.strictEqual(payload.inputAdvice.reason, "NON_OBJECT_SCHEMA");
      assert.strictEqual(payload.inputAdvice.assignments, undefined);
    });

    it("布尔模式 false 标记为 none 并给出 SCHEMA_REJECTS_ALL 原因", () => {
      const spec = {
        id: "reject-action",
        inputSchema: false,
      };

      const payload = buildActionDescribePayload(spec);

      assert.strictEqual(payload.inputAdvice.recommendedMode, "none");
      assert.strictEqual(payload.inputAdvice.reason, "SCHEMA_REJECTS_ALL");
      assert.strictEqual(payload.inputAdvice.assignments, undefined);
    });

    it("必填字段包含禁止属性时标记为 none 并收集 issues", () => {
      const spec = {
        id: "forbidden-action",
        inputSchema: {
          type: "object",
          properties: {
            __proto__: { type: "string" },
          },
          required: ["__proto__"],
        },
      };

      const payload = buildActionDescribePayload(spec);

      assert.strictEqual(payload.inputAdvice.recommendedMode, "none");
      assert.strictEqual(payload.inputAdvice.reason, "REQUIRED_FIELD_FORBIDDEN");
      assert.deepStrictEqual(payload.inputAdvice.issues, [
        { path: "__proto__", code: "FORBIDDEN_PROPERTY" },
      ]);
    });

    it("存在不安全属性时收集 issues", () => {
      const spec = {
        id: "unsafe-prop-action",
        inputSchema: {
          type: "object",
          properties: {
            name: { type: "string" },
            "bad.field": { type: "string" },
          },
          required: ["name"],
        },
      };

      const payload = buildActionDescribePayload(spec);

      assert.strictEqual(payload.inputAdvice.recommendedMode, "flat");
      assert.deepStrictEqual(payload.inputAdvice.assignments, {
        name: "=",
      });
      assert.deepStrictEqual(payload.inputAdvice.issues, [
        { path: "bad.field", code: "UNSAFE_FLAT_PROPERTY" },
      ]);
    });

    it("支持 options.packageId 作为回退", () => {
      const spec = {
        id: "fallback-pkg",
      };

      const payload = buildActionDescribePayload(spec, { packageId: "fallback.pkg" });
      assert.strictEqual(payload.packageId, "fallback.pkg");
    });

    it("完整透传 tags, annotations, uses, entry", () => {
      const spec = {
        id: "full-meta",
        tags: ["tool", "ai"],
        annotations: { experimental: true },
        uses: ["auth.login"],
        entry: "./actions/full-meta.ts",
      };

      const payload = buildActionDescribePayload(spec);
      assert.deepStrictEqual(payload.tags, ["tool", "ai"]);
      assert.deepStrictEqual(payload.annotations, { experimental: true });
      assert.deepStrictEqual(payload.uses, ["auth.login"]);
      assert.strictEqual(payload.entry, "./actions/full-meta.ts");
    });
  });

  describe("formatActionDetail 人类可读文本格式化", () => {
    it("正确格式化扁平模式输出", () => {
      const payload: ActionDescribePayload = {
        id: "greet",
        packageId: "example",
        description: "Greet user",
        inputSchema: {
          type: "object",
          properties: {
            name: { type: "string" },
            age: { type: "number" },
          },
          required: ["name"],
        },
        outputSchema: {
          type: "object",
        },
        inputAdvice: {
          version: 1,
          recommendedMode: "flat",
          assignments: {
            name: "=",
            age: ":=",
          },
        },
      };

      const text = formatActionDetail(payload);

      assert.ok((text).includes("Action: greet"));
      assert.ok((text).includes("Package: example"));
      assert.ok((text).includes("Description: Greet user"));
      assert.ok((text).includes("Input Schema:\n{\n  \"type\": \"object\","));
      assert.ok((text).includes("Output Schema:\n{\n  \"type\": \"object\"\n}"));
      assert.ok((text).includes("Recommended Input: flat"));
      assert.ok((text).includes("Assignments:\n  name=\n  age:="));
      assert.ok((text).includes("Syntax Reference:"));
      assert.ok((text).includes('key="value"'));
      assert.ok((text).includes("count:=10  enabled:=true"));
      assert.ok((text).includes('tags:=\'["a", "b"]\' (or tags.0="a" tags.1="b")'));
      assert.ok((text).includes("--input-file input.json"));
      assert.ok(!(text).includes("Reason:"));

      // 验证 Assignments 在 Syntax Reference 上方
      const assignmentsIdx = text.indexOf("Assignments:");
      const syntaxRefIdx = text.indexOf("Syntax Reference:");
      assert.ok((assignmentsIdx) >= 0);
      assert.ok((syntaxRefIdx) > assignmentsIdx);
    });

    it("正确格式化复杂模式输出", () => {
      const payload: ActionDescribePayload = {
        id: "complex",
        inputAdvice: {
          version: 1,
          recommendedMode: "full-json",
          reason: "COMPLEX_SCHEMA",
        },
      };

      const text = formatActionDetail(payload);

      assert.ok((text).includes("Action: complex"));
      assert.ok((text).includes("Recommended Input: full-json"));
      assert.ok((text).includes("Reason: COMPLEX_SCHEMA"));
      assert.ok(!(text).includes("Assignments:"));
      assert.ok(!(text).includes("Syntax Reference:"));
    });

    it("正确格式化不可输入模式输出", () => {
      const payload: ActionDescribePayload = {
        id: "reject-all",
        inputAdvice: {
          version: 1,
          recommendedMode: "none",
          reason: "SCHEMA_REJECTS_ALL",
        },
      };

      const text = formatActionDetail(payload);

      assert.ok((text).includes("Action: reject-all"));
      assert.ok((text).includes("Recommended Input: none"));
      assert.ok((text).includes("Reason: SCHEMA_REJECTS_ALL"));
      assert.ok(!(text).includes("Assignments:"));
      assert.ok(!(text).includes("Syntax Reference:"));
    });

    it("包含 issues 时正确展示 Issues 列表且位于 Syntax Reference 下方", () => {
      const payload: ActionDescribePayload = {
        id: "with-issues",
        inputAdvice: {
          version: 1,
          recommendedMode: "flat",
          assignments: {
            name: "=",
          },
          issues: [
            { path: "bad_prop", code: "UNSAFE_FLAT_PROPERTY" },
          ],
        },
      };

      const text = formatActionDetail(payload);

      assert.ok((text).includes("Recommended Input: flat"));
      assert.ok((text).includes("Assignments:\n  name="));
      assert.ok((text).includes("Syntax Reference:"));
      assert.ok((text).includes("Issues:\n  - bad_prop: UNSAFE_FLAT_PROPERTY"));

      const syntaxRefIdx = text.indexOf("Syntax Reference:");
      const issuesIdx = text.indexOf("Issues:");
      assert.ok((syntaxRefIdx) >= 0);
      assert.ok((issuesIdx) > syntaxRefIdx);
    });

    it("当 recommendedMode 为 flat 但无 assignments 时仍输出 Syntax Reference", () => {
      const payload: ActionDescribePayload = {
        id: "empty-object",
        inputAdvice: {
          version: 1,
          recommendedMode: "flat",
          assignments: {},
        },
      };

      const text = formatActionDetail(payload);

      assert.ok((text).includes("Recommended Input: flat"));
      assert.ok(!(text).includes("Assignments:"));
      assert.ok((text).includes("Syntax Reference:"));
      assert.ok((text).includes('key="value"'));
      assert.ok((text).includes("count:=10  enabled:=true"));
      assert.ok((text).includes('tags:=\'["a", "b"]\' (or tags.0="a" tags.1="b")'));
      assert.ok((text).includes("--input-file input.json"));
    });

    it("当存在 assignments 且 recommendedMode 为 full-json 时仍追加 Syntax Reference", () => {
      const payload: ActionDescribePayload = {
        id: "partial-flat",
        inputAdvice: {
          version: 1,
          recommendedMode: "full-json",
          reason: "REQUIRED_FIELD_NOT_FLAT_SAFE",
          assignments: {
            optionalTag: "=",
          },
        },
      };

      const text = formatActionDetail(payload);

      assert.ok((text).includes("Recommended Input: full-json"));
      assert.ok((text).includes("Reason: REQUIRED_FIELD_NOT_FLAT_SAFE"));
      assert.ok((text).includes("Assignments:\n  optionalTag="));
      assert.ok((text).includes("Syntax Reference:"));
      assert.ok((text).includes('key="value"'));
    });

    it("ACTION_DESCRIBE_SYNTAX_REFERENCE 包含四个核心维度的入参速查", () => {
      const joined = ACTION_DESCRIBE_SYNTAX_REFERENCE.join("\n");
      // 1. 字符串赋值
      assert.ok((joined).includes('key="value"'));
      // 2. 类型化字面量（数值/布尔）
      assert.ok((joined).includes("count:=10  enabled:=true"));
      // 3. 数组结构（连续索引与直接 JSON 数组）
      assert.ok((joined).includes('tags:=\'["a", "b"]\''));
      assert.ok((joined).includes('tags.0="a" tags.1="b"'));
      // 4. 复杂/文件输入
      assert.ok((joined).includes("--input-file input.json"));
    });
  });
});
