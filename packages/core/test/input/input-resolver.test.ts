import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { resolveActionInput, parseJson } from "../../src/input/input-resolver";
import {
  InputError,
  INPUT_CONFLICT,
  INPUT_FILE_NOT_FOUND,
  INPUT_FILE_READ_FAILED,
  INPUT_LIMIT_EXCEEDED,
  INPUT_PATH_CONFLICT,
  INVALID_FLAT_ARGUMENT,
  INVALID_JSON,
} from "../../src/input/flat-errors";
describe("输入模式仲裁与解析器 resolveActionInput", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "ad-test-input-resolver-"));

  describe("输入模式仲裁（Input Mode Arbitration）", () => {
    it("三者均未指定时返回默认空对象 {}", async () => {
      const res = await resolveActionInput({});
      assert.deepStrictEqual(res, {});
    });

    it("flatArgs 为空数组 [] 时视为未指定", async () => {
      const res = await resolveActionInput({ flatArgs: [] });
      assert.deepStrictEqual(res, {});
    });

    it("多于一种模式同时指定时抛出 INPUT_CONFLICT 且 reason 为 MULTIPLE_INPUT_MODES", async () => {
      // flatArgs + input
      try {
        await resolveActionInput({
          flatArgs: ["a=1"],
          input: '{"b":2}',
        });
        assert.fail("不应到达此分支");
      } catch (err: any) {
        assert.ok(err instanceof InputError);
        assert.strictEqual(err.code, INPUT_CONFLICT);
        assert.strictEqual((err.details as Record<string, unknown>)?.reason, "MULTIPLE_INPUT_MODES");
        assert.ok((err.message).includes("mutually exclusive"));
      }

      // flatArgs + inputFile
      try {
        await resolveActionInput({
          flatArgs: ["a=1"],
          inputFile: "some-file.json",
        });
        assert.fail("不应到达此分支");
      } catch (err: any) {
        assert.ok(err instanceof InputError);
        assert.strictEqual(err.code, INPUT_CONFLICT);
        assert.strictEqual((err.details as Record<string, unknown>)?.reason, "MULTIPLE_INPUT_MODES");
      }

      // input + inputFile
      try {
        await resolveActionInput({
          input: '{"a":1}',
          inputFile: "some-file.json",
        });
        assert.fail("不应到达此分支");
      } catch (err: any) {
        assert.ok(err instanceof InputError);
        assert.strictEqual(err.code, INPUT_CONFLICT);
        assert.strictEqual((err.details as Record<string, unknown>)?.reason, "MULTIPLE_INPUT_MODES");
      }
    });
  });

  describe("显式空 JSON 输入处理", () => {
    it("options.input === '' 为显式 Full JSON 模式，抛出 INVALID_JSON / SYNTAX_ERROR 且不退化为 {}", async () => {
      try {
        await resolveActionInput({ input: "" });
        assert.fail("不应到达此分支");
      } catch (err: any) {
        assert.ok(err instanceof InputError);
        assert.strictEqual(err.code, INVALID_JSON);
        assert.strictEqual((err.details as Record<string, unknown>)?.reason, "SYNTAX_ERROR");
      }
    });

    it("纯空白或纯 BOM 的 --input 抛出 INVALID_JSON / SYNTAX_ERROR", async () => {
      // 纯空白
      try {
        await resolveActionInput({ input: "   \n\t  " });
        assert.fail("不应到达此分支");
      } catch (err: any) {
        assert.ok(err instanceof InputError);
        assert.strictEqual(err.code, INVALID_JSON);
        assert.strictEqual((err.details as Record<string, unknown>)?.reason, "SYNTAX_ERROR");
      }

      // 纯 BOM
      try {
        await resolveActionInput({ input: "\uFEFF" });
        assert.fail("不应到达此分支");
      } catch (err: any) {
        assert.ok(err instanceof InputError);
        assert.strictEqual(err.code, INVALID_JSON);
        assert.strictEqual((err.details as Record<string, unknown>)?.reason, "SYNTAX_ERROR");
      }
    });

    it("0 字节文件抛出 INVALID_JSON / SYNTAX_ERROR", async () => {
      const emptyFilePath = join(tempDir, "zero-byte.json");
      writeFileSync(emptyFilePath, "", "utf8");

      try {
        await resolveActionInput({ inputFile: emptyFilePath });
        assert.fail("不应到达此分支");
      } catch (err: any) {
        assert.ok(err instanceof InputError);
        assert.strictEqual(err.code, INVALID_JSON);
        assert.strictEqual((err.details as Record<string, unknown>)?.reason, "SYNTAX_ERROR");
      }
    });

    it("空 stdin 抛出 INVALID_JSON / SYNTAX_ERROR", async () => {
      const emptyStream = Readable.from([]);

      try {
        await resolveActionInput({ inputFile: "-", stdin: emptyStream });
        assert.fail("不应到达此分支");
      } catch (err: any) {
        assert.ok(err instanceof InputError);
        assert.strictEqual(err.code, INVALID_JSON);
        assert.strictEqual((err.details as Record<string, unknown>)?.reason, "SYNTAX_ERROR");
      }
    });
  });

  describe("stdin 原始文本字段绑定（stdinField）", () => {
    it("将 stdin 完整正文原样绑定为指定字段，可与 flatArgs 组合", async () => {
      const res = await resolveActionInput({
        stdinField: "text",
        flatArgs: ["style=brief"],
        stdin: Readable.from(["这是一段正文"]),
      });
      assert.deepStrictEqual(res, { text: "这是一段正文", style: "brief" });
    });

    it("stdinField 单独使用时仅产生绑定字段", async () => {
      const res = await resolveActionInput({
        stdinField: "csv",
        stdin: Readable.from(["a,b\n1,2"]),
      });
      assert.deepStrictEqual(res, { csv: "a,b\n1,2" });
    });

    it("保留首尾空白、CRLF、引号、反斜杠、Unicode 与 BOM，不做类型猜测", async () => {
      const payload = Buffer.concat([
        Buffer.from("  {\"looks\": \"json\"}\n", "utf8"),
        Buffer.from("line2\r\n", "utf8"),
        Buffer.from([0xef, 0xbb, 0xbf]),
        Buffer.from("\\\"引号\"\\ 😀\t", "utf8"),
      ]);

      const res = await resolveActionInput({
        stdinField: "text",
        stdin: Readable.from([payload]),
      });
      assert.strictEqual((res as Record<string, unknown>).text, payload.toString("utf8"));
    });

    it("空 stdin 绑定为空字符串而不是报错", async () => {
      const res = await resolveActionInput({
        stdinField: "text",
        stdin: Readable.from([]),
      });
      assert.deepStrictEqual(res, { text: "" });
    });

    it("多 chunk 输入完整拼接", async () => {
      const res = await resolveActionInput({
        stdinField: "text",
        stdin: Readable.from([Buffer.from("part1-"), Buffer.from("part2")]),
      });
      assert.deepStrictEqual(res, { text: "part1-part2" });
    });

    it("与 inline JSON 或 inputFile（含 '-'）混用抛出 INPUT_CONFLICT / MULTIPLE_INPUT_MODES", async () => {
      try {
        await resolveActionInput({
          stdinField: "text",
          input: "{}",
          stdin: Readable.from(["x"]),
        });
        assert.fail("不应到达此分支");
      } catch (err: any) {
        assert.strictEqual(err.code, INPUT_CONFLICT);
        assert.strictEqual((err.details as Record<string, unknown>)?.reason, "MULTIPLE_INPUT_MODES");
        assert.strictEqual((err.details as Record<string, unknown>)?.hasStdinField, true);
      }

      try {
        await resolveActionInput({
          stdinField: "text",
          inputFile: "-",
          stdin: Readable.from(["x"]),
        });
        assert.fail("不应到达此分支");
      } catch (err: any) {
        assert.strictEqual(err.code, INPUT_CONFLICT);
        assert.strictEqual((err.details as Record<string, unknown>)?.reason, "MULTIPLE_INPUT_MODES");
      }
    });

    it("flat 重复赋值目标字段抛出 INPUT_PATH_CONFLICT / DUPLICATE_ASSIGNMENT", async () => {
      try {
        await resolveActionInput({
          stdinField: "text",
          flatArgs: ["text=abc"],
          stdin: Readable.from(["x"]),
        });
        assert.fail("不应到达此分支");
      } catch (err: any) {
        assert.strictEqual(err.code, INPUT_PATH_CONFLICT);
        assert.strictEqual((err.details as Record<string, unknown>)?.reason, "DUPLICATE_ASSIGNMENT");
      }

      try {
        await resolveActionInput({
          stdinField: "text",
          flatArgs: ["text:=[1,2]"],
          stdin: Readable.from(["x"]),
        });
        assert.fail("不应到达此分支");
      } catch (err: any) {
        assert.strictEqual(err.code, INPUT_PATH_CONFLICT);
        assert.strictEqual((err.details as Record<string, unknown>)?.reason, "DUPLICATE_ASSIGNMENT");
      }
    });

    it("flat 嵌套赋值目标字段子路径抛出 INPUT_PATH_CONFLICT / LEAF_CONTAINER_CONFLICT", async () => {
      try {
        await resolveActionInput({
          stdinField: "text",
          flatArgs: ["text.child=abc"],
          stdin: Readable.from(["x"]),
        });
        assert.fail("不应到达此分支");
      } catch (err: any) {
        assert.strictEqual(err.code, INPUT_PATH_CONFLICT);
        assert.strictEqual((err.details as Record<string, unknown>)?.reason, "LEAF_CONTAINER_CONFLICT");
      }
    });

    it("冲突检测先于 stdin 读取：冲突时挂起的 stdin 不被消费", async () => {
      let dataObserved = false;
      const stream = new Readable({
        read() {
          dataObserved = true;
          this.push("data");
          this.push(null);
        },
      });

      try {
        await resolveActionInput({
          stdinField: "text",
          flatArgs: ["text=abc"],
          stdin: stream,
        });
        assert.fail("不应到达此分支");
      } catch (err: any) {
        assert.strictEqual(err.code, INPUT_PATH_CONFLICT);
        assert.strictEqual(dataObserved, false, "stdin 不应在冲突检测阶段被消费");
      }
    });

    it("非目标字段的已知 flat 错误先于 stdin 读取拒绝，不等待上游 EOF", async () => {
      const cases: string[][] = [
        ["a=1", "a=2"],
        ["mode:=not-json"],
        [".bad=x"],
      ];

      for (const flatArgs of cases) {
        let dataObserved = false;
        // 流永远不结束：若解码发生在读取后，此用例将挂起至文件级超时
        const neverEnding = new Readable({
          read() {
            if (!dataObserved) {
              dataObserved = true;
              this.push("chunk");
            }
          },
        });

        await assert.rejects(
          resolveActionInput({
            stdinField: "text",
            flatArgs,
            stdin: neverEnding,
          }),
          (err: any) => {
            assert.ok(
              ["INPUT_PATH_CONFLICT", "INVALID_JSON_LITERAL", "INVALID_FLAT_ARGUMENT"].includes(err.code),
              `意外错误码: ${err.code}`
            );
            assert.strictEqual(dataObserved, false, "stdin 不应在已知 flat 错误拒绝前被消费");
            return true;
          }
        );
      }
    });

    it("flat 与 stdin 各自未超限但合并后超出实体化上限时拒绝（MAX_MATERIALIZED_BYTES）", async () => {
      try {
        await resolveActionInput({
          stdinField: "text",
          flatArgs: ["mode=brief"],
          stdin: Readable.from(["x".repeat(20)]),
          flatOptions: { maxMaterializedSizeBytes: 32 },
          policy: { maxInputBytes: 32 },
        });
        assert.fail("不应到达此分支");
      } catch (err: any) {
        assert.strictEqual(err.code, "FLAT_INPUT_LIMIT_EXCEEDED");
        assert.strictEqual((err.details as Record<string, unknown>)?.reason, "MAX_MATERIALIZED_BYTES");
        assert.strictEqual((err.details as Record<string, unknown>)?.byteLength, 46);
      }
    });

    it("stdin-only 最终入参超出实体化上限时拒绝，空输入边界恰好通过", async () => {
      // stdin-only：正文 20 字节 + 包装后序列化为 31 字节，超出 24 字节上限
      try {
        await resolveActionInput({
          stdinField: "text",
          stdin: Readable.from(["x".repeat(20)]),
          flatOptions: { maxMaterializedSizeBytes: 24 },
          policy: { maxInputBytes: 64 },
        });
        assert.fail("不应到达此分支");
      } catch (err: any) {
        assert.strictEqual(err.code, "FLAT_INPUT_LIMIT_EXCEEDED");
        assert.strictEqual((err.details as Record<string, unknown>)?.reason, "MAX_MATERIALIZED_BYTES");
        assert.strictEqual((err.details as Record<string, unknown>)?.byteLength, 31);
      }

      // 边界恰好通过：序列化 31 字节，上限设为 31
      const ok = await resolveActionInput({
        stdinField: "text",
        stdin: Readable.from(["x".repeat(20)]),
        flatOptions: { maxMaterializedSizeBytes: 31 },
        policy: { maxInputBytes: 64 },
      });
      assert.deepStrictEqual(ok, { text: "x".repeat(20) });
    });

    it("正文转义放大（引号与反斜杠）计入最终实体化大小", async () => {
      // 原始字节 24，JSON 序列化后每字符转义放大为 48 + 包装 11 = 59 字节
      const payload = '"'.repeat(12) + "\\".repeat(12);
      try {
        await resolveActionInput({
          stdinField: "text",
          stdin: Readable.from([payload]),
          flatOptions: { maxMaterializedSizeBytes: 40 },
          policy: { maxInputBytes: 64 },
        });
        assert.fail("不应到达此分支");
      } catch (err: any) {
        assert.strictEqual(err.code, "FLAT_INPUT_LIMIT_EXCEEDED");
        assert.strictEqual((err.details as Record<string, unknown>)?.reason, "MAX_MATERIALIZED_BYTES");
        assert.strictEqual((err.details as Record<string, unknown>)?.byteLength, 59);
      }

      // 上限放宽到 59 恰好通过，且正文逐字保留
      const ok = await resolveActionInput({
        stdinField: "text",
        stdin: Readable.from([payload]),
        flatOptions: { maxMaterializedSizeBytes: 59 },
        policy: { maxInputBytes: 64 },
      });
      assert.strictEqual((ok as Record<string, unknown>).text, payload);
    });

    it("stdin 源字节超限仍由 MAX_INPUT_BYTES 独立拦截（与实体化上限各自生效）", async () => {
      try {
        await resolveActionInput({
          stdinField: "text",
          stdin: Readable.from([Buffer.alloc(100)]),
          policy: { maxInputBytes: 10 },
        });
        assert.fail("不应到达此分支");
      } catch (err: any) {
        assert.strictEqual(err.code, INPUT_LIMIT_EXCEEDED);
        assert.strictEqual((err.details as Record<string, unknown>)?.reason, "MAX_INPUT_BYTES");
      }
    });

    it("非法字段名（空、纯空白、点分、危险属性、非法字符）抛出 INVALID_FLAT_ARGUMENT", async () => {
      const cases: Array<[string, string]> = [
        ["", "INVALID_SEGMENT"],
        ["   ", "INVALID_SEGMENT"],
        [" lead", "INVALID_SEGMENT"],
        ["trail ", "INVALID_SEGMENT"],
        ["user.name", "INVALID_DOT_NOTATION"],
        ["__proto__", "FORBIDDEN_PROPERTY"],
        ["constructor", "FORBIDDEN_PROPERTY"],
        ["prototype", "FORBIDDEN_PROPERTY"],
        ["123abc", "INVALID_SEGMENT"],
      ];

      for (const [field, reason] of cases) {
        try {
          await resolveActionInput({
            stdinField: field,
            stdin: Readable.from(["x"]),
          });
          assert.fail(`字段名 '${field}' 应被拒绝`);
        } catch (err: any) {
          assert.strictEqual(err.code, INVALID_FLAT_ARGUMENT, `字段名 '${field}'`);
          assert.strictEqual(
            (err.details as Record<string, unknown>)?.reason,
            reason,
            `字段名 '${field}'`
          );
        }
      }
    });

    it("超出 maxInputBytes 抛出 INPUT_LIMIT_EXCEEDED / MAX_INPUT_BYTES", async () => {
      try {
        await resolveActionInput({
          stdinField: "text",
          stdin: Readable.from([Buffer.alloc(100)]),
          policy: { maxInputBytes: 10 },
        });
        assert.fail("不应到达此分支");
      } catch (err: any) {
        assert.strictEqual(err.code, INPUT_LIMIT_EXCEEDED);
        assert.strictEqual((err.details as Record<string, unknown>)?.reason, "MAX_INPUT_BYTES");
      }
    });

    it("非法 UTF-8 字节抛出 INPUT_FILE_READ_FAILED / INVALID_UTF8，而非 INVALID_JSON", async () => {
      try {
        await resolveActionInput({
          stdinField: "text",
          stdin: Readable.from([Buffer.from([0xff, 0xfe, 0x28])]),
        });
        assert.fail("不应到达此分支");
      } catch (err: any) {
        assert.ok(err instanceof InputError);
        assert.strictEqual(err.code, INPUT_FILE_READ_FAILED);
        assert.strictEqual((err.details as Record<string, unknown>)?.reason, "INVALID_UTF8");
        assert.strictEqual((err.details as Record<string, unknown>)?.source, "stdin");
      }
    });

    it("AbortSignal 已中止时读取被取消", async () => {
      const controller = new AbortController();
      controller.abort(new Error("manual-abort"));

      await assert.rejects(
        resolveActionInput({
          stdinField: "text",
          stdin: Readable.from(["x"]),
          signal: controller.signal,
        }),
        /manual\-abort/
      );
    });

    it("配合 sanitizeInputErrors 时错误脱敏不回显正文与字段名", async () => {
      try {
        await resolveActionInput({
          stdinField: "secret_field",
          input: "{}",
          stdin: Readable.from(["x"]),
          policy: { sanitizeInputErrors: true },
        });
        assert.fail("不应到达此分支");
      } catch (err: any) {
        assert.strictEqual(err.code, INPUT_CONFLICT);
        assert.deepStrictEqual(err.details, { reason: "MULTIPLE_INPUT_MODES" });
        assert.ok(!JSON.stringify(err).includes("secret_field"));
      }

      try {
        await resolveActionInput({
          stdinField: "text",
          stdin: Readable.from([Buffer.from([0xff])]),
          policy: { sanitizeInputErrors: true },
        });
        assert.fail("不应到达此分支");
      } catch (err: any) {
        assert.strictEqual(err.code, INPUT_FILE_READ_FAILED);
        assert.strictEqual(err.message, "Failed to read input from stdin");
      }
    });

    it("无任何输入指定时仍返回默认空对象 {}（旧行为兼容）", async () => {
      const res = await resolveActionInput({});
      assert.deepStrictEqual(res, {});
    });
  });

  describe("错误脱敏与隐私保护 sanitizeInputErrors", () => {
    it("INPUT_FILE_NOT_FOUND 脱敏输出", async () => {
      const missingPath = join(tempDir, "secret/path/to/missing.json");

      try {
        await resolveActionInput({
          inputFile: missingPath,
          policy: { sanitizeInputErrors: true },
        });
        assert.fail("不应到达此分支");
      } catch (err: any) {
        assert.ok(err instanceof InputError);
        assert.strictEqual(err.code, INPUT_FILE_NOT_FOUND);
        assert.strictEqual(err.message, "Input file not found");
        assert.deepStrictEqual(err.details, { source: "file" });
        // 严禁包含绝对路径
        assert.ok(!(JSON.stringify(err)).includes("secret"));
      }
    });

    it("INPUT_CONFLICT 脱敏输出", async () => {
      try {
        await resolveActionInput({
          flatArgs: ["sensitive_key=secret_val"],
          input: '{"key":"secret"}',
          policy: { sanitizeInputErrors: true },
        });
        assert.fail("不应到达此分支");
      } catch (err: any) {
        assert.ok(err instanceof InputError);
        assert.strictEqual(err.code, INPUT_CONFLICT);
        assert.deepStrictEqual(err.details, { reason: "MULTIPLE_INPUT_MODES" });
        // 严禁包含原始入参
        assert.ok(!(JSON.stringify(err)).includes("secret_val"));
      }
    });

    it("INVALID_JSON 脱敏输出不回显原始 JSON 内容与路径", async () => {
      try {
        await resolveActionInput({
          input: '{"password":"very-secret-password-123", syntax_error',
          policy: { sanitizeInputErrors: true },
        });
        assert.fail("不应到达此分支");
      } catch (err: any) {
        assert.ok(err instanceof InputError);
        assert.strictEqual(err.code, INVALID_JSON);
        assert.strictEqual(err.message, "Invalid JSON syntax");
        assert.deepStrictEqual(err.details, {
          source: "inline-json",
          reason: "SYNTAX_ERROR",
        });
        // 严禁包含敏感内容
        assert.ok(!(JSON.stringify(err)).includes("very-secret-password-123"));
      }
    });

    it("INPUT_LIMIT_EXCEEDED 脱敏输出包含稳定 source 与 reason", async () => {
      try {
        await resolveActionInput({
          input: '{"data":"large"}',
          policy: {
            maxInputBytes: 5,
            sanitizeInputErrors: true,
          },
        });
        assert.fail("不应到达此分支");
      } catch (err: any) {
        assert.ok(err instanceof InputError);
        assert.strictEqual(err.code, INPUT_LIMIT_EXCEEDED);
        assert.strictEqual(err.message, "Input limit exceeded");
        assert.deepStrictEqual(err.details, {
          source: "inline-json",
          reason: "MAX_INPUT_BYTES",
        });
      }
    });
  });
});
