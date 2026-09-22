import { describe, expect, it } from "bun:test";
import {
  validateJsonValue,
  validateActionInputValue,
  assertJsonValue,
  escapeJsonPointerSegment,
  appendJsonPointer,
  DEFAULT_MAX_JSON_DEPTH,
} from "../../src/json";

describe("Iterative Strict JsonValue Validator", () => {
  describe("RFC 6901 JSON Pointer 转义与拼接", () => {
    it("正确转义 ~ 与 / 字符", () => {
      expect(escapeJsonPointerSegment("foo")).toBe("foo");
      expect(escapeJsonPointerSegment("foo/bar")).toBe("foo~1bar");
      expect(escapeJsonPointerSegment("foo~bar")).toBe("foo~0bar");
      expect(escapeJsonPointerSegment("~/~0/~1")).toBe("~0~1~00~1~01");
      expect(escapeJsonPointerSegment(0)).toBe("0");
    });

    it("正确追加路径段", () => {
      expect(appendJsonPointer("", "user")).toBe("/user");
      expect(appendJsonPointer("/user", "name")).toBe("/user/name");
      expect(appendJsonPointer("/items", 0)).toBe("/items/0");
      expect(appendJsonPointer("/items/0", "a/b")).toBe("/items/0/a~1b");
    });
  });

  describe("递归深度限制与深层嵌套", () => {
    it("支持 20,000 层深层嵌套对象不栈溢出", () => {
      let root: any = { value: "deep_leaf" };
      for (let i = 0; i < 20_000; i++) {
        root = { next: root };
      }

      const res = validateJsonValue(root, { maxDepth: 25_000 });
      expect(res.valid).toBe(true);
    });

    it("支持 20,000 层深层嵌套数组不栈溢出", () => {
      let arr: any = ["leaf_element"];
      for (let i = 0; i < 20_000; i++) {
        arr = [arr];
      }

      const res = validateJsonValue(arr, { maxDepth: 25_000 });
      expect(res.valid).toBe(true);
    });

    it("默认最大深度限制 256：深度 256 通过，深度 257 拦截", () => {
      expect(DEFAULT_MAX_JSON_DEPTH).toBe(256);

      let obj256: any = {};
      for (let i = 0; i < 256; i++) {
        obj256 = { inner: obj256 };
      }
      const res256 = validateJsonValue(obj256);
      expect(res256.valid).toBe(true);

      let obj257: any = {};
      for (let i = 0; i < 257; i++) {
        obj257 = { inner: obj257 };
      }
      const res257 = validateJsonValue(obj257);
      expect(res257.valid).toBe(false);
      if (!res257.valid) {
        expect(res257.code).toBe("MAX_JSON_DEPTH");
        expect(res257.reason).toContain("Max JSON depth limit (256) exceeded");
      }
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
        expect(resExceeded.code).toBe("MAX_JSON_DEPTH");
        expect(resExceeded.reason).toContain("Max JSON depth limit (50) exceeded");
      }
    });
  });

  describe("循环引用与共享 DAG 结构", () => {
    it("严格拦截对象直接循环引用", () => {
      const cycleObj: any = { a: 1 };
      cycleObj.self = cycleObj;

      const res = validateJsonValue(cycleObj);
      expect(res.valid).toBe(false);
      if (!res.valid) {
        expect(res.code).toBe("CIRCULAR_REFERENCE");
        expect(res.reason).toBe("Circular reference detected in object structure");
      }
    });

    it("严格拦截数组循环引用", () => {
      const cycleArr: any = [1, 2];
      cycleArr.push(cycleArr);

      const res = validateJsonValue(cycleArr);
      expect(res.valid).toBe(false);
      if (!res.valid) {
        expect(res.code).toBe("CIRCULAR_REFERENCE");
        expect(res.reason).toBe("Circular reference detected in object structure");
      }
    });

    it("严格拦截间接跨层级循环引用", () => {
      const a: any = { b: {} };
      const b: any = { c: {} };
      a.b = b;
      b.c = a;

      const res = validateJsonValue(a);
      expect(res.valid).toBe(false);
      if (!res.valid) {
        expect(res.code).toBe("CIRCULAR_REFERENCE");
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
  });

  describe("基础类型与非法原始类型校验", () => {
    it("放行所有基础合法 JSON 类型（null, boolean, string, finite number）", () => {
      expect(validateJsonValue(null).valid).toBe(true);
      expect(validateJsonValue(true).valid).toBe(true);
      expect(validateJsonValue(false).valid).toBe(true);
      expect(validateJsonValue("hello").valid).toBe(true);
      expect(validateJsonValue(0).valid).toBe(true);
      expect(validateJsonValue(-123.45).valid).toBe(true);
      expect(validateJsonValue({}).valid).toBe(true);
      expect(validateJsonValue([]).valid).toBe(true);
    });

    it("拦截所有非有限数值（NaN, Infinity, -Infinity）", () => {
      const r1 = validateJsonValue(NaN);
      expect(r1.valid).toBe(false);
      if (!r1.valid) expect(r1.code).toBe("NON_FINITE_NUMBER");

      const r2 = validateJsonValue(Infinity);
      expect(r2.valid).toBe(false);
      if (!r2.valid) expect(r2.code).toBe("NON_FINITE_NUMBER");

      const r3 = validateJsonValue(-Infinity);
      expect(r3.valid).toBe(false);
      if (!r3.valid) expect(r3.code).toBe("NON_FINITE_NUMBER");

      const r4 = validateJsonValue({ val: NaN });
      expect(r4.valid).toBe(false);
      if (!r4.valid) {
        expect(r4.code).toBe("NON_FINITE_NUMBER");
        expect(r4.path).toBe("/val");
      }

      const r5 = validateJsonValue([1, 2, Infinity]);
      expect(r5.valid).toBe(false);
      if (!r5.valid) {
        expect(r5.code).toBe("NON_FINITE_NUMBER");
        expect(r5.path).toBe("/2");
      }
    });

    it("拦截非法 JSON 类型（undefined, function, symbol, bigint）", () => {
      const rUndef = validateJsonValue(undefined);
      expect(rUndef.valid).toBe(false);
      if (!rUndef.valid) expect(rUndef.code).toBe("UNDEFINED_JSON_VALUE");

      const rFn = validateJsonValue(() => {});
      expect(rFn.valid).toBe(false);
      if (!rFn.valid) expect(rFn.code).toBe("UNSUPPORTED_JSON_TYPE");

      const rSym = validateJsonValue(Symbol("foo"));
      expect(rSym.valid).toBe(false);
      if (!rSym.valid) expect(rSym.code).toBe("UNSUPPORTED_JSON_TYPE");

      const rBig = validateJsonValue(BigInt(123));
      expect(rBig.valid).toBe(false);
      if (!rBig.valid) expect(rBig.code).toBe("UNSUPPORTED_JSON_TYPE");

      const rObjFn = validateJsonValue({ fn: () => {} });
      expect(rObjFn.valid).toBe(false);
      if (!rObjFn.valid) {
        expect(rObjFn.code).toBe("UNSUPPORTED_JSON_TYPE");
        expect(rObjFn.path).toBe("/fn");
      }

      const rArrSym = validateJsonValue([Symbol("bar")]);
      expect(rArrSym.valid).toBe(false);
      if (!rArrSym.valid) {
        expect(rArrSym.code).toBe("UNSUPPORTED_JSON_TYPE");
        expect(rArrSym.path).toBe("/0");
      }
    });
  });

  describe("严格对象（Object）规范校验", () => {
    it("放行 Object.prototype 与 Object.create(null) 原型对象", () => {
      expect(validateJsonValue({ a: 1 }).valid).toBe(true);

      const nullProtoObj = Object.create(null);
      nullProtoObj.key = "value";
      expect(validateJsonValue(nullProtoObj).valid).toBe(true);
    });

    it("拒绝非普通对象原型（Date, Map, Set, RegExp, Promise, Error 等）", () => {
      expect(validateJsonValue(new Date()).valid).toBe(false);
      expect(validateJsonValue(new Map()).valid).toBe(false);
      expect(validateJsonValue(new Set()).valid).toBe(false);
      expect(validateJsonValue(/abc/).valid).toBe(false);
      expect(validateJsonValue(Promise.resolve(1)).valid).toBe(false);
      expect(validateJsonValue(new Error("err")).valid).toBe(false);
      expect(validateJsonValue(new Uint8Array(8)).valid).toBe(false);
      expect(validateJsonValue(Buffer.from("abc")).valid).toBe(false);

      class CustomClass {
        name = "custom";
      }
      expect(validateJsonValue(new CustomClass()).valid).toBe(false);

      const nestedDate = { time: new Date() };
      const res = validateJsonValue(nestedDate);
      expect(res.valid).toBe(false);
      if (!res.valid) {
        expect(res.code).toBe("INVALID_JSON_OBJECT");
        expect(res.path).toBe("/time");
      }
    });

    it("拒绝带有 Symbol 键的对象", () => {
      const symKey = Symbol("sym");
      const obj = { [symKey]: "val", regular: 1 };
      const res = validateJsonValue(obj);
      expect(res.valid).toBe(false);
      if (!res.valid) {
        expect(res.code).toBe("INVALID_JSON_OBJECT");
      }
    });

    it("拒绝带有访问器（getter/setter）属性的对象", () => {
      const obj = {
        get dynamic() {
          return 123;
        },
      };
      const res = validateJsonValue(obj);
      expect(res.valid).toBe(false);
      if (!res.valid) {
        expect(res.code).toBe("INVALID_JSON_OBJECT");
        expect(res.path).toBe("/dynamic");
      }
    });

    it("拒绝不可枚举属性的对象", () => {
      const obj = {};
      Object.defineProperty(obj, "hidden", {
        value: 42,
        enumerable: false,
        configurable: true,
      });
      const res = validateJsonValue(obj);
      expect(res.valid).toBe(false);
      if (!res.valid) {
        expect(res.code).toBe("INVALID_JSON_OBJECT");
        expect(res.path).toBe("/hidden");
      }
    });

    it("拒绝属性值为 undefined 的对象", () => {
      const obj = { a: undefined };
      const res = validateJsonValue(obj);
      expect(res.valid).toBe(false);
      if (!res.valid) {
        expect(res.code).toBe("UNDEFINED_JSON_VALUE");
        expect(res.path).toBe("/a");
      }
    });
  });

  describe("严格数组（Array）规范校验", () => {
    it("放行致密普通数组", () => {
      expect(validateJsonValue([1, "a", true, null, { x: 1 }]).valid).toBe(true);
      expect(validateJsonValue([]).valid).toBe(true);
    });

    it("拒绝稀疏数组（存在 hole）", () => {
      const sparse1 = new Array(3);
      const res1 = validateJsonValue(sparse1);
      expect(res1.valid).toBe(false);
      if (!res1.valid) {
        expect(res1.code).toBe("INVALID_JSON_OBJECT");
      }

      const sparse2 = [1, , 3];
      const res2 = validateJsonValue(sparse2);
      expect(res2.valid).toBe(false);
      if (!res2.valid) {
        expect(res2.code).toBe("INVALID_JSON_OBJECT");
      }
    });

    it("拒绝带有额外字符串属性或 Symbol 属性的数组", () => {
      const arr1: any = [1, 2];
      arr1.extra = "prop";
      const res1 = validateJsonValue(arr1);
      expect(res1.valid).toBe(false);
      if (!res1.valid) {
        expect(res1.code).toBe("INVALID_JSON_OBJECT");
      }

      const arr2: any = [1, 2];
      arr2[Symbol("tag")] = "symbol_value";
      const res2 = validateJsonValue(arr2);
      expect(res2.valid).toBe(false);
      if (!res2.valid) {
        expect(res2.code).toBe("INVALID_JSON_OBJECT");
      }
    });

    it("拒绝元素包含 undefined 的数组", () => {
      const arr = [1, undefined, 3];
      const res = validateJsonValue(arr);
      expect(res.valid).toBe(false);
      if (!res.valid) {
        expect(res.code).toBe("UNDEFINED_JSON_VALUE");
        expect(res.path).toBe("/1");
      }
    });

    it("拒绝继承 Array 的子类实例", () => {
      class CustomArray extends Array<number> {}
      const arr = new CustomArray();
      arr.push(1, 2);
      const res = validateJsonValue(arr);
      expect(res.valid).toBe(false);
      if (!res.valid) {
        expect(res.code).toBe("INVALID_JSON_OBJECT");
      }
    });
  });

  describe("Proxy 异常拦截与防御", () => {
    it("捕获抛出异常的 Proxy 并不外泄未分类异常", () => {
      const throwingProxy = new Proxy({}, {
        getPrototypeOf() {
          throw new Error("Proxy trap exploded");
        },
      });

      const res = validateJsonValue(throwingProxy);
      expect(res.valid).toBe(false);
      if (!res.valid) {
        expect(res.code).toBe("INVALID_JSON_OBJECT");
        expect(res.reason).toContain("Proxy trap exploded");
      }
    });

    it("捕获 ownKeys 抛出异常的 Proxy", () => {
      const throwingProxy = new Proxy({}, {
        ownKeys() {
          throw new Error("ownKeys failed");
        },
      });

      const res = validateJsonValue(throwingProxy);
      expect(res.valid).toBe(false);
      if (!res.valid) {
        expect(res.code).toBe("INVALID_JSON_OBJECT");
        expect(res.reason).toContain("ownKeys failed");
      }
    });
  });

  describe("validateActionInputValue 策略校验与禁止属性拦截", () => {
    it("合法数据返回 valid: true", () => {
      const res = validateActionInputValue({
        name: "Alice",
        age: 30,
        tags: ["admin", "dev"],
      });
      expect(res.valid).toBe(true);
    });

    it("拦截根对象中的 __proto__ 禁止属性", () => {
      const obj = JSON.parse('{"__proto__": 123}');
      const res = validateActionInputValue(obj);
      expect(res.valid).toBe(false);
      if (!res.valid && res.kind === "input-policy") {
        expect(res.code).toBe("FORBIDDEN_PROPERTY");
        expect(res.property).toBe("__proto__");
        expect(res.path).toBe("/__proto__");
      }
    });

    it("拦截根对象中的 constructor 禁止属性", () => {
      const obj = { constructor: "exploit" };
      const res = validateActionInputValue(obj);
      expect(res.valid).toBe(false);
      if (!res.valid && res.kind === "input-policy") {
        expect(res.code).toBe("FORBIDDEN_PROPERTY");
        expect(res.property).toBe("constructor");
        expect(res.path).toBe("/constructor");
      }
    });

    it("拦截根对象中的 prototype 禁止属性", () => {
      const obj = { prototype: "exploit" };
      const res = validateActionInputValue(obj);
      expect(res.valid).toBe(false);
      if (!res.valid && res.kind === "input-policy") {
        expect(res.code).toBe("FORBIDDEN_PROPERTY");
        expect(res.property).toBe("prototype");
        expect(res.path).toBe("/prototype");
      }
    });

    it("递归拦截深层嵌套对象中的禁止属性并给出完整 JSON Pointer 路径", () => {
      const deep: any = {
        meta: {
          items: [
            { normal: true },
            { constructor: "nested_bad" },
          ],
        },
      };
      const res = validateActionInputValue(deep);
      expect(res.valid).toBe(false);
      if (!res.valid && res.kind === "input-policy") {
        expect(res.code).toBe("FORBIDDEN_PROPERTY");
        expect(res.property).toBe("constructor");
        expect(res.path).toBe("/meta/items/1/constructor");
      }
    });

    it("validateJsonValue 不触发 input-policy 且放行数据属性的 constructor", () => {
      const obj = { constructor: "plain_data" };
      const res = validateJsonValue(obj);
      expect(res.valid).toBe(true);
    });

    it("非 JsonValue 违规优先于或统一报告为 kind: json-value", () => {
      const bad = { num: NaN };
      const res = validateActionInputValue(bad);
      expect(res.valid).toBe(false);
      if (!res.valid) {
        expect(res.kind).toBe("json-value");
        expect(res.code).toBe("NON_FINITE_NUMBER");
        expect(res.path).toBe("/num");
      }
    });
  });

  describe("assertJsonValue 断言兼容性", () => {
    it("合法值通过断言", () => {
      expect(() => assertJsonValue({ a: 1, b: "ok" })).not.toThrow();
    });

    it("非法值抛出 TypeError 并携带 reason", () => {
      expect(() => assertJsonValue(NaN)).toThrow(TypeError);
      expect(() => assertJsonValue({ bad: Infinity })).toThrow(TypeError);
      expect(() => assertJsonValue(new Date())).toThrow(TypeError);
    });
  });
});
