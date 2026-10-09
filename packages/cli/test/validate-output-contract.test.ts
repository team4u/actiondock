import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCliAsync } from "./helpers/run-cli";

describe("CLI ad validate 输出契约静态合规性校验", () => {
  function createTestProject(actionsConfig: Record<string, any>, actionsFiles: Record<string, string>): string {
    const dir = mkdtempSync(join(tmpdir(), "ad-validate-contract-"));
    const manifest = {
      schemaVersion: 2,
      id: "test.validate-contract",
      name: "Test Validate Contract",
      version: "1.0.0",
      actions: actionsConfig,
    };
    writeFileSync(join(dir, "actiondock.json"), JSON.stringify(manifest, null, 2));

    const actionsDir = join(dir, "actions");
    mkdirSync(actionsDir, { recursive: true });

    for (const [filename, content] of Object.entries(actionsFiles)) {
      writeFileSync(join(actionsDir, filename), content);
    }
    return dir;
  }

  it("声明标准 required + string 正文字段的 Action 校验通过且无警告", async () => {
    const dir = createTestProject(
      {
        greet: {
          entry: "actions/greet.ts",
          description: "Greet action",
          outputSchema: {
            type: "object",
            properties: {
              content: { type: "string" },
            },
            required: ["content"],
          },
          annotations: {
            "actiondock.cli": {
              textField: "content",
            },
          },
        },
      },
      {
        "greet.ts": `
import { defineAction } from "@actiondock/sdk";
export default defineAction({
  run() {
    return { content: "hello" };
  },
});
`,
      }
    );

    try {
      const res = await runCliAsync(["validate", "--json"], dir);
      assert.strictEqual(res.exitCode, 0);
      const parsed = JSON.parse(res.stdout.toString());
      assert.strictEqual(parsed.valid, true);
      const greetResult = parsed.results.find((r: any) => r.id === "greet");
      assert.strictEqual(greetResult.valid, true);
      assert.strictEqual(greetResult.errors.length, 0);
      assert.strictEqual(greetResult.warnings, undefined);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("声明非法注解结构时校验失败并拦截", async () => {
    const dir = createTestProject(
      {
        "bad-anno": {
          entry: "actions/bad.ts",
          description: "Bad annotation action",
          annotations: {
            "actiondock.cli": "not-an-object",
          },
        },
      },
      {
        "bad.ts": `
export default {
  run() { return {}; }
};
`,
      }
    );

    try {
      const res = await runCliAsync(["validate", "--json"], dir);
      assert.strictEqual(res.exitCode, 1);
      const parsed = JSON.parse(res.stdout.toString());
      assert.strictEqual(parsed.valid, false);
      const item = parsed.results.find((r: any) => r.id === "bad-anno");
      assert.strictEqual(item.valid, false);
      assert.ok(item.errors.some((e: string) => e.includes("expected an object")));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("Schema 根类型非 object 或目标字段类型冲突时报告确定错误", async () => {
    const dir = createTestProject(
      {
        "root-non-object": {
          entry: "actions/root.ts",
          outputSchema: {
            type: "string",
          },
          annotations: {
            "actiondock.cli": { textField: "content" },
          },
        },
        "field-non-string": {
          entry: "actions/field.ts",
          outputSchema: {
            type: "object",
            properties: {
              count: { type: "number" },
            },
            required: ["count"],
          },
          annotations: {
            "actiondock.cli": { textField: "count" },
          },
        },
      },
      {
        "root.ts": `
export default { run() { return "text"; } };
`,
        "field.ts": `
export default { run() { return { count: 1 }; } };
`,
      }
    );

    try {
      const res = await runCliAsync(["validate", "--json"], dir);
      assert.strictEqual(res.exitCode, 1);
      const parsed = JSON.parse(res.stdout.toString());
      assert.strictEqual(parsed.valid, false);

      const rootItem = parsed.results.find((r: any) => r.id === "root-non-object");
      assert.strictEqual(rootItem.valid, false);
      assert.ok(rootItem.errors.some((e: string) => e.includes("which does not allow an object")));

      const fieldItem = parsed.results.find((r: any) => r.id === "field-non-string");
      assert.strictEqual(fieldItem.valid, false);
      assert.ok(fieldItem.errors.some((e: string) => e.includes("does not allow string")));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("目标字段未在 properties 且禁止额外属性时报告确定错误", async () => {
    const dir = createTestProject(
      {
        "disallowed-field": {
          entry: "actions/disallowed.ts",
          outputSchema: {
            type: "object",
            properties: {
              other: { type: "string" },
            },
            additionalProperties: false,
          },
          annotations: {
            "actiondock.cli": { textField: "missingField" },
          },
        },
      },
      {
        "disallowed.ts": `
export default { run() { return { other: "val" }; } };
`,
      }
    );

    try {
      const res = await runCliAsync(["validate", "--json"], dir);
      assert.strictEqual(res.exitCode, 1);
      const parsed = JSON.parse(res.stdout.toString());
      assert.strictEqual(parsed.valid, false);
      const item = parsed.results.find((r: any) => r.id === "disallowed-field");
      assert.strictEqual(item.valid, false);
      assert.ok(item.errors.some((e: string) => e.includes("additionalProperties is false")));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("目标字段未声明 required、允许可空或 Schema 复杂时输出清晰风险诊断但不阻断", async () => {
    const dir = createTestProject(
      {
        "not-required": {
          entry: "actions/not-req.ts",
          outputSchema: {
            type: "object",
            properties: {
              summary: { type: "string" },
            },
          },
          annotations: {
            "actiondock.cli": { textField: "summary" },
          },
        },
        "nullable": {
          entry: "actions/nullable.ts",
          outputSchema: {
            type: "object",
            properties: {
              text: { type: ["string", "null"] },
            },
            required: ["text"],
          },
          annotations: {
            "actiondock.cli": { textField: "text" },
          },
        },
      },
      {
        "not-req.ts": `
export default { run() { return { summary: "ok" }; } };
`,
        "nullable.ts": `
export default { run() { return { text: null }; } };
`,
      }
    );

    try {
      // 验证 JSON 模式
      const resJson = await runCliAsync(["validate", "--json"], dir);
      assert.strictEqual(resJson.exitCode, 0);
      const parsed = JSON.parse(resJson.stdout.toString());
      assert.strictEqual(parsed.valid, true);

      const notReqItem = parsed.results.find((r: any) => r.id === "not-required");
      assert.strictEqual(notReqItem.valid, true);
      assert.strictEqual(notReqItem.errors.length, 0);
      assert.ok(notReqItem.warnings.some((w: string) => w.includes("not marked as required")));

      const nullableItem = parsed.results.find((r: any) => r.id === "nullable");
      assert.strictEqual(nullableItem.valid, true);
      assert.strictEqual(nullableItem.errors.length, 0);
      assert.ok(nullableItem.warnings.some((w: string) => w.includes("allows non-string types (null)")));

      // 验证人类可读模式展示 warnings
      const resHuman = await runCliAsync(["validate"], dir);
      assert.strictEqual(resHuman.exitCode, 0);
      assert.ok(resHuman.stdout.toString().includes("[OK] not-required: Valid (warnings:"));
      assert.ok(resHuman.stdout.toString().includes("[OK] nullable: Valid (warnings:"));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("使用 patternProperties 且 additionalProperties: false 的合法 Schema 在 ad validate 中成功通过（附带警告）", async () => {
    const dir = createTestProject(
      {
        "pattern-action": {
          entry: "actions/pattern.ts",
          outputSchema: {
            type: "object",
            patternProperties: {
              "^summary$": { type: "string" },
            },
            additionalProperties: false,
            required: ["summary"],
          },
          annotations: {
            "actiondock.cli": { textField: "summary" },
          },
        },
      },
      {
        "pattern.ts": `
export default { run() { return { summary: "ok" }; } };
`,
      }
    );

    try {
      const res = await runCliAsync(["validate", "--json"], dir);
      assert.strictEqual(res.exitCode, 0);
      const parsed = JSON.parse(res.stdout.toString());
      assert.strictEqual(parsed.valid, true);

      const item = parsed.results.find((r: any) => r.id === "pattern-action");
      assert.strictEqual(item.valid, true);
      assert.strictEqual(item.errors.length, 0);
      assert.ok(item.warnings.some((w: string) => w.includes("governed by patternProperties")));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
