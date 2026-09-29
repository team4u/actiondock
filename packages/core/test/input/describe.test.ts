import { describe, expect, it } from "bun:test";
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

      expect(payload.id).toBe("greet");
      expect(payload.packageId).toBe("example");
      expect(payload.description).toBe("Greet user");
      expect(payload.inputSchema).toEqual(spec.inputSchema);
      expect(payload.outputSchema).toEqual(spec.outputSchema);

      expect((payload as any).inputTransport).toBeUndefined();
      expect((payload as any).inputEncoding).toBeUndefined();
      expect((payload as any).inputPolicy).toBeUndefined();

      expect(payload.inputAdvice).toEqual({
        version: 1,
        recommendedMode: "flat",
        assignments: {
          name: "=",
          age: ":=",
          enabled: ":=",
        },
      });
      expect(payload.syntaxReference).toEqual([...ACTION_DESCRIBE_SYNTAX_REFERENCE]);
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
      expect(payload1.inputAdvice).toEqual({
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
      expect(payload2.inputAdvice).toEqual({
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

      expect(payload.inputAdvice.recommendedMode).toBe("full-json");
      expect(payload.inputAdvice.reason).toBe("COMPLEX_SCHEMA");
      expect(payload.inputAdvice.assignments).toBeUndefined();
      expect(payload.syntaxReference).toBeUndefined();
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

      expect(payload.inputAdvice.recommendedMode).toBe("full-json");
      expect(payload.inputAdvice.reason).toBe("NON_OBJECT_SCHEMA");
      expect(payload.inputAdvice.assignments).toBeUndefined();
    });

    it("布尔模式 false 标记为 none 并给出 SCHEMA_REJECTS_ALL 原因", () => {
      const spec = {
        id: "reject-action",
        inputSchema: false,
      };

      const payload = buildActionDescribePayload(spec);

      expect(payload.inputAdvice.recommendedMode).toBe("none");
      expect(payload.inputAdvice.reason).toBe("SCHEMA_REJECTS_ALL");
      expect(payload.inputAdvice.assignments).toBeUndefined();
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

      expect(payload.inputAdvice.recommendedMode).toBe("none");
      expect(payload.inputAdvice.reason).toBe("REQUIRED_FIELD_FORBIDDEN");
      expect(payload.inputAdvice.issues).toEqual([
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

      expect(payload.inputAdvice.recommendedMode).toBe("flat");
      expect(payload.inputAdvice.assignments).toEqual({
        name: "=",
      });
      expect(payload.inputAdvice.issues).toEqual([
        { path: "bad.field", code: "UNSAFE_FLAT_PROPERTY" },
      ]);
    });

    it("支持 options.packageId 作为回退", () => {
      const spec = {
        id: "fallback-pkg",
      };

      const payload = buildActionDescribePayload(spec, { packageId: "fallback.pkg" });
      expect(payload.packageId).toBe("fallback.pkg");
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
      expect(payload.tags).toEqual(["tool", "ai"]);
      expect(payload.annotations).toEqual({ experimental: true });
      expect(payload.uses).toEqual(["auth.login"]);
      expect(payload.entry).toBe("./actions/full-meta.ts");
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

      expect(text).toContain("Action: greet");
      expect(text).toContain("Package: example");
      expect(text).toContain("Description: Greet user");
      expect(text).toContain("Input Schema:\n{\n  \"type\": \"object\",");
      expect(text).toContain("Output Schema:\n{\n  \"type\": \"object\"\n}");
      expect(text).toContain("Recommended Input: flat");
      expect(text).toContain("Assignments:\n  name=\n  age:=");
      expect(text).toContain("Syntax Reference:");
      expect(text).toContain('key="value"');
      expect(text).toContain("count:=10  enabled:=true");
      expect(text).toContain('tags:=\'["a", "b"]\' (or tags.0="a" tags.1="b")');
      expect(text).toContain("--input-file input.json");
      expect(text).not.toContain("Reason:");

      // 验证 Assignments 在 Syntax Reference 上方
      const assignmentsIdx = text.indexOf("Assignments:");
      const syntaxRefIdx = text.indexOf("Syntax Reference:");
      expect(assignmentsIdx).toBeGreaterThanOrEqual(0);
      expect(syntaxRefIdx).toBeGreaterThan(assignmentsIdx);
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

      expect(text).toContain("Action: complex");
      expect(text).toContain("Recommended Input: full-json");
      expect(text).toContain("Reason: COMPLEX_SCHEMA");
      expect(text).not.toContain("Assignments:");
      expect(text).not.toContain("Syntax Reference:");
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

      expect(text).toContain("Action: reject-all");
      expect(text).toContain("Recommended Input: none");
      expect(text).toContain("Reason: SCHEMA_REJECTS_ALL");
      expect(text).not.toContain("Assignments:");
      expect(text).not.toContain("Syntax Reference:");
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

      expect(text).toContain("Recommended Input: flat");
      expect(text).toContain("Assignments:\n  name=");
      expect(text).toContain("Syntax Reference:");
      expect(text).toContain("Issues:\n  - bad_prop: UNSAFE_FLAT_PROPERTY");

      const syntaxRefIdx = text.indexOf("Syntax Reference:");
      const issuesIdx = text.indexOf("Issues:");
      expect(syntaxRefIdx).toBeGreaterThanOrEqual(0);
      expect(issuesIdx).toBeGreaterThan(syntaxRefIdx);
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

      expect(text).toContain("Recommended Input: flat");
      expect(text).not.toContain("Assignments:");
      expect(text).toContain("Syntax Reference:");
      expect(text).toContain('key="value"');
      expect(text).toContain("count:=10  enabled:=true");
      expect(text).toContain('tags:=\'["a", "b"]\' (or tags.0="a" tags.1="b")');
      expect(text).toContain("--input-file input.json");
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

      expect(text).toContain("Recommended Input: full-json");
      expect(text).toContain("Reason: REQUIRED_FIELD_NOT_FLAT_SAFE");
      expect(text).toContain("Assignments:\n  optionalTag=");
      expect(text).toContain("Syntax Reference:");
      expect(text).toContain('key="value"');
    });

    it("ACTION_DESCRIBE_SYNTAX_REFERENCE 包含四个核心维度的入参速查", () => {
      const joined = ACTION_DESCRIBE_SYNTAX_REFERENCE.join("\n");
      // 1. 字符串赋值
      expect(joined).toContain('key="value"');
      // 2. 类型化字面量（数值/布尔）
      expect(joined).toContain("count:=10  enabled:=true");
      // 3. 数组结构（连续索引与直接 JSON 数组）
      expect(joined).toContain('tags:=\'["a", "b"]\'');
      expect(joined).toContain('tags.0="a" tags.1="b"');
      // 4. 复杂/文件输入
      expect(joined).toContain("--input-file input.json");
    });
  });
});
