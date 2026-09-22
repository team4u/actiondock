import { describe, expect, it } from "bun:test";
import { scanJsonDepth } from "../../src/input/json-depth-scanner";

describe("JSON 结构深度预检器 scanJsonDepth", () => {
  it("对标量基础类型不增加深度", () => {
    expect(scanJsonDepth("123", 0)).toEqual({ valid: true });
    expect(scanJsonDepth('"hello"', 0)).toEqual({ valid: true });
    expect(scanJsonDepth("true", 0)).toEqual({ valid: true });
    expect(scanJsonDepth("null", 0)).toEqual({ valid: true });
  });

  it("根容器深度为 0", () => {
    expect(scanJsonDepth("{}", 0)).toEqual({ valid: true });
    expect(scanJsonDepth("[]", 0)).toEqual({ valid: true });
    expect(scanJsonDepth('{"a": 1, "b": "str"}', 0)).toEqual({ valid: true });
    expect(scanJsonDepth("[1, 2, 3]", 0)).toEqual({ valid: true });
  });

  it("嵌套容器正确累加深度并在超出 maxDepth 时返回 MAX_JSON_DEPTH", () => {
    // 嵌套一层深度为 1
    expect(scanJsonDepth('{"nested": {}}', 0)).toEqual({
      valid: false,
      reason: "MAX_JSON_DEPTH",
    });
    expect(scanJsonDepth('{"nested": {}}', 1)).toEqual({ valid: true });

    // 嵌套两层深度为 2
    expect(scanJsonDepth('{"a": {"b": [1, 2]}}', 1)).toEqual({
      valid: false,
      reason: "MAX_JSON_DEPTH",
    });
    expect(scanJsonDepth('{"a": {"b": [1, 2]}}', 2)).toEqual({ valid: true });
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
    expect(scanJsonDepth(text, 1)).toEqual({ valid: true });
    expect(scanJsonDepth(text, 0)).toEqual({
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
    expect(scanJsonDepth(deepJson, 256)).toEqual({ valid: true });

    // 258 层嵌套 -> 超出 256
    let overDeep = "1";
    for (let i = 0; i < 258; i++) {
      overDeep = `{"inner":${overDeep}}`;
    }
    expect(scanJsonDepth(overDeep, 256)).toEqual({
      valid: false,
      reason: "MAX_JSON_DEPTH",
    });
  });
});
