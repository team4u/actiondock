import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Readable } from "node:stream";
import { writeFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  decodeFlatInput,
  parseFlatAssignments,
  materializeFlatInput,
  resolveActionInput,
  stripBom,
  InputError,
  FlatInputError,
  INVALID_FLAT_ARGUMENT,
  INVALID_JSON,
  INVALID_JSON_LITERAL,
  INPUT_PATH_CONFLICT,
  FLAT_INPUT_LIMIT_EXCEEDED,
  INPUT_CONFLICT,
  formatActionDetail,
  invalidJson,
  inputFileNotFound,
  inputFileReadFailed,
  inputConflict,
  invalidFlatArgument,
  invalidJsonLiteral,
  inputPathConflict,
  flatInputLimitExceeded,
} from "../../src/input";

describe("Flat JsonValue Encoding v1", () => {
  describe("字符串赋值（=）", () => {
    it("正确物化普通字符串", () => {
      const res = decodeFlatInput(["name=alice", "city=beijing"]);
      assert.deepStrictEqual(res, { name: "alice", city: "beijing" });
    });

    it("正确处理包含空格、等号与冒号的复杂字符串", () => {
      const res = decodeFlatInput([
        "query=foo=bar:=baz",
        "msg=hello world: 123",
        "url=https://example.com/api?a=1&b=2",
      ]);
      assert.deepStrictEqual(res, {
        query: "foo=bar:=baz",
        msg: "hello world: 123",
        url: "https://example.com/api?a=1&b=2",
      });
    });

    it("保留数字字符串为原始字符串类型", () => {
      const res = decodeFlatInput(["num=123", "float=45.67"]);
      assert.deepStrictEqual(res, { num: "123", float: "45.67" });
    });

    it("保留布尔值字符串为原始字符串类型", () => {
      const res = decodeFlatInput(["t=true", "f=false"]);
      assert.deepStrictEqual(res, { t: "true", f: "false" });
    });

    it("保留 JSON 结构字符串为原始字符串类型", () => {
      const res = decodeFlatInput(['json={"x":1}', "arr=[1,2,3]"]);
      assert.deepStrictEqual(res, { json: '{"x":1}', arr: "[1,2,3]" });
    });

    it("允许空字符串赋值", () => {
      const res = decodeFlatInput(["empty="]);
      assert.deepStrictEqual(res, { empty: "" });
    });
  });

  describe("JSON 赋值（:=）", () => {
    it("正确解析数值类型", () => {
      const res = decodeFlatInput(["n1:=123", "n2:=-45.6", "n3:=0", "n4:=1e5"]);
      assert.deepStrictEqual(res, { n1: 123, n2: -45.6, n3: 0, n4: 100000 });
    });

    it("正确解析布尔值与 null", () => {
      const res = decodeFlatInput(["t:=true", "f:=false", "n:=null"]);
      assert.deepStrictEqual(res, { t: true, f: false, n: null });
    });

    it("正确解析 JSON 字符串字面量", () => {
      const res = decodeFlatInput(['s:="hello"']);
      assert.deepStrictEqual(res, { s: "hello" });
    });

    it("正确解析数组与嵌套对象", () => {
      const res = decodeFlatInput([
        "arr:=[1, 2, 3]",
        'obj:={"x": 1, "y": [true, "nested"]}',
      ]);
      assert.deepStrictEqual(res, {
        arr: [1, 2, 3],
        obj: { x: 1, y: [true, "nested"] },
      });
    });

    it("拒绝非法 JSON 字面量并抛出 INVALID_JSON_LITERAL", () => {
      assert.throws(() => decodeFlatInput(["bad:=invalid_json"]), FlatInputError);
      try {
        decodeFlatInput(["bad:=invalid_json"]);
        assert.fail("不应到达此分支");
      } catch (err: any) {
        assert.strictEqual(err.code, INVALID_JSON_LITERAL);
      }
    });

    it("拒绝非有限数值（如 1e999、Infinity、NaN）并抛出 INVALID_JSON_LITERAL", () => {
      assert.throws(() => decodeFlatInput(["inf:=1e999"]), FlatInputError);
      try {
        decodeFlatInput(["inf:=1e999"]);
        assert.fail("不应到达此分支");
      } catch (err: any) {
        assert.strictEqual(err.code, INVALID_JSON_LITERAL);
      }

      assert.throws(() => decodeFlatInput(["arr:=[1, 1e999]"]), FlatInputError);
      try {
        decodeFlatInput(["arr:=[1, 1e999]"]);
        assert.fail("不应到达此分支");
      } catch (err: any) {
        assert.strictEqual(err.code, INVALID_JSON_LITERAL);
      }

      assert.throws(() => decodeFlatInput(['obj:={"val": 1e999}']), FlatInputError);
      try {
        decodeFlatInput(['obj:={"val": 1e999}']);
        assert.fail("不应到达此分支");
      } catch (err: any) {
        assert.strictEqual(err.code, INVALID_JSON_LITERAL);
      }
    });
  });

  describe("对象与数组路径", () => {
    it("物化单级与多级对象", () => {
      const res = decodeFlatInput(["name=alice", "a.b.c=1", "a.b.d=2"]);
      assert.deepStrictEqual(res, {
        name: "alice",
        a: {
          b: {
            c: "1",
            d: "2",
          },
        },
      });
    });

    it("物化单级数组", () => {
      const res = decodeFlatInput(["items.0=first", "items.1=second"]);
      assert.deepStrictEqual(res, { items: ["first", "second"] });
    });

    it("物化多维数组", () => {
      const res = decodeFlatInput([
        "matrix.0.0=1",
        "matrix.0.1=2",
        "matrix.1.0=3",
        "matrix.1.1=4",
      ]);
      assert.deepStrictEqual(res, {
        matrix: [
          ["1", "2"],
          ["3", "4"],
        ],
      });
    });

    it("物化对象与数组混合嵌套", () => {
      const res = decodeFlatInput([
        "users.0.name=alice",
        "users.0.tags.0=admin",
        "users.0.tags.1=dev",
        "users.1.name=bob",
        "users.1.tags.0=user",
      ]);
      assert.deepStrictEqual(res, {
        users: [
          { name: "alice", tags: ["admin", "dev"] },
          { name: "bob", tags: ["user"] },
        ],
      });
    });
  });

  describe("非法索引拒绝", () => {
    it("拒绝带有前导零的数组索引", () => {
      assert.throws(() => decodeFlatInput(["items.00=1"]), FlatInputError);
      try {
        decodeFlatInput(["items.00=1"]);
        assert.fail("不应到达此分支");
      } catch (err: any) {
        assert.strictEqual(err.code, INVALID_FLAT_ARGUMENT);
      }

      assert.throws(() => decodeFlatInput(["items.01=1"]), FlatInputError);
      try {
        decodeFlatInput(["items.01=1"]);
        assert.fail("不应到达此分支");
      } catch (err: any) {
        assert.strictEqual(err.code, INVALID_FLAT_ARGUMENT);
      }
    });

    it("拒绝负数索引与科学计数法索引", () => {
      assert.throws(() => decodeFlatInput(["items.-1=1"]), FlatInputError);
      try {
        decodeFlatInput(["items.-1=1"]);
        assert.fail("不应到达此分支");
      } catch (err: any) {
        assert.strictEqual(err.code, INVALID_FLAT_ARGUMENT);
      }

      assert.throws(() => decodeFlatInput(["items.1e2=1"]), FlatInputError);
      try {
        decodeFlatInput(["items.1e2=1"]);
        assert.fail("不应到达此分支");
      } catch (err: any) {
        assert.strictEqual(err.code, INVALID_FLAT_ARGUMENT);
      }
    });

    it("拒绝根节点为数组索引并抛出 INPUT_PATH_CONFLICT", () => {
      assert.throws(() => decodeFlatInput(["0=foo"]), FlatInputError);
      try {
        decodeFlatInput(["0=foo"]);
        assert.fail("不应到达此分支");
      } catch (err: any) {
        assert.strictEqual(err.code, INPUT_PATH_CONFLICT);
      }
    });
  });

  describe("安全属性拦截", () => {
    it("拦截 __proto__ 危险属性并带上 FORBIDDEN_PROPERTY 根因", () => {
      assert.throws(() => decodeFlatInput(["__proto__=1"]), FlatInputError);
      try {
        decodeFlatInput(["__proto__=1"]);
        assert.fail("不应到达此分支");
      } catch (err: any) {
        assert.strictEqual(err.code, INVALID_FLAT_ARGUMENT);
        assert.strictEqual(err.details?.reason, "FORBIDDEN_PROPERTY");
      }

      assert.throws(() => decodeFlatInput(["a.__proto__.b=1"]), FlatInputError);
      try {
        decodeFlatInput(["a.__proto__.b=1"]);
        assert.fail("不应到达此分支");
      } catch (err: any) {
        assert.strictEqual(err.code, INVALID_FLAT_ARGUMENT);
        assert.strictEqual(err.details?.reason, "FORBIDDEN_PROPERTY");
      }
    });

    it("拦截 constructor 危险属性并带上 FORBIDDEN_PROPERTY 根因", () => {
      assert.throws(() => decodeFlatInput(["constructor=1"]), FlatInputError);
      try {
        decodeFlatInput(["constructor=1"]);
        assert.fail("不应到达此分支");
      } catch (err: any) {
        assert.strictEqual(err.code, INVALID_FLAT_ARGUMENT);
        assert.strictEqual(err.details?.reason, "FORBIDDEN_PROPERTY");
      }

      assert.throws(() => decodeFlatInput(["a.constructor.b=1"]), FlatInputError);
      try {
        decodeFlatInput(["a.constructor.b=1"]);
        assert.fail("不应到达此分支");
      } catch (err: any) {
        assert.strictEqual(err.code, INVALID_FLAT_ARGUMENT);
        assert.strictEqual(err.details?.reason, "FORBIDDEN_PROPERTY");
      }
    });

    it("拦截 prototype 危险属性并带上 FORBIDDEN_PROPERTY 根因", () => {
      assert.throws(() => decodeFlatInput(["prototype=1"]), FlatInputError);
      try {
        decodeFlatInput(["prototype=1"]);
        assert.fail("不应到达此分支");
      } catch (err: any) {
        assert.strictEqual(err.code, INVALID_FLAT_ARGUMENT);
        assert.strictEqual(err.details?.reason, "FORBIDDEN_PROPERTY");
      }

      assert.throws(() => decodeFlatInput(["a.prototype.b=1"]), FlatInputError);
      try {
        decodeFlatInput(["a.prototype.b=1"]);
        assert.fail("不应到达此分支");
      } catch (err: any) {
        assert.strictEqual(err.code, INVALID_FLAT_ARGUMENT);
        assert.strictEqual(err.details?.reason, "FORBIDDEN_PROPERTY");
      }
    });
  });

  describe("路径冲突拒绝", () => {
    it("拒绝叶节点与容器节点冲突（先叶后容器）", () => {
      assert.throws(() => decodeFlatInput(["a=1", "a.b=2"]), FlatInputError);
      try {
        decodeFlatInput(["a=1", "a.b=2"]);
        assert.fail("不应到达此分支");
      } catch (err: any) {
        assert.strictEqual(err.code, INPUT_PATH_CONFLICT);
      }
    });

    it("拒绝容器节点与叶节点冲突（先容器后叶）", () => {
      assert.throws(() => decodeFlatInput(["a.b=2", "a=1"]), FlatInputError);
      try {
        decodeFlatInput(["a.b=2", "a=1"]);
        assert.fail("不应到达此分支");
      } catch (err: any) {
        assert.strictEqual(err.code, INPUT_PATH_CONFLICT);
      }
    });

    it("拒绝对象与数组冲突（先对象后数组）", () => {
      assert.throws(() => decodeFlatInput(["a.b=1", "a.0=2"]), FlatInputError);
      try {
        decodeFlatInput(["a.b=1", "a.0=2"]);
        assert.fail("不应到达此分支");
      } catch (err: any) {
        assert.strictEqual(err.code, INPUT_PATH_CONFLICT);
      }
    });

    it("拒绝数组与对象冲突（先数组后对象）", () => {
      assert.throws(() => decodeFlatInput(["a.0=1", "a.b=2"]), FlatInputError);
      try {
        decodeFlatInput(["a.0=1", "a.b=2"]);
        assert.fail("不应到达此分支");
      } catch (err: any) {
        assert.strictEqual(err.code, INPUT_PATH_CONFLICT);
      }
    });

    it("拒绝重复叶节点赋值（不同值）", () => {
      assert.throws(() => decodeFlatInput(["a=1", "a=2"]), FlatInputError);
      try {
        decodeFlatInput(["a=1", "a=2"]);
        assert.fail("不应到达此分支");
      } catch (err: any) {
        assert.strictEqual(err.code, INPUT_PATH_CONFLICT);
      }
    });

    it("拒绝重复叶节点赋值（相同值）", () => {
      assert.throws(() => decodeFlatInput(["a=1", "a=1"]), FlatInputError);
      try {
        decodeFlatInput(["a=1", "a=1"]);
        assert.fail("不应到达此分支");
      } catch (err: any) {
        assert.strictEqual(err.code, INPUT_PATH_CONFLICT);
      }
    });
  });

  describe("稀疏数组拒绝", () => {
    it("拒绝缺失起始索引 0", () => {
      assert.throws(() => decodeFlatInput(["items.1=foo"]), FlatInputError);
      try {
        decodeFlatInput(["items.1=foo"]);
        assert.fail("不应到达此分支");
      } catch (err: any) {
        assert.strictEqual(err.code, INPUT_PATH_CONFLICT);
      }
    });

    it("拒绝中间缺失索引（如存在 0 与 2 但缺失 1）", () => {
      assert.throws(() => decodeFlatInput(["items.0=foo", "items.2=bar"]), 
        FlatInputError
      );
      try {
        decodeFlatInput(["items.0=foo", "items.2=bar"]);
        assert.fail("不应到达此分支");
      } catch (err: any) {
        assert.strictEqual(err.code, INPUT_PATH_CONFLICT);
      }
    });
  });

  describe("资源限制拦截", () => {
    it("拦截赋值总数超限", () => {
      assert.throws(() =>
        parseFlatAssignments(["a=1", "b=2"], { maxAssignments: 1 }), FlatInputError);
      try {
        parseFlatAssignments(["a=1", "b=2"], { maxAssignments: 1 });
        assert.fail("不应到达此分支");
      } catch (err: any) {
        assert.strictEqual(err.code, FLAT_INPUT_LIMIT_EXCEEDED);
      }
    });

    it("拦截路径深度超限", () => {
      assert.throws(() =>
        parseFlatAssignments(["a.b.c=1"], { maxPathDepth: 2 }), FlatInputError);
      try {
        parseFlatAssignments(["a.b.c=1"], { maxPathDepth: 2 });
        assert.fail("不应到达此分支");
      } catch (err: any) {
        assert.strictEqual(err.code, FLAT_INPUT_LIMIT_EXCEEDED);
      }
    });

    it("拦截路径长度超限", () => {
      assert.throws(() =>
        parseFlatAssignments(["abcdef=1"], { maxPathLength: 4 }), FlatInputError);
      try {
        parseFlatAssignments(["abcdef=1"], { maxPathLength: 4 });
        assert.fail("不应到达此分支");
      } catch (err: any) {
        assert.strictEqual(err.code, FLAT_INPUT_LIMIT_EXCEEDED);
      }
    });

    it("拦截属性名长度超限", () => {
      assert.throws(() =>
        parseFlatAssignments(["verylongname=1"], { maxPropertyKeyLength: 5 }), FlatInputError);
      try {
        parseFlatAssignments(["verylongname=1"], { maxPropertyKeyLength: 5 });
        assert.fail("不应到达此分支");
      } catch (err: any) {
        assert.strictEqual(err.code, FLAT_INPUT_LIMIT_EXCEEDED);
      }
    });

    it("拦截原始值长度超限", () => {
      assert.throws(() =>
        parseFlatAssignments(["k=toolongvalue"], { maxRawValueLength: 5 }), FlatInputError);
      try {
        parseFlatAssignments(["k=toolongvalue"], { maxRawValueLength: 5 });
        assert.fail("不应到达此分支");
      } catch (err: any) {
        assert.strictEqual(err.code, FLAT_INPUT_LIMIT_EXCEEDED);
      }
    });

    it("拦截 JSON 字面量大小超限", () => {
      assert.throws(() =>
        parseFlatAssignments(['k:="toolongjson"'], { maxJsonLiteralLength: 5 }), FlatInputError);
      try {
        parseFlatAssignments(['k:="toolongjson"'], { maxJsonLiteralLength: 5 });
        assert.fail("不应到达此分支");
      } catch (err: any) {
        assert.strictEqual(err.code, FLAT_INPUT_LIMIT_EXCEEDED);
      }
    });

    it("拦截数组索引数值超限", () => {
      assert.throws(() =>
        parseFlatAssignments(["items.100=1"], { maxArrayIndex: 50 }), FlatInputError);
      try {
        parseFlatAssignments(["items.100=1"], { maxArrayIndex: 50 });
        assert.fail("不应到达此分支");
      } catch (err: any) {
        assert.strictEqual(err.code, FLAT_INPUT_LIMIT_EXCEEDED);
      }
    });

    it("拦截物化后总大小超限", () => {
      const assignments = parseFlatAssignments(["a=hello_world_text"]);
      assert.throws(() =>
        materializeFlatInput(assignments, { maxMaterializedSizeBytes: 5 }), FlatInputError);
      try {
        materializeFlatInput(assignments, { maxMaterializedSizeBytes: 5 });
        assert.fail("不应到达此分支");
      } catch (err: any) {
        assert.strictEqual(err.code, FLAT_INPUT_LIMIT_EXCEEDED);
      }
    });
  });

  describe("输入源互斥", () => {
    it("拒绝同时指定 flatArgs 与 input", async () => {
      await assert.rejects(
        resolveActionInput({ flatArgs: ["a=1"], input: '{"b":2}' })
      , InputError);
      try {
        await resolveActionInput({ flatArgs: ["a=1"], input: '{"b":2}' });
        assert.fail("不应到达此分支");
      } catch (err: any) {
        assert.ok(err instanceof InputError);
        assert.ok(!(err instanceof FlatInputError));
        assert.strictEqual(err.code, INPUT_CONFLICT);
      }
    });

    it("拒绝同时指定 flatArgs 与 inputFile", async () => {
      await assert.rejects(
        resolveActionInput({ flatArgs: ["a=1"], inputFile: "test.json" })
      , InputError);
      try {
        await resolveActionInput({ flatArgs: ["a=1"], inputFile: "test.json" });
        assert.fail("不应到达此分支");
      } catch (err: any) {
        assert.ok(err instanceof InputError);
        assert.ok(!(err instanceof FlatInputError));
        assert.strictEqual(err.code, INPUT_CONFLICT);
      }
    });

    it("拒绝同时指定 input 与 inputFile", async () => {
      await assert.rejects(
        resolveActionInput({ input: '{"a":1}', inputFile: "test.json" })
      , InputError);
      try {
        await resolveActionInput({ input: '{"a":1}', inputFile: "test.json" });
        assert.fail("不应到达此分支");
      } catch (err: any) {
        assert.ok(err instanceof InputError);
        assert.ok(!(err instanceof FlatInputError));
        assert.strictEqual(err.code, INPUT_CONFLICT);
      }
    });

    it("拒绝同时指定全部三种输入源", async () => {
      await assert.rejects(
        resolveActionInput({
          flatArgs: ["a=1"],
          input: '{"b":2}',
          inputFile: "test.json",
        })
      , InputError);
      try {
        await resolveActionInput({
          flatArgs: ["a=1"],
          input: '{"b":2}',
          inputFile: "test.json",
        });
        assert.fail("不应到达此分支");
      } catch (err: any) {
        assert.ok(err instanceof InputError);
        assert.ok(!(err instanceof FlatInputError));
        assert.strictEqual(err.code, INPUT_CONFLICT);
      }
    });

    it("仅指定 flatArgs 时成功物化", async () => {
      const res = await resolveActionInput({ flatArgs: ["name=bob", "age:=30"] });
      assert.deepStrictEqual(res, { name: "bob", age: 30 });
    });

    it("仅指定 input 时正确解析（支持 BOM 剥离）", async () => {
      const withoutBom = await resolveActionInput({ input: '{"key": "val"}' });
      assert.deepStrictEqual(withoutBom, { key: "val" });

      const withBom = await resolveActionInput({ input: '\uFEFF{"key": "bom_val"}' });
      assert.deepStrictEqual(withBom, { key: "bom_val" });
    });

    it("仅指定 inputFile 读取物理文件正确解析", async () => {
      const testFilePath = join(tmpdir(), `test-input-${Date.now()}.json`);
      writeFileSync(testFilePath, '\uFEFF{"fileKey": "fileVal"}', "utf8");
      try {
        const res = await resolveActionInput({ inputFile: testFilePath });
        assert.deepStrictEqual(res, { fileKey: "fileVal" });
      } finally {
        unlinkSync(testFilePath);
      }
    });

    it("仅指定 inputFile 为 '-' 时从 stdin 读取并正确解析", async () => {
      const stream = Readable.from(['\uFEFF{"fromStdin": true}']);
      const res = await resolveActionInput({ inputFile: "-", stdin: stream });
      assert.deepStrictEqual(res, { fromStdin: true });
    });

    it("均未指定时返回空对象 {}", async () => {
      const res = await resolveActionInput({});
      assert.deepStrictEqual(res, {});
    });
  });

  describe("赋值顺序无关性", () => {
    it("对象属性不同赋值顺序产生完全相同结果", () => {
      const order1 = decodeFlatInput(["a=1", "b=2", "c=3"]);
      const order2 = decodeFlatInput(["c=3", "a=1", "b=2"]);
      const order3 = decodeFlatInput(["b=2", "c=3", "a=1"]);

      assert.deepStrictEqual(order1, { a: "1", b: "2", c: "3" });
      assert.deepStrictEqual(order2, { a: "1", b: "2", c: "3" });
      assert.deepStrictEqual(order3, { a: "1", b: "2", c: "3" });
      assert.strictEqual(JSON.stringify(order1), JSON.stringify(order2));
      assert.strictEqual(JSON.stringify(order2), JSON.stringify(order3));
    });

    it("数组元素不同赋值顺序产生完全相同结果", () => {
      const order1 = decodeFlatInput(["items.0=first", "items.1=second"]);
      const order2 = decodeFlatInput(["items.1=second", "items.0=first"]);

      assert.deepStrictEqual(order1, { items: ["first", "second"] });
      assert.deepStrictEqual(order2, { items: ["first", "second"] });
      assert.strictEqual(JSON.stringify(order1), JSON.stringify(order2));
    });

    it("深层混合结构不同赋值顺序产生完全相同结果", () => {
      const order1 = decodeFlatInput([
        "users.1.name=bob",
        "users.0.tags.1=dev",
        "users.0.name=alice",
        "users.0.tags.0=admin",
      ]);
      const order2 = decodeFlatInput([
        "users.0.tags.0=admin",
        "users.0.name=alice",
        "users.1.name=bob",
        "users.0.tags.1=dev",
      ]);

      assert.deepStrictEqual(order1, order2);
      assert.strictEqual(JSON.stringify(order1), JSON.stringify(order2));
    });
  });

  describe("fuzz / 极限边界", () => {
    it("空 tokens 数组返回空对象", () => {
      assert.deepStrictEqual(decodeFlatInput([]), {});
    });

    it("支持值中包含特殊字符、Unicode、Emoji 与换行符", () => {
      const res = decodeFlatInput([
        "unicode=你好世界，ActionDock！",
        "emoji=🚀✨💡",
        "newline=line1\nline2\nline3",
        "escapes=\t\r\\",
      ]);
      assert.deepStrictEqual(res, {
        unicode: "你好世界，ActionDock！",
        emoji: "🚀✨💡",
        newline: "line1\nline2\nline3",
        escapes: "\t\r\\",
      });
    });

    it("拒绝非法路径符号", () => {
      const invalidPaths = [
        "a..b=1",
        ".a=1",
        "a.=1",
        "a/b=1",
        "a@b=1",
        "a#b=1",
        "a$b=1",
        "a*b=1",
        "a b=1",
      ];
      for (const token of invalidPaths) {
        assert.throws(() => decodeFlatInput([token]), FlatInputError);
        try {
          decodeFlatInput([token]);
          assert.fail("不应到达此分支");
        } catch (err: any) {
          assert.strictEqual(err.code, INVALID_FLAT_ARGUMENT);
        }
      }
    });

    it("拒绝缺少赋值操作符的 token", () => {
      assert.throws(() => decodeFlatInput(["no_operator"]), FlatInputError);
      try {
        decodeFlatInput(["no_operator"]);
        assert.fail("不应到达此分支");
      } catch (err: any) {
        assert.strictEqual(err.code, INVALID_FLAT_ARGUMENT);
      }
    });

    it("拒绝空路径的 token", () => {
      assert.throws(() => decodeFlatInput(["=value"]), FlatInputError);
      try {
        decodeFlatInput(["=value"]);
        assert.fail("不应到达此分支");
      } catch (err: any) {
        assert.strictEqual(err.code, INVALID_FLAT_ARGUMENT);
      }

      assert.throws(() => decodeFlatInput([":=123"]), FlatInputError);
      try {
        decodeFlatInput([":=123"]);
        assert.fail("不应到达此分支");
      } catch (err: any) {
        assert.strictEqual(err.code, INVALID_FLAT_ARGUMENT);
      }
    });
  });

  describe("错误信息脱敏（避免回显完整参数值）", () => {
    it("路径冲突异常严禁在错误信息与 details 中回显敏感参数明文", () => {
      const secret = "super_secret_api_key_123456";
      let caughtErr: any;
      try {
        decodeFlatInput([`auth.token=${secret}`, `auth.token.secret=true`]);
      } catch (err: any) {
        caughtErr = err;
      }
      assert.notStrictEqual(caughtErr, undefined);
      assert.strictEqual(caughtErr.code, INPUT_PATH_CONFLICT);
      assert.ok(!(caughtErr.message).includes(secret));
      assert.ok(!(JSON.stringify(caughtErr.details || {})).includes(secret));
      assert.strictEqual(caughtErr.details.path, "auth.token");
      assert.strictEqual(caughtErr.details.valueLength, Buffer.byteLength("true", "utf8"));
    });

    it("JSON 字面量解析失败严禁在错误信息与 details 中回显敏感内容", () => {
      const sensitiveToken = "my_sensitive_unquoted_payload";
      let caughtErr: any;
      try {
        decodeFlatInput([`password:=${sensitiveToken}`]);
      } catch (err: any) {
        caughtErr = err;
      }
      assert.notStrictEqual(caughtErr, undefined);
      assert.strictEqual(caughtErr.code, INVALID_JSON_LITERAL);
      assert.ok(!(caughtErr.message).includes(sensitiveToken));
      assert.ok(!(JSON.stringify(caughtErr.details || {})).includes(sensitiveToken));
      assert.strictEqual(caughtErr.details.path, "password");
      assert.strictEqual(caughtErr.details.operator, ":=");
      assert.strictEqual(caughtErr.details.valueLength, Buffer.byteLength(sensitiveToken, "utf8"));
    });

    it("空路径异常严禁在 details 中回显未经脱敏的参数明文", () => {
      const sensitiveVal = "super_secret_unassociated_value";
      let caughtErr: any;
      try {
        decodeFlatInput([`=${sensitiveVal}`]);
      } catch (err: any) {
        caughtErr = err;
      }
      assert.notStrictEqual(caughtErr, undefined);
      assert.strictEqual(caughtErr.code, INVALID_FLAT_ARGUMENT);
      assert.ok(!(caughtErr.message).includes(sensitiveVal));
      assert.ok(!(JSON.stringify(caughtErr.details || {})).includes(sensitiveVal));
    });
  });

  describe("INVALID_JSON 与 INVALID_JSON_LITERAL 独立断言", () => {
    it("--input 完整文档解析失败抛出 INVALID_JSON", async () => {
      await assert.rejects(resolveActionInput({ input: "{bad json}" }), 
        InputError
      );
      try {
        await resolveActionInput({ input: "{bad json}" });
        assert.fail("不应到达此分支");
      } catch (err: any) {
        assert.strictEqual(err.code, INVALID_JSON);
      }
    });

    it("--input 包含 1e400 (Infinity) 或深度超限抛出 INVALID_JSON", async () => {
      await assert.rejects(resolveActionInput({ input: "1e400" }), InputError);
      try {
        await resolveActionInput({ input: "1e400" });
        assert.fail("不应到达此分支");
      } catch (err: any) {
        assert.strictEqual(err.code, INVALID_JSON);
        assert.ok((err.message).includes("Number is non-finite or NaN"));
      }

      // 深度超过 256
      let deep = "1";
      for (let i = 0; i < 260; i++) {
        deep = `{"inner":${deep}}`;
      }
      await assert.rejects(resolveActionInput({ input: deep }), InputError);
      try {
        await resolveActionInput({ input: deep });
        assert.fail("不应到达此分支");
      } catch (err: any) {
        assert.strictEqual(err.code, INVALID_JSON);
        assert.ok((err.message).includes("Max JSON depth limit"));
      }
    });

    it("--input-file 完整文档解析失败抛出 INVALID_JSON", async () => {
      const testFile = join(tmpdir(), `test-invalid-${Date.now()}.json`);
      writeFileSync(testFile, "invalid json document", "utf8");
      try {
        await assert.rejects(resolveActionInput({ inputFile: testFile }), 
          InputError
        );
        try {
          await resolveActionInput({ inputFile: testFile });
          assert.fail("不应到达此分支");
        } catch (err: any) {
          assert.strictEqual(err.code, INVALID_JSON);
        }
      } finally {
        unlinkSync(testFile);
      }
    });

    it("stdin 完整文档解析失败抛出 INVALID_JSON", async () => {
      const stream = Readable.from(["not a valid json"]);
      await assert.rejects(
        resolveActionInput({ inputFile: "-", stdin: stream })
      , InputError);
      try {
        const stream2 = Readable.from(["not a valid json"]);
        await resolveActionInput({ inputFile: "-", stdin: stream2 });
        assert.fail("不应到达此分支");
      } catch (err: any) {
        assert.strictEqual(err.code, INVALID_JSON);
      }
    });

    it("仅 path:=json 字面量解析失败抛出 INVALID_JSON_LITERAL", () => {
      assert.throws(() => decodeFlatInput(["num:=not_json"]), FlatInputError);
      try {
        decodeFlatInput(["num:=not_json"]);
        assert.fail("不应到达此分支");
      } catch (err: any) {
        assert.strictEqual(err.code, INVALID_JSON_LITERAL);
      }
    });
  });

  describe("空数组安全处理", () => {
    it("空 flatArgs 数组不会与 input 发生互斥冲突", async () => {
      const res = await resolveActionInput({ flatArgs: [], input: '{"hello":"world"}' });
      assert.deepStrictEqual(res, { hello: "world" });
    });

    it("空 flatArgs 数组不会与 inputFile 发生互斥冲突", async () => {
      const testFile = join(tmpdir(), `test-empty-flat-${Date.now()}.json`);
      writeFileSync(testFile, '{"fromFile":true}', "utf8");
      try {
        const res = await resolveActionInput({ flatArgs: [], inputFile: testFile });
        assert.deepStrictEqual(res, { fromFile: true });
      } finally {
        unlinkSync(testFile);
      }
    });
  });

  describe("聚合预算预检与字节级资源限制", () => {
    it("拦截累计原始输入总字节数超限", () => {
      assert.throws(() =>
        parseFlatAssignments(["a=123", "b=456"], { maxTotalRawBytes: 5 }), FlatInputError);
      try {
        parseFlatAssignments(["a=123", "b=456"], { maxTotalRawBytes: 5 });
        assert.fail("不应到达此分支");
      } catch (err: any) {
        assert.strictEqual(err.code, FLAT_INPUT_LIMIT_EXCEEDED);
        assert.ok((err.message).includes("Total raw input bytes"));
      }
    });
  });

  describe("编码顾问（Encoding Advisor）与格式化渲染", () => {


    it("展示扁平推荐模式与建议赋值操作符", () => {
      const formatted = formatActionDetail({
        id: "sample.create",
        inputSchema: {
          type: "object",
          properties: {
            name: { type: "string" },
            age: { type: "number" },
            meta: { type: "object" },
          },
          required: ["name", "age"],
        },
      });

      assert.ok((formatted).includes("Action: sample.create"));
      assert.ok((formatted).includes("Recommended Input: flat"));
      assert.ok((formatted).includes("Assignments:"));
      assert.ok((formatted).includes("  name="));
      assert.ok((formatted).includes("  age:="));
      assert.ok((formatted).includes("  meta:="));
    });

    it("不支持扁平传参时在调用模式引导中明确推荐 full-json 并给出原因", () => {
      const formatted = formatActionDetail({
        id: "sample.array",
        inputSchema: {
          type: "array",
          items: { type: "string" },
        },
      });

      assert.ok((formatted).includes("Action: sample.array"));
      assert.ok((formatted).includes("Recommended Input: full-json"));
      assert.ok((formatted).includes("Reason: NON_OBJECT_SCHEMA"));
    });

    it("formatActionDetail 输出排版与 CLI 完全一致", () => {
      const formatted = formatActionDetail({
        id: "test.action",
        packageId: "test.pkg",
        description: "测试动作",
        inputSchema: {
          type: "object",
          properties: {
            title: { type: "string", description: "标题" },
          },
          required: ["title"],
        },
      });

      assert.ok((formatted).includes("Action: test.action"));
      assert.ok((formatted).includes("Package: test.pkg"));
      assert.ok((formatted).includes("Description: 测试动作"));
      assert.ok((formatted).includes("Recommended Input: flat"));
      assert.ok((formatted).includes("Assignments:\n  title="));
    });


    it("formatActionDetail 正确渲染布尔模式 false", () => {
      const formatted = formatActionDetail({
        id: "test.bool-false",
        inputSchema: false,
      });
      assert.ok((formatted).includes("Action: test.bool-false"));
      assert.ok((formatted).includes("Input Schema:\nfalse"));
      assert.ok((formatted).includes("Recommended Input: none"));
      assert.ok((formatted).includes("Reason: SCHEMA_REJECTS_ALL"));
    });

    it("formatActionDetail 正确渲染布尔模式 true", () => {
      const formatted = formatActionDetail({
        id: "test.bool-true",
        inputSchema: true,
      });
      assert.ok((formatted).includes("Action: test.bool-true"));
      assert.ok((formatted).includes("Input Schema:\ntrue"));
      assert.ok((formatted).includes("Recommended Input: full-json"));
      assert.ok((formatted).includes("Reason: ARBITRARY_SCHEMA"));
    });

    it("formatActionDetail 正确渲染 undefined inputSchema 为无模式", () => {
      const formatted = formatActionDetail({
        id: "test.no-schema",
      });
      assert.ok((formatted).includes("Action: test.no-schema"));
      assert.ok((formatted).includes("Recommended Input: full-json"));
      assert.ok((formatted).includes("Reason: NO_SCHEMA"));
    });

    it("formatActionDetail 正确渲染布尔模式 outputSchema (false 与 true)", () => {
      const formattedFalse = formatActionDetail({
        id: "test.output-false",
        outputSchema: false,
      });
      assert.ok((formattedFalse).includes("Output Schema:\nfalse"));

      const formattedTrue = formatActionDetail({
        id: "test.output-true",
        outputSchema: true,
      });
      assert.ok((formattedTrue).includes("Output Schema:\ntrue"));
    });

    it("验证 InputError 与 FlatInputError 的继承关系与分类", () => {
      const errJson = invalidJson("bad json");
      const errNotFound = inputFileNotFound("missing.json");
      const errReadFailed = inputFileReadFailed("bad.json", new Error("io error"));
      const errConflict = inputConflict("conflict");

      assert.ok(errJson instanceof InputError);
      assert.ok(!(errJson instanceof FlatInputError));
      assert.ok(errNotFound instanceof InputError);
      assert.ok(!(errNotFound instanceof FlatInputError));
      assert.ok(errReadFailed instanceof InputError);
      assert.ok(!(errReadFailed instanceof FlatInputError));
      assert.ok(errConflict instanceof InputError);
      assert.ok(!(errConflict instanceof FlatInputError));

      const errFlatArg = invalidFlatArgument("bad arg");
      const errLiteral = invalidJsonLiteral("bad literal");
      const errPath = inputPathConflict("path conflict");
      const errLimit = flatInputLimitExceeded("limit exceeded");

      assert.ok(errFlatArg instanceof FlatInputError);
      assert.ok(errFlatArg instanceof InputError);
      assert.ok(errLiteral instanceof FlatInputError);
      assert.ok(errLiteral instanceof InputError);
      assert.ok(errPath instanceof FlatInputError);
      assert.ok(errPath instanceof InputError);
      assert.ok(errLimit instanceof FlatInputError);
      assert.ok(errLimit instanceof InputError);
    });
  });
});
