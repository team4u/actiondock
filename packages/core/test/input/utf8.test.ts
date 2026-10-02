import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { decodeUtf8Strict, stripBom } from "../../src/input/utf8";
import { InputError, INVALID_JSON } from "../../src/input/flat-errors";

describe("Strict UTF-8 与 BOM 工具套件", () => {
  describe("decodeUtf8Strict", () => {
    it("正确解码合法 UTF-8 字节序列", () => {
      const buf = Buffer.from("Hello 世界 🚀", "utf8");
      assert.strictEqual(decodeUtf8Strict(buf), "Hello 世界 🚀");
    });

    it("遇到非法 UTF-8 字节序列抛出 INVALID_JSON 异常且 reason 为 INVALID_UTF8", () => {
      // 0xFF 0xFF 为非法 UTF-8 字节
      const invalidBytes = Buffer.from([0xff, 0xff]);

      assert.throws(() => decodeUtf8Strict(invalidBytes, "full-json-inline"), 
        InputError
      );

      try {
        decodeUtf8Strict(invalidBytes, "full-json-inline");
        assert.fail("不应到达此分支");
      } catch (err: any) {
        assert.ok(err instanceof InputError);
        assert.strictEqual(err.code, INVALID_JSON);
        assert.strictEqual(err.details?.reason, "INVALID_UTF8");
        assert.strictEqual(err.details?.source, "inline-json");
      }
    });

    it("支持不同输入源的错误来源标记映射", () => {
      const invalidBytes = Buffer.from([0x80, 0x81]);

      try {
        decodeUtf8Strict(invalidBytes, "full-json-file");
        assert.fail("不应到达此分支");
      } catch (err: any) {
        assert.strictEqual(err.details?.source, "file");
      }

      try {
        decodeUtf8Strict(invalidBytes, "full-json-stdin");
        assert.fail("不应到达此分支");
      } catch (err: any) {
        assert.strictEqual(err.details?.source, "stdin");
      }
    });
  });

  describe("stripBom", () => {
    it("仅剥离恰好一个开头的 BOM 标记", () => {
      assert.strictEqual(stripBom("\uFEFFhello"), "hello");
      assert.strictEqual(stripBom("\uFEFF{\"a\":1}"), "{\"a\":1}");
    });

    it("双重 BOM 仅剥离首个，第二个保留在文本中", () => {
      const doubleBom = "\uFEFF\uFEFF{\"a\":1}";
      const stripped = stripBom(doubleBom);
      assert.strictEqual(stripped, "\uFEFF{\"a\":1}");
      assert.strictEqual(stripped.charCodeAt(0), 0xfeff);
    });

    it("普通无 BOM 文本及空字符串保持不变", () => {
      assert.strictEqual(stripBom("normal text"), "normal text");
      assert.strictEqual(stripBom(""), "");
    });
  });
});
