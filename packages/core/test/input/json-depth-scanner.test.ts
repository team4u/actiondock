import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { scanJsonDepth } from "../../src/input/json-depth-scanner";

describe("JSON 结构深度预检器 scanJsonDepth", () => {
  it("对标量基础类型不增加深度", () => {
    assert.deepStrictEqual(scanJsonDepth("123", 0), { valid: true });
    assert.deepStrictEqual(scanJsonDepth('"hello"', 0), { valid: true });
    assert.deepStrictEqual(scanJsonDepth("true", 0), { valid: true });
    assert.deepStrictEqual(scanJsonDepth("null", 0), { valid: true });
  });

  it("根容器深度为 0", () => {
    assert.deepStrictEqual(scanJsonDepth("{}", 0), { valid: true });
    assert.deepStrictEqual(scanJsonDepth("[]", 0), { valid: true });
    assert.deepStrictEqual(scanJsonDepth('{"a": 1, "b": "str"}', 0), { valid: true });
    assert.deepStrictEqual(scanJsonDepth("[1, 2, 3]", 0), { valid: true });
  });

  it("嵌套容器正确累加深度并在超出 maxDepth 时返回 MAX_JSON_DEPTH", () => {
    // 嵌套一层深度为 1
    assert.deepStrictEqual(scanJsonDepth('{"nested": {}}', 0), {
      valid: false,
      reason: "MAX_JSON_DEPTH",
    });
    assert.deepStrictEqual(scanJsonDepth('{"nested": {}}', 1), { valid: true });

    // 嵌套两层深度为 2
    assert.deepStrictEqual(scanJsonDepth('{"a": {"b": [1, 2]}}', 1), {
      valid: false,
      reason: "MAX_JSON_DEPTH",
    });
    assert.deepStrictEqual(scanJsonDepth('{"a": {"b": [1, 2]}}', 2), { valid: true });
  });

  it("字符串内部的括号与转义字符不影响容器深度计算", () => {
    const text = JSON.stringify({
      brackets: "{ [ } ]",
      escaped: 'He said: \\" { [ ] } \\"',
      deep: {
        nested: "foo { bar }",
      },
    });

    // 容器深度最大为 1
    assert.deepStrictEqual(scanJsonDepth(text, 1), { valid: true });
    assert.deepStrictEqual(scanJsonDepth(text, 0), {
      valid: false,
      reason: "MAX_JSON_DEPTH",
    });
  });

  it("支持默认 maxDepth (256) 边界测试", () => {
    let deepJson = "1";
    for (let i = 0; i < 256; i++) {
      deepJson = `[${deepJson}]`;
    }
    // 256 层嵌套：最外层 0, 最内层 255 -> valid: true
    assert.deepStrictEqual(scanJsonDepth(deepJson, 256), { valid: true });

    // 258 层嵌套 -> 超出 256
    let overDeep = "1";
    for (let i = 0; i < 258; i++) {
      overDeep = `{"inner":${overDeep}}`;
    }
    assert.deepStrictEqual(scanJsonDepth(overDeep, 256), {
      valid: false,
      reason: "MAX_JSON_DEPTH",
    });
  });
});
