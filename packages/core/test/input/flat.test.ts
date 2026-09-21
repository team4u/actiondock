import { describe, expect, it } from "bun:test";
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
  FlatInputError,
  INVALID_FLAT_ARGUMENT,
  INVALID_JSON_LITERAL,
  INPUT_PATH_CONFLICT,
  FLAT_INPUT_LIMIT_EXCEEDED,
  INPUT_CONFLICT,
} from "../../src/input";

describe("Flat JsonValue Encoding v1", () => {
  describe("字符串赋值（=）", () => {
    it("正确物化普通字符串", () => {
      const res = decodeFlatInput(["name=alice", "city=beijing"]);
      expect(res).toEqual({ name: "alice", city: "beijing" });
    });

    it("正确处理包含空格、等号与冒号的复杂字符串", () => {
      const res = decodeFlatInput([
        "query=foo=bar:=baz",
        "msg=hello world: 123",
        "url=https://example.com/api?a=1&b=2",
      ]);
      expect(res).toEqual({
        query: "foo=bar:=baz",
        msg: "hello world: 123",
        url: "https://example.com/api?a=1&b=2",
      });
    });

    it("保留数字字符串为原始字符串类型", () => {
      const res = decodeFlatInput(["num=123", "float=45.67"]);
      expect(res).toEqual({ num: "123", float: "45.67" });
    });

    it("保留布尔值字符串为原始字符串类型", () => {
      const res = decodeFlatInput(["t=true", "f=false"]);
      expect(res).toEqual({ t: "true", f: "false" });
    });

    it("保留 JSON 结构字符串为原始字符串类型", () => {
      const res = decodeFlatInput(['json={"x":1}', "arr=[1,2,3]"]);
      expect(res).toEqual({ json: '{"x":1}', arr: "[1,2,3]" });
    });

    it("允许空字符串赋值", () => {
      const res = decodeFlatInput(["empty="]);
      expect(res).toEqual({ empty: "" });
    });
  });

  describe("JSON 赋值（:=）", () => {
    it("正确解析数值类型", () => {
      const res = decodeFlatInput(["n1:=123", "n2:=-45.6", "n3:=0", "n4:=1e5"]);
      expect(res).toEqual({ n1: 123, n2: -45.6, n3: 0, n4: 100000 });
    });

    it("正确解析布尔值与 null", () => {
      const res = decodeFlatInput(["t:=true", "f:=false", "n:=null"]);
      expect(res).toEqual({ t: true, f: false, n: null });
    });

    it("正确解析 JSON 字符串字面量", () => {
      const res = decodeFlatInput(['s:="hello"']);
      expect(res).toEqual({ s: "hello" });
    });

    it("正确解析数组与嵌套对象", () => {
      const res = decodeFlatInput([
        "arr:=[1, 2, 3]",
        'obj:={"x": 1, "y": [true, "nested"]}',
      ]);
      expect(res).toEqual({
        arr: [1, 2, 3],
        obj: { x: 1, y: [true, "nested"] },
      });
    });

    it("拒绝非法 JSON 字面量并抛出 INVALID_JSON_LITERAL", () => {
      expect(() => decodeFlatInput(["bad:=invalid_json"])).toThrow(FlatInputError);
      try {
        decodeFlatInput(["bad:=invalid_json"]);
      } catch (err: any) {
        expect(err.code).toBe(INVALID_JSON_LITERAL);
      }
    });

    it("拒绝非有限数值（如 1e999、Infinity、NaN）并抛出 INVALID_JSON_LITERAL", () => {
      expect(() => decodeFlatInput(["inf:=1e999"])).toThrow(FlatInputError);
      try {
        decodeFlatInput(["inf:=1e999"]);
      } catch (err: any) {
        expect(err.code).toBe(INVALID_JSON_LITERAL);
      }

      expect(() => decodeFlatInput(["arr:=[1, 1e999]"])).toThrow(FlatInputError);
      try {
        decodeFlatInput(["arr:=[1, 1e999]"]);
      } catch (err: any) {
        expect(err.code).toBe(INVALID_JSON_LITERAL);
      }

      expect(() => decodeFlatInput(['obj:={"val": 1e999}'])).toThrow(FlatInputError);
      try {
        decodeFlatInput(['obj:={"val": 1e999}']);
      } catch (err: any) {
        expect(err.code).toBe(INVALID_JSON_LITERAL);
      }
    });
  });

  describe("对象与数组路径", () => {
    it("物化单级与多级对象", () => {
      const res = decodeFlatInput(["name=alice", "a.b.c=1", "a.b.d=2"]);
      expect(res).toEqual({
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
      expect(res).toEqual({ items: ["first", "second"] });
    });

    it("物化多维数组", () => {
      const res = decodeFlatInput([
        "matrix.0.0=1",
        "matrix.0.1=2",
        "matrix.1.0=3",
        "matrix.1.1=4",
      ]);
      expect(res).toEqual({
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
      expect(res).toEqual({
        users: [
          { name: "alice", tags: ["admin", "dev"] },
          { name: "bob", tags: ["user"] },
        ],
      });
    });
  });

  describe("非法索引拒绝", () => {
    it("拒绝带有前导零的数组索引", () => {
      expect(() => decodeFlatInput(["items.00=1"])).toThrow(FlatInputError);
      try {
        decodeFlatInput(["items.00=1"]);
      } catch (err: any) {
        expect(err.code).toBe(INVALID_FLAT_ARGUMENT);
      }

      expect(() => decodeFlatInput(["items.01=1"])).toThrow(FlatInputError);
      try {
        decodeFlatInput(["items.01=1"]);
      } catch (err: any) {
        expect(err.code).toBe(INVALID_FLAT_ARGUMENT);
      }
    });

    it("拒绝负数索引与科学计数法索引", () => {
      expect(() => decodeFlatInput(["items.-1=1"])).toThrow(FlatInputError);
      try {
        decodeFlatInput(["items.-1=1"]);
      } catch (err: any) {
        expect(err.code).toBe(INVALID_FLAT_ARGUMENT);
      }

      expect(() => decodeFlatInput(["items.1e2=1"])).toThrow(FlatInputError);
      try {
        decodeFlatInput(["items.1e2=1"]);
      } catch (err: any) {
        expect(err.code).toBe(INVALID_FLAT_ARGUMENT);
      }
    });

    it("拒绝根节点为数组索引并抛出 INPUT_PATH_CONFLICT", () => {
      expect(() => decodeFlatInput(["0=foo"])).toThrow(FlatInputError);
      try {
        decodeFlatInput(["0=foo"]);
      } catch (err: any) {
        expect(err.code).toBe(INPUT_PATH_CONFLICT);
      }
    });
  });

  describe("安全属性拦截", () => {
    it("拦截 __proto__ 危险属性", () => {
      expect(() => decodeFlatInput(["__proto__=1"])).toThrow(FlatInputError);
      try {
        decodeFlatInput(["__proto__=1"]);
      } catch (err: any) {
        expect(err.code).toBe(INVALID_FLAT_ARGUMENT);
      }

      expect(() => decodeFlatInput(["a.__proto__.b=1"])).toThrow(FlatInputError);
      try {
        decodeFlatInput(["a.__proto__.b=1"]);
      } catch (err: any) {
        expect(err.code).toBe(INVALID_FLAT_ARGUMENT);
      }
    });

    it("拦截 constructor 危险属性", () => {
      expect(() => decodeFlatInput(["constructor=1"])).toThrow(FlatInputError);
      try {
        decodeFlatInput(["constructor=1"]);
      } catch (err: any) {
        expect(err.code).toBe(INVALID_FLAT_ARGUMENT);
      }

      expect(() => decodeFlatInput(["a.constructor.b=1"])).toThrow(FlatInputError);
      try {
        decodeFlatInput(["a.constructor.b=1"]);
      } catch (err: any) {
        expect(err.code).toBe(INVALID_FLAT_ARGUMENT);
      }
    });

    it("拦截 prototype 危险属性", () => {
      expect(() => decodeFlatInput(["prototype=1"])).toThrow(FlatInputError);
      try {
        decodeFlatInput(["prototype=1"]);
      } catch (err: any) {
        expect(err.code).toBe(INVALID_FLAT_ARGUMENT);
      }

      expect(() => decodeFlatInput(["a.prototype.b=1"])).toThrow(FlatInputError);
      try {
        decodeFlatInput(["a.prototype.b=1"]);
      } catch (err: any) {
        expect(err.code).toBe(INVALID_FLAT_ARGUMENT);
      }
    });
  });

  describe("路径冲突拒绝", () => {
    it("拒绝叶节点与容器节点冲突（先叶后容器）", () => {
      expect(() => decodeFlatInput(["a=1", "a.b=2"])).toThrow(FlatInputError);
      try {
        decodeFlatInput(["a=1", "a.b=2"]);
      } catch (err: any) {
        expect(err.code).toBe(INPUT_PATH_CONFLICT);
      }
    });

    it("拒绝容器节点与叶节点冲突（先容器后叶）", () => {
      expect(() => decodeFlatInput(["a.b=2", "a=1"])).toThrow(FlatInputError);
      try {
        decodeFlatInput(["a.b=2", "a=1"]);
      } catch (err: any) {
        expect(err.code).toBe(INPUT_PATH_CONFLICT);
      }
    });

    it("拒绝对象与数组冲突（先对象后数组）", () => {
      expect(() => decodeFlatInput(["a.b=1", "a.0=2"])).toThrow(FlatInputError);
      try {
        decodeFlatInput(["a.b=1", "a.0=2"]);
      } catch (err: any) {
        expect(err.code).toBe(INPUT_PATH_CONFLICT);
      }
    });

    it("拒绝数组与对象冲突（先数组后对象）", () => {
      expect(() => decodeFlatInput(["a.0=1", "a.b=2"])).toThrow(FlatInputError);
      try {
        decodeFlatInput(["a.0=1", "a.b=2"]);
      } catch (err: any) {
        expect(err.code).toBe(INPUT_PATH_CONFLICT);
      }
    });

    it("拒绝重复叶节点赋值（不同值）", () => {
      expect(() => decodeFlatInput(["a=1", "a=2"])).toThrow(FlatInputError);
      try {
        decodeFlatInput(["a=1", "a=2"]);
      } catch (err: any) {
        expect(err.code).toBe(INPUT_PATH_CONFLICT);
      }
    });

    it("拒绝重复叶节点赋值（相同值）", () => {
      expect(() => decodeFlatInput(["a=1", "a=1"])).toThrow(FlatInputError);
      try {
        decodeFlatInput(["a=1", "a=1"]);
      } catch (err: any) {
        expect(err.code).toBe(INPUT_PATH_CONFLICT);
      }
    });
  });

  describe("稀疏数组拒绝", () => {
    it("拒绝缺失起始索引 0", () => {
      expect(() => decodeFlatInput(["items.1=foo"])).toThrow(FlatInputError);
      try {
        decodeFlatInput(["items.1=foo"]);
      } catch (err: any) {
        expect(err.code).toBe(INPUT_PATH_CONFLICT);
      }
    });

    it("拒绝中间缺失索引（如存在 0 与 2 但缺失 1）", () => {
      expect(() => decodeFlatInput(["items.0=foo", "items.2=bar"])).toThrow(
        FlatInputError
      );
      try {
        decodeFlatInput(["items.0=foo", "items.2=bar"]);
      } catch (err: any) {
        expect(err.code).toBe(INPUT_PATH_CONFLICT);
      }
    });
  });

  describe("资源限制拦截", () => {
    it("拦截赋值总数超限", () => {
      expect(() =>
        parseFlatAssignments(["a=1", "b=2"], { maxAssignments: 1 })
      ).toThrow(FlatInputError);
      try {
        parseFlatAssignments(["a=1", "b=2"], { maxAssignments: 1 });
      } catch (err: any) {
        expect(err.code).toBe(FLAT_INPUT_LIMIT_EXCEEDED);
      }
    });

    it("拦截路径深度超限", () => {
      expect(() =>
        parseFlatAssignments(["a.b.c=1"], { maxPathDepth: 2 })
      ).toThrow(FlatInputError);
      try {
        parseFlatAssignments(["a.b.c=1"], { maxPathDepth: 2 });
      } catch (err: any) {
        expect(err.code).toBe(FLAT_INPUT_LIMIT_EXCEEDED);
      }
    });

    it("拦截路径长度超限", () => {
      expect(() =>
        parseFlatAssignments(["abcdef=1"], { maxPathLength: 4 })
      ).toThrow(FlatInputError);
      try {
        parseFlatAssignments(["abcdef=1"], { maxPathLength: 4 });
      } catch (err: any) {
        expect(err.code).toBe(FLAT_INPUT_LIMIT_EXCEEDED);
      }
    });

    it("拦截属性名长度超限", () => {
      expect(() =>
        parseFlatAssignments(["verylongname=1"], { maxPropertyKeyLength: 5 })
      ).toThrow(FlatInputError);
      try {
        parseFlatAssignments(["verylongname=1"], { maxPropertyKeyLength: 5 });
      } catch (err: any) {
        expect(err.code).toBe(FLAT_INPUT_LIMIT_EXCEEDED);
      }
    });

    it("拦截原始值长度超限", () => {
      expect(() =>
        parseFlatAssignments(["k=toolongvalue"], { maxRawValueLength: 5 })
      ).toThrow(FlatInputError);
      try {
        parseFlatAssignments(["k=toolongvalue"], { maxRawValueLength: 5 });
      } catch (err: any) {
        expect(err.code).toBe(FLAT_INPUT_LIMIT_EXCEEDED);
      }
    });

    it("拦截 JSON 字面量大小超限", () => {
      expect(() =>
        parseFlatAssignments(['k:="toolongjson"'], { maxJsonLiteralLength: 5 })
      ).toThrow(FlatInputError);
      try {
        parseFlatAssignments(['k:="toolongjson"'], { maxJsonLiteralLength: 5 });
      } catch (err: any) {
        expect(err.code).toBe(FLAT_INPUT_LIMIT_EXCEEDED);
      }
    });

    it("拦截数组索引数值超限", () => {
      expect(() =>
        parseFlatAssignments(["items.100=1"], { maxArrayIndex: 50 })
      ).toThrow(FlatInputError);
      try {
        parseFlatAssignments(["items.100=1"], { maxArrayIndex: 50 });
      } catch (err: any) {
        expect(err.code).toBe(FLAT_INPUT_LIMIT_EXCEEDED);
      }
    });

    it("拦截物化后总大小超限", () => {
      const assignments = parseFlatAssignments(["a=hello_world_text"]);
      expect(() =>
        materializeFlatInput(assignments, { maxMaterializedSizeBytes: 5 })
      ).toThrow(FlatInputError);
      try {
        materializeFlatInput(assignments, { maxMaterializedSizeBytes: 5 });
      } catch (err: any) {
        expect(err.code).toBe(FLAT_INPUT_LIMIT_EXCEEDED);
      }
    });
  });

  describe("输入源互斥", () => {
    it("拒绝同时指定 flatArgs 与 input", async () => {
      await expect(
        resolveActionInput({ flatArgs: ["a=1"], input: '{"b":2}' })
      ).rejects.toThrow(FlatInputError);
      try {
        await resolveActionInput({ flatArgs: ["a=1"], input: '{"b":2}' });
      } catch (err: any) {
        expect(err.code).toBe(INPUT_CONFLICT);
      }
    });

    it("拒绝同时指定 flatArgs 与 inputFile", async () => {
      await expect(
        resolveActionInput({ flatArgs: ["a=1"], inputFile: "test.json" })
      ).rejects.toThrow(FlatInputError);
      try {
        await resolveActionInput({ flatArgs: ["a=1"], inputFile: "test.json" });
      } catch (err: any) {
        expect(err.code).toBe(INPUT_CONFLICT);
      }
    });

    it("拒绝同时指定 input 与 inputFile", async () => {
      await expect(
        resolveActionInput({ input: '{"a":1}', inputFile: "test.json" })
      ).rejects.toThrow(FlatInputError);
      try {
        await resolveActionInput({ input: '{"a":1}', inputFile: "test.json" });
      } catch (err: any) {
        expect(err.code).toBe(INPUT_CONFLICT);
      }
    });

    it("拒绝同时指定全部三种输入源", async () => {
      await expect(
        resolveActionInput({
          flatArgs: ["a=1"],
          input: '{"b":2}',
          inputFile: "test.json",
        })
      ).rejects.toThrow(FlatInputError);
      try {
        await resolveActionInput({
          flatArgs: ["a=1"],
          input: '{"b":2}',
          inputFile: "test.json",
        });
      } catch (err: any) {
        expect(err.code).toBe(INPUT_CONFLICT);
      }
    });

    it("仅指定 flatArgs 时成功物化", async () => {
      const res = await resolveActionInput({ flatArgs: ["name=bob", "age:=30"] });
      expect(res).toEqual({ name: "bob", age: 30 });
    });

    it("仅指定 input 时正确解析（支持 BOM 剥离）", async () => {
      const withoutBom = await resolveActionInput({ input: '{"key": "val"}' });
      expect(withoutBom).toEqual({ key: "val" });

      const withBom = await resolveActionInput({ input: '\uFEFF{"key": "bom_val"}' });
      expect(withBom).toEqual({ key: "bom_val" });
    });

    it("仅指定 inputFile 读取物理文件正确解析", async () => {
      const testFilePath = join(tmpdir(), `test-input-${Date.now()}.json`);
      writeFileSync(testFilePath, '\uFEFF{"fileKey": "fileVal"}', "utf8");
      try {
        const res = await resolveActionInput({ inputFile: testFilePath });
        expect(res).toEqual({ fileKey: "fileVal" });
      } finally {
        unlinkSync(testFilePath);
      }
    });

    it("仅指定 inputFile 为 '-' 时从 stdin 读取并正确解析", async () => {
      const stream = Readable.from(['\uFEFF{"fromStdin": true}']);
      const res = await resolveActionInput({ inputFile: "-", stdin: stream });
      expect(res).toEqual({ fromStdin: true });
    });

    it("均未指定时返回空对象 {}", async () => {
      const res = await resolveActionInput({});
      expect(res).toEqual({});
    });
  });

  describe("赋值顺序无关性", () => {
    it("对象属性不同赋值顺序产生完全相同结果", () => {
      const order1 = decodeFlatInput(["a=1", "b=2", "c=3"]);
      const order2 = decodeFlatInput(["c=3", "a=1", "b=2"]);
      const order3 = decodeFlatInput(["b=2", "c=3", "a=1"]);

      expect(order1).toEqual({ a: "1", b: "2", c: "3" });
      expect(order2).toEqual({ a: "1", b: "2", c: "3" });
      expect(order3).toEqual({ a: "1", b: "2", c: "3" });
      expect(JSON.stringify(order1)).toBe(JSON.stringify(order2));
      expect(JSON.stringify(order2)).toBe(JSON.stringify(order3));
    });

    it("数组元素不同赋值顺序产生完全相同结果", () => {
      const order1 = decodeFlatInput(["items.0=first", "items.1=second"]);
      const order2 = decodeFlatInput(["items.1=second", "items.0=first"]);

      expect(order1).toEqual({ items: ["first", "second"] });
      expect(order2).toEqual({ items: ["first", "second"] });
      expect(JSON.stringify(order1)).toBe(JSON.stringify(order2));
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

      expect(order1).toEqual(order2);
      expect(JSON.stringify(order1)).toBe(JSON.stringify(order2));
    });
  });

  describe("fuzz / 极限边界", () => {
    it("空 tokens 数组返回空对象", () => {
      expect(decodeFlatInput([])).toEqual({});
    });

    it("支持值中包含特殊字符、Unicode、Emoji 与换行符", () => {
      const res = decodeFlatInput([
        "unicode=你好世界，ActionDock！",
        "emoji=🚀✨💡",
        "newline=line1\nline2\nline3",
        "escapes=\t\r\\",
      ]);
      expect(res).toEqual({
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
        expect(() => decodeFlatInput([token])).toThrow(FlatInputError);
        try {
          decodeFlatInput([token]);
        } catch (err: any) {
          expect(err.code).toBe(INVALID_FLAT_ARGUMENT);
        }
      }
    });

    it("拒绝缺少赋值操作符的 token", () => {
      expect(() => decodeFlatInput(["no_operator"])).toThrow(FlatInputError);
      try {
        decodeFlatInput(["no_operator"]);
      } catch (err: any) {
        expect(err.code).toBe(INVALID_FLAT_ARGUMENT);
      }
    });

    it("拒绝空路径的 token", () => {
      expect(() => decodeFlatInput(["=value"])).toThrow(FlatInputError);
      try {
        decodeFlatInput(["=value"]);
      } catch (err: any) {
        expect(err.code).toBe(INVALID_FLAT_ARGUMENT);
      }

      expect(() => decodeFlatInput([":=123"])).toThrow(FlatInputError);
      try {
        decodeFlatInput([":=123"]);
      } catch (err: any) {
        expect(err.code).toBe(INVALID_FLAT_ARGUMENT);
      }
    });
  });
});
