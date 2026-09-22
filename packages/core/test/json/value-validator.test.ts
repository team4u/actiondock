import { describe, expect, it } from "bun:test";
import {
  validateJsonValue,
  assertJsonValue,
  DEFAULT_MAX_JSON_DEPTH,
} from "../../src/json";

describe("Iterative JsonValue Validator", () => {
  it("递归栈深度超限防护：支持 20,000 层深层嵌套对象不栈溢出", () => {
    let root: any = { value: "deep_leaf" };
    for (let i = 0; i < 20_000; i++) {
      root = { next: root };
    }

    const res = validateJsonValue(root);
    expect(res.valid).toBe(true);
  });

  it("递归栈深度超限防护：支持 20,000 层深层嵌套数组不栈溢出", () => {
    let arr: any = ["leaf_element"];
    for (let i = 0; i < 20_000; i++) {
      arr = [arr];
    }

    const res = validateJsonValue(arr);
    expect(res.valid).toBe(true);
  });

  it("支持自定义最大深度限制并拦截超限结构", () => {
    let nested: any = 1;
    for (let i = 0; i < 100; i++) {
      nested = { inner: nested };
    }

    const resValid = validateJsonValue(nested, { maxDepth: 150 });
    expect(resValid.valid).toBe(true);

    const resExceeded = validateJsonValue(nested, { maxDepth: 50 });
    expect(resExceeded.valid).toBe(false);
    if (!resExceeded.valid) {
      expect(resExceeded.reason).toContain("Max JSON depth limit (50) exceeded");
    }
  });

  it("严格拦截对象结构中的循环引用", () => {
    const cycleObj: any = { a: 1 };
    cycleObj.self = cycleObj;

    const res = validateJsonValue(cycleObj);
    expect(res.valid).toBe(false);
    if (!res.valid) {
      expect(res.reason).toBe("Circular reference detected in object structure");
    }
  });

  it("严格拦截数组结构中的循环引用", () => {
    const cycleArr: any = [1, 2];
    cycleArr.push(cycleArr);

    const res = validateJsonValue(cycleArr);
    expect(res.valid).toBe(false);
    if (!res.valid) {
      expect(res.reason).toBe("Circular reference detected in object structure");
    }
  });

  it("正确放行有向无环图（DAG）的共享引用对象", () => {
    const sharedChild = { id: "shared-child", count: 42 };
    const dagRoot = {
      branchA: { child: sharedChild },
      branchB: { child: sharedChild },
      branchC: [sharedChild, sharedChild],
    };

    const res = validateJsonValue(dagRoot);
    expect(res.valid).toBe(true);
  });

  it("拦截所有非有限数值（NaN, Infinity, -Infinity）", () => {
    expect(validateJsonValue(NaN).valid).toBe(false);
    expect(validateJsonValue(Infinity).valid).toBe(false);
    expect(validateJsonValue(-Infinity).valid).toBe(false);

    expect(validateJsonValue({ val: NaN }).valid).toBe(false);
    expect(validateJsonValue([1, 2, Infinity]).valid).toBe(false);
    expect(validateJsonValue({ nested: { num: -Infinity } }).valid).toBe(false);
  });

  it("拦截非法 JSON 类型（undefined, function, symbol, bigint）", () => {
    expect(validateJsonValue(undefined).valid).toBe(false);
    expect(validateJsonValue(() => {}).valid).toBe(false);
    expect(validateJsonValue(Symbol("foo")).valid).toBe(false);
    expect(validateJsonValue(BigInt(123)).valid).toBe(false);

    expect(validateJsonValue({ fn: () => {} }).valid).toBe(false);
    expect(validateJsonValue([Symbol("bar")]).valid).toBe(false);
  });

  it("放行所有基础 JSON 类型（null, boolean, string, finite number）", () => {
    expect(validateJsonValue(null).valid).toBe(true);
    expect(validateJsonValue(true).valid).toBe(true);
    expect(validateJsonValue(false).valid).toBe(true);
    expect(validateJsonValue("hello").valid).toBe(true);
    expect(validateJsonValue(0).valid).toBe(true);
    expect(validateJsonValue(-123.45).valid).toBe(true);
    expect(validateJsonValue({}).valid).toBe(true);
    expect(validateJsonValue([]).valid).toBe(true);
  });

  it("assertJsonValue 断言函数：合法值顺利通过，非法值抛出 TypeError", () => {
    expect(() => assertJsonValue({ a: 1, b: "ok" })).not.toThrow();

    expect(() => assertJsonValue(NaN)).toThrow(TypeError);
    expect(() => assertJsonValue({ bad: Infinity })).toThrow(TypeError);
    expect(() => {
      const cycle: any = {};
      cycle.c = cycle;
      assertJsonValue(cycle);
    }).toThrow(TypeError);
  });
});
