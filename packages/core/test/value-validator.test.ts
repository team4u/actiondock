import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  validateJsonValue,
  validateActionInputValue,
  assertJsonValue,
  escapeJsonPointerSegment,
  appendJsonPointer,
  DEFAULT_MAX_JSON_DEPTH,
} from "../src/value-validator";

describe("Iterative Strict JsonValue Validator", () => {
  describe("RFC 6901 JSON Pointer 转义与拼接", () => {
    it("正确转义 ~ 与 / 字符", () => {
      assert.strictEqual(escapeJsonPointerSegment("foo"), "foo");
      assert.strictEqual(escapeJsonPointerSegment("foo/bar"), "foo~1bar");
      assert.strictEqual(escapeJsonPointerSegment("foo~bar"), "foo~0bar");
      assert.strictEqual(escapeJsonPointerSegment("~/~0/~1"), "~0~1~00~1~01");
      assert.strictEqual(escapeJsonPointerSegment(0), "0");
    });

    it("正确追加路径段", () => {
      assert.strictEqual(appendJsonPointer("", "user"), "/user");
      assert.strictEqual(appendJsonPointer("/user", "name"), "/user/name");
      assert.strictEqual(appendJsonPointer("/items", 0), "/items/0");
      assert.strictEqual(appendJsonPointer("/items/0", "a/b"), "/items/0/a~1b");
    });
  });

  describe("递归深度限制与深层嵌套", () => {
    it("支持 2,000 层深层嵌套对象在安全递归栈内校验", () => {
      let root: any = { value: "deep_leaf" };
      for (let i = 0; i < 2_000; i++) {
        root = { next: root };
      }

      const res = validateJsonValue(root, { maxDepth: 2_500 });
      assert.strictEqual(res.valid, true);
    });

    it("超过安全递归栈深度时按深度上限拦截而非栈溢出", () => {
      let root: any = { value: "deep_leaf" };
      for (let i = 0; i < 20_000; i++) {
        root = { next: root };
      }

      const res = validateJsonValue(root, { maxDepth: 25_000 });
      assert.strictEqual(res.valid, false);
      if (!res.valid) {
        assert.strictEqual(res.code, "MAX_JSON_DEPTH");
      }
    });

    it("默认最大深度限制 256：深度 256 通过，深度 257 拦截", () => {
      assert.strictEqual(DEFAULT_MAX_JSON_DEPTH, 256);

      let obj256: any = {};
      for (let i = 0; i < 256; i++) {
        obj256 = { inner: obj256 };
      }
      const res256 = validateJsonValue(obj256);
      assert.strictEqual(res256.valid, true);

      let obj257: any = {};
      for (let i = 0; i < 257; i++) {
        obj257 = { inner: obj257 };
      }
      const res257 = validateJsonValue(obj257);
      assert.strictEqual(res257.valid, false);
      if (!res257.valid) {
        assert.strictEqual(res257.code, "MAX_JSON_DEPTH");
        assert.ok((res257.reason).includes("Max JSON depth limit (256) exceeded"));
      }
    });

    it("支持自定义最大深度限制并拦截超限结构", () => {
      let nested: any = 1;
      for (let i = 0; i < 100; i++) {
        nested = { inner: nested };
      }

      const resValid = validateJsonValue(nested, { maxDepth: 150 });
      assert.strictEqual(resValid.valid, true);

      const resExceeded = validateJsonValue(nested, { maxDepth: 50 });
      assert.strictEqual(resExceeded.valid, false);
      if (!resExceeded.valid) {
        assert.strictEqual(resExceeded.code, "MAX_JSON_DEPTH");
        assert.ok((resExceeded.reason).includes("Max JSON depth limit (50) exceeded"));
      }
    });
  });

  describe("循环引用与共享 DAG 结构", () => {
    it("严格拦截对象直接循环引用", () => {
      const cycleObj: any = { a: 1 };
      cycleObj.self = cycleObj;

      const res = validateJsonValue(cycleObj);
      assert.strictEqual(res.valid, false);
      if (!res.valid) {
        assert.strictEqual(res.code, "CIRCULAR_REFERENCE");
        assert.strictEqual(res.reason, "Circular reference detected in object structure");
      }
    });

    it("严格拦截数组循环引用", () => {
      const cycleArr: any = [1, 2];
      cycleArr.push(cycleArr);

      const res = validateJsonValue(cycleArr);
      assert.strictEqual(res.valid, false);
      if (!res.valid) {
        assert.strictEqual(res.code, "CIRCULAR_REFERENCE");
        assert.strictEqual(res.reason, "Circular reference detected in object structure");
      }
    });

    it("严格拦截间接跨层级循环引用", () => {
      const a: any = { b: {} };
      const b: any = { c: {} };
      a.b = b;
      b.c = a;

      const res = validateJsonValue(a);
      assert.strictEqual(res.valid, false);
      if (!res.valid) {
        assert.strictEqual(res.code, "CIRCULAR_REFERENCE");
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
      assert.strictEqual(res.valid, true);
    });
  });

  describe("基础类型与非法原始类型校验", () => {
    it("放行所有基础合法 JSON 类型（null, boolean, string, finite number）", () => {
      assert.strictEqual(validateJsonValue(null).valid, true);
      assert.strictEqual(validateJsonValue(true).valid, true);
      assert.strictEqual(validateJsonValue(false).valid, true);
      assert.strictEqual(validateJsonValue("hello").valid, true);
      assert.strictEqual(validateJsonValue(0).valid, true);
      assert.strictEqual(validateJsonValue(-123.45).valid, true);
      assert.strictEqual(validateJsonValue({}).valid, true);
      assert.strictEqual(validateJsonValue([]).valid, true);
    });

    it("拦截所有非有限数值（NaN, Infinity, -Infinity）", () => {
      const r1 = validateJsonValue(NaN);
      assert.strictEqual(r1.valid, false);
      if (!r1.valid) assert.strictEqual(r1.code, "NON_FINITE_NUMBER");

      const r2 = validateJsonValue(Infinity);
      assert.strictEqual(r2.valid, false);
      if (!r2.valid) assert.strictEqual(r2.code, "NON_FINITE_NUMBER");

      const r3 = validateJsonValue(-Infinity);
      assert.strictEqual(r3.valid, false);
      if (!r3.valid) assert.strictEqual(r3.code, "NON_FINITE_NUMBER");

      const r4 = validateJsonValue({ val: NaN });
      assert.strictEqual(r4.valid, false);
      if (!r4.valid) {
        assert.strictEqual(r4.code, "NON_FINITE_NUMBER");
        assert.strictEqual(r4.path, "/val");
      }

      const r5 = validateJsonValue([1, 2, Infinity]);
      assert.strictEqual(r5.valid, false);
      if (!r5.valid) {
        assert.strictEqual(r5.code, "NON_FINITE_NUMBER");
        assert.strictEqual(r5.path, "/2");
      }
    });

    it("拦截非法 JSON 类型（undefined, function, symbol, bigint）", () => {
      const rUndef = validateJsonValue(undefined);
      assert.strictEqual(rUndef.valid, false);
      if (!rUndef.valid) assert.strictEqual(rUndef.code, "UNDEFINED_JSON_VALUE");

      const rFn = validateJsonValue(() => {});
      assert.strictEqual(rFn.valid, false);
      if (!rFn.valid) assert.strictEqual(rFn.code, "UNSUPPORTED_JSON_TYPE");

      const rSym = validateJsonValue(Symbol("foo"));
      assert.strictEqual(rSym.valid, false);
      if (!rSym.valid) assert.strictEqual(rSym.code, "UNSUPPORTED_JSON_TYPE");

      const rBig = validateJsonValue(BigInt(123));
      assert.strictEqual(rBig.valid, false);
      if (!rBig.valid) assert.strictEqual(rBig.code, "UNSUPPORTED_JSON_TYPE");

      const rObjFn = validateJsonValue({ fn: () => {} });
      assert.strictEqual(rObjFn.valid, false);
      if (!rObjFn.valid) {
        assert.strictEqual(rObjFn.code, "UNSUPPORTED_JSON_TYPE");
        assert.strictEqual(rObjFn.path, "/fn");
      }

      const rArrSym = validateJsonValue([Symbol("bar")]);
      assert.strictEqual(rArrSym.valid, false);
      if (!rArrSym.valid) {
        assert.strictEqual(rArrSym.code, "UNSUPPORTED_JSON_TYPE");
        assert.strictEqual(rArrSym.path, "/0");
      }
    });
  });

  describe("严格对象（Object）规范校验", () => {
    it("放行 Object.prototype 与 Object.create(null) 原型对象", () => {
      assert.strictEqual(validateJsonValue({ a: 1 }).valid, true);

      const nullProtoObj = Object.create(null);
      nullProtoObj.key = "value";
      assert.strictEqual(validateJsonValue(nullProtoObj).valid, true);
    });

    it("拒绝非普通对象原型（Date, Map, Set, RegExp, Promise, Error 等）", () => {
      assert.strictEqual(validateJsonValue(new Date()).valid, false);
      assert.strictEqual(validateJsonValue(new Map()).valid, false);
      assert.strictEqual(validateJsonValue(new Set()).valid, false);
      assert.strictEqual(validateJsonValue(/abc/).valid, false);
      assert.strictEqual(validateJsonValue(Promise.resolve(1)).valid, false);
      assert.strictEqual(validateJsonValue(new Error("err")).valid, false);
      assert.strictEqual(validateJsonValue(new Uint8Array(8)).valid, false);
      assert.strictEqual(validateJsonValue(Buffer.from("abc")).valid, false);

      class CustomClass {
        name = "custom";
      }
      assert.strictEqual(validateJsonValue(new CustomClass()).valid, false);

      const nestedDate = { time: new Date() };
      const res = validateJsonValue(nestedDate);
      assert.strictEqual(res.valid, false);
      if (!res.valid) {
        assert.strictEqual(res.code, "INVALID_JSON_OBJECT");
        assert.strictEqual(res.path, "/time");
      }
    });

    it("拒绝带有 Symbol 键的对象", () => {
      const symKey = Symbol("sym");
      const obj = { [symKey]: "val", regular: 1 };
      const res = validateJsonValue(obj);
      assert.strictEqual(res.valid, false);
      if (!res.valid) {
        assert.strictEqual(res.code, "INVALID_JSON_OBJECT");
      }
    });

    it("拒绝带有访问器（getter/setter）属性的对象", () => {
      const obj = {
        get dynamic() {
          return 123;
        },
      };
      const res = validateJsonValue(obj);
      assert.strictEqual(res.valid, false);
      if (!res.valid) {
        assert.strictEqual(res.code, "INVALID_JSON_OBJECT");
        assert.strictEqual(res.path, "/dynamic");
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
      assert.strictEqual(res.valid, false);
      if (!res.valid) {
        assert.strictEqual(res.code, "INVALID_JSON_OBJECT");
        assert.strictEqual(res.path, "/hidden");
      }
    });

    it("拒绝属性值为 undefined 的对象", () => {
      const obj = { a: undefined };
      const res = validateJsonValue(obj);
      assert.strictEqual(res.valid, false);
      if (!res.valid) {
        assert.strictEqual(res.code, "UNDEFINED_JSON_VALUE");
        assert.strictEqual(res.path, "/a");
      }
    });
  });

  describe("严格数组（Array）规范校验", () => {
    it("放行致密普通数组", () => {
      assert.strictEqual(validateJsonValue([1, "a", true, null, { x: 1 }]).valid, true);
      assert.strictEqual(validateJsonValue([]).valid, true);
    });

    it("拒绝稀疏数组（存在 hole）", () => {
      const sparse1 = new Array(3);
      const res1 = validateJsonValue(sparse1);
      assert.strictEqual(res1.valid, false);
      if (!res1.valid) {
        assert.strictEqual(res1.code, "INVALID_JSON_OBJECT");
      }

      const sparse2 = [1, , 3];
      const res2 = validateJsonValue(sparse2);
      assert.strictEqual(res2.valid, false);
      if (!res2.valid) {
        assert.strictEqual(res2.code, "INVALID_JSON_OBJECT");
      }
    });

    it("拒绝带有额外字符串属性或 Symbol 属性的数组", () => {
      const arr1: any = [1, 2];
      arr1.extra = "prop";
      const res1 = validateJsonValue(arr1);
      assert.strictEqual(res1.valid, false);
      if (!res1.valid) {
        assert.strictEqual(res1.code, "INVALID_JSON_OBJECT");
      }

      const arr2: any = [1, 2];
      arr2[Symbol("tag")] = "symbol_value";
      const res2 = validateJsonValue(arr2);
      assert.strictEqual(res2.valid, false);
      if (!res2.valid) {
        assert.strictEqual(res2.code, "INVALID_JSON_OBJECT");
      }
    });

    it("拒绝元素包含 undefined 的数组", () => {
      const arr = [1, undefined, 3];
      const res = validateJsonValue(arr);
      assert.strictEqual(res.valid, false);
      if (!res.valid) {
        assert.strictEqual(res.code, "UNDEFINED_JSON_VALUE");
        assert.strictEqual(res.path, "/1");
      }
    });

    it("拒绝继承 Array 的子类实例", () => {
      class CustomArray extends Array<number> {}
      const arr = new CustomArray();
      arr.push(1, 2);
      const res = validateJsonValue(arr);
      assert.strictEqual(res.valid, false);
      if (!res.valid) {
        assert.strictEqual(res.code, "INVALID_JSON_OBJECT");
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
      assert.strictEqual(res.valid, false);
      if (!res.valid) {
        assert.strictEqual(res.code, "INVALID_JSON_OBJECT");
        assert.ok((res.reason).includes("Proxy trap exploded"));
      }
    });

    it("捕获 ownKeys 抛出异常的 Proxy", () => {
      const throwingProxy = new Proxy({}, {
        ownKeys() {
          throw new Error("ownKeys failed");
        },
      });

      const res = validateJsonValue(throwingProxy);
      assert.strictEqual(res.valid, false);
      if (!res.valid) {
        assert.strictEqual(res.code, "INVALID_JSON_OBJECT");
        assert.ok((res.reason).includes("ownKeys failed"));
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
      assert.strictEqual(res.valid, true);
    });

    it("拦截根对象中的 __proto__ 禁止属性", () => {
      const obj = JSON.parse('{"__proto__": 123}');
      const res = validateActionInputValue(obj);
      assert.strictEqual(res.valid, false);
      if (!res.valid && res.kind === "input-policy") {
        assert.strictEqual(res.code, "FORBIDDEN_PROPERTY");
        assert.strictEqual(res.property, "__proto__");
        assert.strictEqual(res.path, "/__proto__");
      }
    });

    it("拦截根对象中的 constructor 禁止属性", () => {
      const obj = { constructor: "exploit" };
      const res = validateActionInputValue(obj);
      assert.strictEqual(res.valid, false);
      if (!res.valid && res.kind === "input-policy") {
        assert.strictEqual(res.code, "FORBIDDEN_PROPERTY");
        assert.strictEqual(res.property, "constructor");
        assert.strictEqual(res.path, "/constructor");
      }
    });

    it("拦截根对象中的 prototype 禁止属性", () => {
      const obj = { prototype: "exploit" };
      const res = validateActionInputValue(obj);
      assert.strictEqual(res.valid, false);
      if (!res.valid && res.kind === "input-policy") {
        assert.strictEqual(res.code, "FORBIDDEN_PROPERTY");
        assert.strictEqual(res.property, "prototype");
        assert.strictEqual(res.path, "/prototype");
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
      assert.strictEqual(res.valid, false);
      if (!res.valid && res.kind === "input-policy") {
        assert.strictEqual(res.code, "FORBIDDEN_PROPERTY");
        assert.strictEqual(res.property, "constructor");
        assert.strictEqual(res.path, "/meta/items/1/constructor");
      }
    });

    it("validateJsonValue 不触发 input-policy 且放行数据属性的 constructor", () => {
      const obj = { constructor: "plain_data" };
      const res = validateJsonValue(obj);
      assert.strictEqual(res.valid, true);
    });

    it("非 JsonValue 违规优先于或统一报告为 kind: json-value", () => {
      const bad = { num: NaN };
      const res = validateActionInputValue(bad);
      assert.strictEqual(res.valid, false);
      if (!res.valid) {
        assert.strictEqual(res.kind, "json-value");
        assert.strictEqual(res.code, "NON_FINITE_NUMBER");
        assert.strictEqual(res.path, "/num");
      }
    });
  });

  describe("assertJsonValue 断言兼容性", () => {
    it("合法值通过断言", () => {
      assert.doesNotThrow(() => assertJsonValue({ a: 1, b: "ok" }));
    });

    it("非法值抛出 TypeError 并携带 reason", () => {
      assert.throws(() => assertJsonValue(NaN), TypeError);
      assert.throws(() => assertJsonValue({ bad: Infinity }), TypeError);
      assert.throws(() => assertJsonValue(new Date()), TypeError);
    });
  });
});
