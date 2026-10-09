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

    it("未声明默认正文时展示通用输出行为说明，不猜测字段，支持 CLI 显式覆盖提示", () => {
      const payload: ActionDescribePayload = {
        id: "unannotated",
        inputAdvice: {
          version: 1,
          recommendedMode: "flat",
        },
      };

      const text = formatActionDetail(payload, { supportsTextField: true });
      assert.ok((text).includes("Output Selection:"));
      assert.ok((text).includes("Default: Raw string for string results; formatted JSON for objects and arrays"));
      assert.ok((text).includes("Full result: Pass '--json' to receive the complete structured envelope"));
      assert.ok((text).includes("Custom field: Pass '--text-field <field>' to extract a specific top-level string field"));
      // 不臆测私有字段
      assert.ok(!(text).includes("content"));
      assert.ok(!(text).includes("summary"));
    });

    it("声明默认正文时清楚展示字段名、通道语义、--json 完整结果、显式覆盖与同步适用范围", () => {
      const payload: ActionDescribePayload = {
        id: "annotated",
        annotations: {
          "actiondock.cli": {
            textField: "summary",
          },
        },
        outputSchema: {
          type: "object",
          properties: {
            summary: { type: "string" },
            count: { type: "number" },
          },
          required: ["summary"],
        },
        inputAdvice: {
          version: 1,
          recommendedMode: "flat",
        },
      };

      const text = formatActionDetail(payload, { supportsTextField: true });
      assert.ok((text).includes("Output Selection:"));
      assert.ok((text).includes("Default text field: summary"));
      assert.ok((text).includes("stdout: Raw text content of 'summary' (synchronous execution only)"));
      assert.ok((text).includes("stderr: Remaining fields as JSON metadata, diagnostics, and logs"));
      assert.ok((text).includes("Full result: Pass '--json' to receive the complete structured envelope"));
      assert.ok((text).includes("Override: Pass '--text-field <field>' to select another top-level string field"));
    });

    it("目录型 Standalone 入口真实反映 content/text/message 嗅探与回退行为，不宣传其不支持的 --text-field 运行选项", () => {
      const unannotatedPayload: ActionDescribePayload = {
        id: "standalone-unannotated",
        inputAdvice: { version: 1, recommendedMode: "flat" },
      };

      const unannotatedText = formatActionDetail(unannotatedPayload, { supportsTextField: false });
      assert.ok((unannotatedText).includes("Output Selection:"));
      assert.ok((unannotatedText).includes("Default: Raw string for scalars; extracts 'content', 'text', or 'message' from objects (with metadata on stderr), falling back to formatted JSON"));
      assert.ok((unannotatedText).includes("Full result: Pass '--json'"));
      // 严禁宣传 --text-field
      assert.ok(!(unannotatedText).includes("--text-field"));

      const annotatedPayload: ActionDescribePayload = {
        id: "standalone-annotated",
        annotations: {
          "actiondock.cli": { textField: "content" },
        },
        inputAdvice: { version: 1, recommendedMode: "flat" },
      };

      const annotatedText = formatActionDetail(annotatedPayload, { supportsTextField: false });
      assert.ok((annotatedText).includes("Output Selection:"));
      assert.ok((annotatedText).includes("Default text field: content"));
      assert.ok((annotatedText).includes("ignored in standalone runtime; standalone extracts 'content', 'text', or 'message', falling back to formatted JSON"));
      assert.ok((annotatedText).includes("stdout: Raw string for scalars; extracts 'content', 'text', or 'message' from objects"));
      assert.ok((annotatedText).includes("stderr: Remaining fields as metadata (for extracted fields), diagnostics, and logs"));
      // 严禁宣传 --text-field 选项
      assert.ok(!(annotatedText).includes("Pass '--text-field"));
    });

    it("声明非法注解时在 Output Selection 中清晰展示拒绝执行信息且不暗示自动回退，说明可使用 --json 或显式 --text-field 绕过", () => {
      const payload: ActionDescribePayload = {
        id: "bad-annotation",
        annotations: {
          "actiondock.cli": { textField: 123 },
        },
        inputAdvice: { version: 1, recommendedMode: "flat" },
      };

      const text = formatActionDetail(payload);
      assert.ok((text).includes("Output Selection:"));
      assert.ok((text).includes("Invalid annotation:"));
      assert.ok((text).includes("expected a string, but received number"));
      assert.ok((text).includes("Synchronous execution will be rejected before invocation due to invalid annotation"));
      assert.ok((text).includes("Pass '--json' to bypass default annotation"));
      assert.ok((text).includes("Pass '--text-field <field>' to bypass default annotation"));
      // 不得暗示存在自动默认回退
      assert.ok(!(text).includes("Default: Raw string"));
    });

    it("注解合法但与 Schema 存在矛盾时标注 Contract conflict，保留默认选择字段说明且不称作 Invalid annotation", () => {
      const payload: ActionDescribePayload = {
        id: "conflict-action",
        annotations: {
          "actiondock.cli": { textField: "summary" },
        },
        outputSchema: {
          type: "string", // 根类型为 string，与对象字段提取冲突
        },
        inputAdvice: { version: 1, recommendedMode: "flat" },
      };

      const text = formatActionDetail(payload, { supportsTextField: true });
      assert.ok((text).includes("Output Selection:"));
      assert.ok((text).includes("Default text field: summary"));
      assert.ok((text).includes("Contract conflict:"));
      assert.ok((text).includes("does not allow an object"));
      assert.ok((text).includes("stdout: Raw text content of 'summary' (synchronous execution only)"));
      // 不得误报为 Invalid annotation
      assert.ok(!(text).includes("Invalid annotation:"));
    });

    it("目录型 Standalone 模式下若存在非法注解或契约冲突，明确说明 standalone 忽略注解并按旧嗅探规则运行", () => {
      const badAnnoPayload: ActionDescribePayload = {
        id: "standalone-bad-anno",
        annotations: {
          "actiondock.cli": { textField: 777 },
        },
        inputAdvice: { version: 1, recommendedMode: "flat" },
      };

      const textBadAnno = formatActionDetail(badAnnoPayload, { supportsTextField: false });
      assert.ok((textBadAnno).includes("Invalid annotation:"));
      assert.ok((textBadAnno).includes("ignored in standalone runtime; standalone extracts 'content', 'text', or 'message'"));
      // 不暗示独立运行时会拒绝调用
      assert.ok(!(textBadAnno).includes("rejected before invocation"));

      const conflictPayload: ActionDescribePayload = {
        id: "standalone-conflict",
        annotations: {
          "actiondock.cli": { textField: "summary" },
        },
        outputSchema: {
          type: "string",
        },
        inputAdvice: { version: 1, recommendedMode: "flat" },
      };

      const textConflict = formatActionDetail(conflictPayload, { supportsTextField: false });
      assert.ok((textConflict).includes("Default text field: summary (note: ignored in standalone runtime"));
      assert.ok((textConflict).includes("Contract conflict:"));
      assert.ok((textConflict).includes("stdout: Raw string for scalars; extracts 'content', 'text', or 'message' from objects"));
    });
  });
});
