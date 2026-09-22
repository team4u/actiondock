import { describe, expect, it } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { resolveActionInput, parseJson } from "../../src/input/input-resolver";
import {
  InputError,
  INPUT_CONFLICT,
  INPUT_FILE_NOT_FOUND,
  INVALID_JSON,
  INPUT_LIMIT_EXCEEDED,
} from "../../src/input/flat-errors";

describe("输入模式仲裁与解析器 resolveActionInput", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "ad-test-input-resolver-"));

  describe("输入模式仲裁（Input Mode Arbitration）", () => {
    it("三者均未指定时返回默认空对象 {}", async () => {
      const res = await resolveActionInput({});
      expect(res).toEqual({});
    });

    it("flatArgs 为空数组 [] 时视为未指定", async () => {
      const res = await resolveActionInput({ flatArgs: [] });
      expect(res).toEqual({});
    });

    it("多于一种模式同时指定时抛出 INPUT_CONFLICT 且 reason 为 MULTIPLE_INPUT_MODES", async () => {
      // flatArgs + input
      try {
        await resolveActionInput({
          flatArgs: ["a=1"],
          input: '{"b":2}',
        });
        expect(true).toBe(false);
      } catch (err: any) {
        expect(err).toBeInstanceOf(InputError);
        expect(err.code).toBe(INPUT_CONFLICT);
        expect(err.details?.reason).toBe("MULTIPLE_INPUT_MODES");
        expect(err.message).toContain("mutually exclusive");
      }

      // flatArgs + inputFile
      try {
        await resolveActionInput({
          flatArgs: ["a=1"],
          inputFile: "some-file.json",
        });
        expect(true).toBe(false);
      } catch (err: any) {
        expect(err).toBeInstanceOf(InputError);
        expect(err.code).toBe(INPUT_CONFLICT);
        expect(err.details?.reason).toBe("MULTIPLE_INPUT_MODES");
      }

      // input + inputFile
      try {
        await resolveActionInput({
          input: '{"a":1}',
          inputFile: "some-file.json",
        });
        expect(true).toBe(false);
      } catch (err: any) {
        expect(err).toBeInstanceOf(InputError);
        expect(err.code).toBe(INPUT_CONFLICT);
        expect(err.details?.reason).toBe("MULTIPLE_INPUT_MODES");
      }
    });
  });

  describe("显式空 JSON 输入处理", () => {
    it("options.input === '' 为显式 Full JSON 模式，抛出 INVALID_JSON / SYNTAX_ERROR 且不退化为 {}", async () => {
      try {
        await resolveActionInput({ input: "" });
        expect(true).toBe(false);
      } catch (err: any) {
        expect(err).toBeInstanceOf(InputError);
        expect(err.code).toBe(INVALID_JSON);
        expect(err.details?.reason).toBe("SYNTAX_ERROR");
      }
    });

    it("纯空白或纯 BOM 的 --input 抛出 INVALID_JSON / SYNTAX_ERROR", async () => {
      // 纯空白
      try {
        await resolveActionInput({ input: "   \n\t  " });
        expect(true).toBe(false);
      } catch (err: any) {
        expect(err).toBeInstanceOf(InputError);
        expect(err.code).toBe(INVALID_JSON);
        expect(err.details?.reason).toBe("SYNTAX_ERROR");
      }

      // 纯 BOM
      try {
        await resolveActionInput({ input: "\uFEFF" });
        expect(true).toBe(false);
      } catch (err: any) {
        expect(err).toBeInstanceOf(InputError);
        expect(err.code).toBe(INVALID_JSON);
        expect(err.details?.reason).toBe("SYNTAX_ERROR");
      }
    });

    it("0 字节文件抛出 INVALID_JSON / SYNTAX_ERROR", async () => {
      const emptyFilePath = join(tempDir, "zero-byte.json");
      writeFileSync(emptyFilePath, "", "utf8");

      try {
        await resolveActionInput({ inputFile: emptyFilePath });
        expect(true).toBe(false);
      } catch (err: any) {
        expect(err).toBeInstanceOf(InputError);
        expect(err.code).toBe(INVALID_JSON);
        expect(err.details?.reason).toBe("SYNTAX_ERROR");
      }
    });

    it("空 stdin 抛出 INVALID_JSON / SYNTAX_ERROR", async () => {
      const emptyStream = Readable.from([]);

      try {
        await resolveActionInput({ inputFile: "-", stdin: emptyStream });
        expect(true).toBe(false);
      } catch (err: any) {
        expect(err).toBeInstanceOf(InputError);
        expect(err.code).toBe(INVALID_JSON);
        expect(err.details?.reason).toBe("SYNTAX_ERROR");
      }
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
        expect(true).toBe(false);
      } catch (err: any) {
        expect(err).toBeInstanceOf(InputError);
        expect(err.code).toBe(INPUT_FILE_NOT_FOUND);
        expect(err.message).toBe("Input file not found");
        expect(err.details).toEqual({ source: "file" });
        // 严禁包含绝对路径
        expect(JSON.stringify(err)).not.toContain("secret");
      }
    });

    it("INPUT_CONFLICT 脱敏输出", async () => {
      try {
        await resolveActionInput({
          flatArgs: ["sensitive_key=secret_val"],
          input: '{"key":"secret"}',
          policy: { sanitizeInputErrors: true },
        });
        expect(true).toBe(false);
      } catch (err: any) {
        expect(err).toBeInstanceOf(InputError);
        expect(err.code).toBe(INPUT_CONFLICT);
        expect(err.details).toEqual({ reason: "MULTIPLE_INPUT_MODES" });
        // 严禁包含原始入参
        expect(JSON.stringify(err)).not.toContain("secret_val");
      }
    });

    it("INVALID_JSON 脱敏输出不回显原始 JSON 内容与路径", async () => {
      try {
        await resolveActionInput({
          input: '{"password":"very-secret-password-123", syntax_error',
          policy: { sanitizeInputErrors: true },
        });
        expect(true).toBe(false);
      } catch (err: any) {
        expect(err).toBeInstanceOf(InputError);
        expect(err.code).toBe(INVALID_JSON);
        expect(err.message).toBe("Invalid JSON syntax");
        expect(err.details).toEqual({
          source: "inline-json",
          reason: "SYNTAX_ERROR",
        });
        // 严禁包含敏感内容
        expect(JSON.stringify(err)).not.toContain("very-secret-password-123");
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
        expect(true).toBe(false);
      } catch (err: any) {
        expect(err).toBeInstanceOf(InputError);
        expect(err.code).toBe(INPUT_LIMIT_EXCEEDED);
        expect(err.message).toBe("Input limit exceeded");
        expect(err.details).toEqual({
          source: "inline-json",
          reason: "MAX_INPUT_BYTES",
        });
      }
    });
  });
});
