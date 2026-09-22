import { describe, expect, it } from "bun:test";
import { decodeUtf8Strict, stripBom } from "../../src/input/utf8";
import { InputError, INVALID_JSON } from "../../src/input/flat-errors";

describe("Strict UTF-8 与 BOM 工具套件", () => {
  describe("decodeUtf8Strict", () => {
    it("正确解码合法 UTF-8 字节序列", () => {
      const buf = Buffer.from("Hello 世界 🚀", "utf8");
      expect(decodeUtf8Strict(buf)).toBe("Hello 世界 🚀");
    });

    it("遇到非法 UTF-8 字节序列抛出 INVALID_JSON 异常且 reason 为 INVALID_UTF8", () => {
      // 0xFF 0xFF 为非法 UTF-8 字节
      const invalidBytes = Buffer.from([0xff, 0xff]);

      expect(() => decodeUtf8Strict(invalidBytes, "full-json-inline")).toThrow(
        InputError
      );

      try {
        decodeUtf8Strict(invalidBytes, "full-json-inline");
      } catch (err: any) {
        expect(err).toBeInstanceOf(InputError);
        expect(err.code).toBe(INVALID_JSON);
        expect(err.details?.reason).toBe("INVALID_UTF8");
        expect(err.details?.source).toBe("inline-json");
      }
    });

    it("支持不同输入源的错误来源标记映射", () => {
      const invalidBytes = Buffer.from([0x80, 0x81]);

      try {
        decodeUtf8Strict(invalidBytes, "full-json-file");
      } catch (err: any) {
        expect(err.details?.source).toBe("file");
      }

      try {
        decodeUtf8Strict(invalidBytes, "full-json-stdin");
      } catch (err: any) {
        expect(err.details?.source).toBe("stdin");
      }
    });
  });

  describe("stripBom", () => {
    it("仅剥离恰好一个开头的 BOM 标记", () => {
      expect(stripBom("\uFEFFhello")).toBe("hello");
      expect(stripBom("\uFEFF{\"a\":1}")).toBe("{\"a\":1}");
    });

    it("双重 BOM 仅剥离首个，第二个保留在文本中", () => {
      const doubleBom = "\uFEFF\uFEFF{\"a\":1}";
      const stripped = stripBom(doubleBom);
      expect(stripped).toBe("\uFEFF{\"a\":1}");
      expect(stripped.charCodeAt(0)).toBe(0xfeff);
    });

    it("普通无 BOM 文本及空字符串保持不变", () => {
      expect(stripBom("normal text")).toBe("normal text");
      expect(stripBom("")).toBe("");
    });
  });
});
