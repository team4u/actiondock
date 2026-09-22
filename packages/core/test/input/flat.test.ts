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
  InputError,
  FlatInputError,
  INVALID_FLAT_ARGUMENT,
  INVALID_JSON,
  INVALID_JSON_LITERAL,
  INPUT_PATH_CONFLICT,
  FLAT_INPUT_LIMIT_EXCEEDED,
  INPUT_CONFLICT,
  buildActionInputAdvice,
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
    it("拦截 __proto__ 危险属性并带上 FORBIDDEN_PROPERTY 根因", () => {
      expect(() => decodeFlatInput(["__proto__=1"])).toThrow(FlatInputError);
      try {
        decodeFlatInput(["__proto__=1"]);
      } catch (err: any) {
        expect(err.code).toBe(INVALID_FLAT_ARGUMENT);
        expect(err.details?.reason).toBe("FORBIDDEN_PROPERTY");
      }

      expect(() => decodeFlatInput(["a.__proto__.b=1"])).toThrow(FlatInputError);
      try {
        decodeFlatInput(["a.__proto__.b=1"]);
      } catch (err: any) {
        expect(err.code).toBe(INVALID_FLAT_ARGUMENT);
        expect(err.details?.reason).toBe("FORBIDDEN_PROPERTY");
      }
    });

    it("拦截 constructor 危险属性并带上 FORBIDDEN_PROPERTY 根因", () => {
      expect(() => decodeFlatInput(["constructor=1"])).toThrow(FlatInputError);
      try {
        decodeFlatInput(["constructor=1"]);
      } catch (err: any) {
        expect(err.code).toBe(INVALID_FLAT_ARGUMENT);
        expect(err.details?.reason).toBe("FORBIDDEN_PROPERTY");
      }

      expect(() => decodeFlatInput(["a.constructor.b=1"])).toThrow(FlatInputError);
      try {
        decodeFlatInput(["a.constructor.b=1"]);
      } catch (err: any) {
        expect(err.code).toBe(INVALID_FLAT_ARGUMENT);
        expect(err.details?.reason).toBe("FORBIDDEN_PROPERTY");
      }
    });

    it("拦截 prototype 危险属性并带上 FORBIDDEN_PROPERTY 根因", () => {
      expect(() => decodeFlatInput(["prototype=1"])).toThrow(FlatInputError);
      try {
        decodeFlatInput(["prototype=1"]);
      } catch (err: any) {
        expect(err.code).toBe(INVALID_FLAT_ARGUMENT);
        expect(err.details?.reason).toBe("FORBIDDEN_PROPERTY");
      }

      expect(() => decodeFlatInput(["a.prototype.b=1"])).toThrow(FlatInputError);
      try {
        decodeFlatInput(["a.prototype.b=1"]);
      } catch (err: any) {
        expect(err.code).toBe(INVALID_FLAT_ARGUMENT);
        expect(err.details?.reason).toBe("FORBIDDEN_PROPERTY");
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
      ).rejects.toThrow(InputError);
      try {
        await resolveActionInput({ flatArgs: ["a=1"], input: '{"b":2}' });
      } catch (err: any) {
        expect(err).toBeInstanceOf(InputError);
        expect(err).not.toBeInstanceOf(FlatInputError);
        expect(err.code).toBe(INPUT_CONFLICT);
      }
    });

    it("拒绝同时指定 flatArgs 与 inputFile", async () => {
      await expect(
        resolveActionInput({ flatArgs: ["a=1"], inputFile: "test.json" })
      ).rejects.toThrow(InputError);
      try {
        await resolveActionInput({ flatArgs: ["a=1"], inputFile: "test.json" });
      } catch (err: any) {
        expect(err).toBeInstanceOf(InputError);
        expect(err).not.toBeInstanceOf(FlatInputError);
        expect(err.code).toBe(INPUT_CONFLICT);
      }
    });

    it("拒绝同时指定 input 与 inputFile", async () => {
      await expect(
        resolveActionInput({ input: '{"a":1}', inputFile: "test.json" })
      ).rejects.toThrow(InputError);
      try {
        await resolveActionInput({ input: '{"a":1}', inputFile: "test.json" });
      } catch (err: any) {
        expect(err).toBeInstanceOf(InputError);
        expect(err).not.toBeInstanceOf(FlatInputError);
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
      ).rejects.toThrow(InputError);
      try {
        await resolveActionInput({
          flatArgs: ["a=1"],
          input: '{"b":2}',
          inputFile: "test.json",
        });
      } catch (err: any) {
        expect(err).toBeInstanceOf(InputError);
        expect(err).not.toBeInstanceOf(FlatInputError);
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

  describe("错误信息脱敏（避免回显完整参数值）", () => {
    it("路径冲突异常严禁在错误信息与 details 中回显敏感参数明文", () => {
      const secret = "super_secret_api_key_123456";
      let caughtErr: any;
      try {
        decodeFlatInput([`auth.token=${secret}`, `auth.token.secret=true`]);
      } catch (err: any) {
        caughtErr = err;
      }
      expect(caughtErr).toBeDefined();
      expect(caughtErr.code).toBe(INPUT_PATH_CONFLICT);
      expect(caughtErr.message).not.toContain(secret);
      expect(JSON.stringify(caughtErr.details || {})).not.toContain(secret);
      expect(caughtErr.details.path).toBe("auth.token");
      expect(caughtErr.details.valueLength).toBe(Buffer.byteLength("true", "utf8"));
    });

    it("JSON 字面量解析失败严禁在错误信息与 details 中回显敏感内容", () => {
      const sensitiveToken = "my_sensitive_unquoted_payload";
      let caughtErr: any;
      try {
        decodeFlatInput([`password:=${sensitiveToken}`]);
      } catch (err: any) {
        caughtErr = err;
      }
      expect(caughtErr).toBeDefined();
      expect(caughtErr.code).toBe(INVALID_JSON_LITERAL);
      expect(caughtErr.message).not.toContain(sensitiveToken);
      expect(JSON.stringify(caughtErr.details || {})).not.toContain(sensitiveToken);
      expect(caughtErr.details.path).toBe("password");
      expect(caughtErr.details.operator).toBe(":=");
      expect(caughtErr.details.valueLength).toBe(Buffer.byteLength(sensitiveToken, "utf8"));
    });

    it("空路径异常严禁在 details 中回显未经脱敏的参数明文", () => {
      const sensitiveVal = "super_secret_unassociated_value";
      let caughtErr: any;
      try {
        decodeFlatInput([`=${sensitiveVal}`]);
      } catch (err: any) {
        caughtErr = err;
      }
      expect(caughtErr).toBeDefined();
      expect(caughtErr.code).toBe(INVALID_FLAT_ARGUMENT);
      expect(caughtErr.message).not.toContain(sensitiveVal);
      expect(JSON.stringify(caughtErr.details || {})).not.toContain(sensitiveVal);
    });
  });

  describe("INVALID_JSON 与 INVALID_JSON_LITERAL 独立断言", () => {
    it("--input 完整文档解析失败抛出 INVALID_JSON", async () => {
      await expect(resolveActionInput({ input: "{bad json}" })).rejects.toThrow(
        InputError
      );
      try {
        await resolveActionInput({ input: "{bad json}" });
      } catch (err: any) {
        expect(err.code).toBe(INVALID_JSON);
      }
    });

    it("--input 包含 1e400 (Infinity) 或深度超限抛出 INVALID_JSON", async () => {
      await expect(resolveActionInput({ input: "1e400" })).rejects.toThrow(InputError);
      try {
        await resolveActionInput({ input: "1e400" });
      } catch (err: any) {
        expect(err.code).toBe(INVALID_JSON);
        expect(err.message).toContain("Number is non-finite or NaN");
      }

      // 深度超过 256
      let deep = "1";
      for (let i = 0; i < 260; i++) {
        deep = `{"inner":${deep}}`;
      }
      await expect(resolveActionInput({ input: deep })).rejects.toThrow(InputError);
      try {
        await resolveActionInput({ input: deep });
      } catch (err: any) {
        expect(err.code).toBe(INVALID_JSON);
        expect(err.message).toContain("Max JSON depth limit");
      }
    });

    it("--input-file 完整文档解析失败抛出 INVALID_JSON", async () => {
      const testFile = join(tmpdir(), `test-invalid-${Date.now()}.json`);
      writeFileSync(testFile, "invalid json document", "utf8");
      try {
        await expect(resolveActionInput({ inputFile: testFile })).rejects.toThrow(
          InputError
        );
        try {
          await resolveActionInput({ inputFile: testFile });
        } catch (err: any) {
          expect(err.code).toBe(INVALID_JSON);
        }
      } finally {
        unlinkSync(testFile);
      }
    });

    it("stdin 完整文档解析失败抛出 INVALID_JSON", async () => {
      const stream = Readable.from(["not a valid json"]);
      await expect(
        resolveActionInput({ inputFile: "-", stdin: stream })
      ).rejects.toThrow(InputError);
      try {
        const stream2 = Readable.from(["not a valid json"]);
        await resolveActionInput({ inputFile: "-", stdin: stream2 });
      } catch (err: any) {
        expect(err.code).toBe(INVALID_JSON);
      }
    });

    it("仅 path:=json 字面量解析失败抛出 INVALID_JSON_LITERAL", () => {
      expect(() => decodeFlatInput(["num:=not_json"])).toThrow(FlatInputError);
      try {
        decodeFlatInput(["num:=not_json"]);
      } catch (err: any) {
        expect(err.code).toBe(INVALID_JSON_LITERAL);
      }
    });
  });

  describe("空数组安全处理", () => {
    it("空 flatArgs 数组不会与 input 发生互斥冲突", async () => {
      const res = await resolveActionInput({ flatArgs: [], input: '{"hello":"world"}' });
      expect(res).toEqual({ hello: "world" });
    });

    it("空 flatArgs 数组不会与 inputFile 发生互斥冲突", async () => {
      const testFile = join(tmpdir(), `test-empty-flat-${Date.now()}.json`);
      writeFileSync(testFile, '{"fromFile":true}', "utf8");
      try {
        const res = await resolveActionInput({ flatArgs: [], inputFile: testFile });
        expect(res).toEqual({ fromFile: true });
      } finally {
        unlinkSync(testFile);
      }
    });
  });

  describe("聚合预算预检与字节级资源限制", () => {
    it("拦截累计原始输入总字节数超限", () => {
      expect(() =>
        parseFlatAssignments(["a=123", "b=456"], { maxTotalRawBytes: 5 })
      ).toThrow(FlatInputError);
      try {
        parseFlatAssignments(["a=123", "b=456"], { maxTotalRawBytes: 5 });
      } catch (err: any) {
        expect(err.code).toBe(FLAT_INPUT_LIMIT_EXCEEDED);
        expect(err.message).toContain("Total raw input bytes");
      }
    });
  });

  describe("编码顾问（Encoding Advisor）与格式化渲染", () => {
    it("根模式为 object 且有合法属性时返回 flatSupported: true 并生成正确建议", () => {
      const schema = {
        type: "object",
        properties: {
          name: { type: "string", description: "用户名称" },
          age: { type: "number", description: "年龄" },
          active: { type: "boolean", description: "是否激活" },
          tags: {
            type: "array",
            items: { type: "string" },
            description: "标签列表",
          },
          meta: {
            type: "object",
            description: "元数据",
          },
        },
        required: ["name"],
      };

      const advice = buildActionInputAdvice(schema);
      expect(advice.flatSupported).toBe(true);
      expect(advice.hasFlatFields).toBe(true);
      expect(advice.requiredTemplates).toEqual(["name=TEXT"]);
      expect(advice.optionalTemplates).toContain("age:=NUMBER");
      expect(advice.optionalTemplates).toContain("active:=BOOLEAN");
      expect(advice.optionalTemplates).toContain("tags.0=TEXT");
      expect(advice.optionalTemplates).toContain("meta:=JSON");

      const metaField = advice.fields.find((f) => f.path === "meta");
      expect(metaField).toBeDefined();
      expect(metaField?.flatSafe).toBe(true);
      expect(metaField?.assignmentTemplate).toBe("meta:=JSON");
      expect(metaField?.hint).toBe("大型结构建议使用 --input-file");
    });

    it("根模式为 array 时降级提示使用 --input-file", () => {
      const schema = {
        type: "array",
        items: { type: "string" },
      };

      const advice = buildActionInputAdvice(schema);
      expect(advice.flatSupported).toBe(false);
      expect(advice.hasFlatFields).toBe(false);
      expect(advice.notes.some((n) => n.includes("--input-file"))).toBe(true);
    });

    it("根模式为基本类型时降级提示使用 --input-file", () => {
      const schema = {
        type: "string",
      };

      const advice = buildActionInputAdvice(schema);
      expect(advice.flatSupported).toBe(false);
      expect(advice.hasFlatFields).toBe(false);
      expect(advice.notes.some((n) => n.includes("--input-file"))).toBe(true);
    });

    it("根模式为无声明属性对象时降级提示使用 --input-file", () => {
      const schema = {
        type: "object",
        properties: {},
      };

      const advice = buildActionInputAdvice(schema);
      expect(advice.flatSupported).toBe(false);
      expect(advice.hasFlatFields).toBe(false);
      expect(advice.notes.some((n) => n.includes("--input-file"))).toBe(true);
    });

    it("属性名包含非安全字符时跳过扁平建议并添加提示", () => {
      const schema = {
        type: "object",
        properties: {
          "user name": { type: "string" },
          "valid_key": { type: "string" },
        },
      };

      const advice = buildActionInputAdvice(schema);
      expect(advice.flatSupported).toBe(true);
      expect(advice.hasFlatFields).toBe(true);
      expect(advice.optionalTemplates).toContain("valid_key=TEXT");
      expect(advice.optionalTemplates).not.toContain("user name=TEXT");
      const unsafeField = advice.fields.find((f) => f.path === "user name");
      expect(unsafeField?.flatSafe).toBe(false);
      expect(unsafeField?.assignmentTemplate).toBeUndefined();
      expect(advice.notes.some((n) => n.includes("user name"))).toBe(true);
    });

    it("含有非 flat-safe required 字段时 flatSupported 为 false", () => {
      const schema = {
        type: "object",
        properties: {
          "user name": { type: "string" },
          valid_key: { type: "string" },
        },
        required: ["user name"],
      };

      const advice = buildActionInputAdvice(schema);
      expect(advice.flatSupported).toBe(false);
      expect(advice.hasFlatFields).toBe(true);
      expect(advice.notes.some((n) => n.includes("user name"))).toBe(true);
    });

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

      expect(formatted).toContain("Action: sample.create");
      expect(formatted).toContain("Recommended Input: flat");
      expect(formatted).toContain("Assignments:");
      expect(formatted).toContain("  name=");
      expect(formatted).toContain("  age:=");
      expect(formatted).toContain("  meta:=");
    });

    it("不支持扁平传参时在调用模式引导中明确推荐 full-json 并给出原因", () => {
      const formatted = formatActionDetail({
        id: "sample.array",
        inputSchema: {
          type: "array",
          items: { type: "string" },
        },
      });

      expect(formatted).toContain("Action: sample.array");
      expect(formatted).toContain("Recommended Input: full-json");
      expect(formatted).toContain("Reason: NON_OBJECT_SCHEMA");
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

      expect(formatted).toContain("Action: test.action");
      expect(formatted).toContain("Package: test.pkg");
      expect(formatted).toContain("Description: 测试动作");
      expect(formatted).toContain("Recommended Input: flat");
      expect(formatted).toContain("Assignments:\n  title=");
    });

    it("布尔模式 false 返回拒绝所有输入建议报告", () => {
      const advice = buildActionInputAdvice(false);
      expect(advice.flatSupported).toBe(false);
      expect(advice.hasFlatFields).toBe(false);
      expect(advice.fields).toEqual([]);
      expect(advice.requiredTemplates).toEqual([]);
      expect(advice.optionalTemplates).toEqual([]);
      expect(advice.notes).toEqual([
        "布尔模式 false：拒绝所有输入，任何调用参数均判定为非法",
      ]);
    });

    it("布尔模式 true 返回接受任意合法输入建议报告", () => {
      const advice = buildActionInputAdvice(true);
      expect(advice.flatSupported).toBe(false);
      expect(advice.hasFlatFields).toBe(false);
      expect(advice.fields).toEqual([]);
      expect(advice.requiredTemplates).toEqual([]);
      expect(advice.optionalTemplates).toEqual([]);
      expect(advice.notes).toEqual([
        "布尔模式 true：接受任意合法 JSON 输入；调用时无需指定必填参数，非对象根输入请使用 --input-file 或 --input",
      ]);
    });

    it("formatActionDetail 正确渲染布尔模式 false", () => {
      const formatted = formatActionDetail({
        id: "test.bool-false",
        inputSchema: false,
      });
      expect(formatted).toContain("Action: test.bool-false");
      expect(formatted).toContain("Input Schema:\nfalse");
      expect(formatted).toContain("Recommended Input: none");
      expect(formatted).toContain("Reason: SCHEMA_REJECTS_ALL");
    });

    it("formatActionDetail 正确渲染布尔模式 true", () => {
      const formatted = formatActionDetail({
        id: "test.bool-true",
        inputSchema: true,
      });
      expect(formatted).toContain("Action: test.bool-true");
      expect(formatted).toContain("Input Schema:\ntrue");
      expect(formatted).toContain("Recommended Input: full-json");
      expect(formatted).toContain("Reason: ARBITRARY_SCHEMA");
    });

    it("formatActionDetail 正确渲染 undefined inputSchema 为无模式", () => {
      const formatted = formatActionDetail({
        id: "test.no-schema",
      });
      expect(formatted).toContain("Action: test.no-schema");
      expect(formatted).toContain("Recommended Input: full-json");
      expect(formatted).toContain("Reason: NO_SCHEMA");
    });

    it("formatActionDetail 正确渲染布尔模式 outputSchema (false 与 true)", () => {
      const formattedFalse = formatActionDetail({
        id: "test.output-false",
        outputSchema: false,
      });
      expect(formattedFalse).toContain("Output Schema:\nfalse");

      const formattedTrue = formatActionDetail({
        id: "test.output-true",
        outputSchema: true,
      });
      expect(formattedTrue).toContain("Output Schema:\ntrue");
    });

    it("验证 InputError 与 FlatInputError 的继承关系与分类", () => {
      const errJson = invalidJson("bad json");
      const errNotFound = inputFileNotFound("missing.json");
      const errReadFailed = inputFileReadFailed("bad.json", new Error("io error"));
      const errConflict = inputConflict("conflict");

      expect(errJson).toBeInstanceOf(InputError);
      expect(errJson).not.toBeInstanceOf(FlatInputError);
      expect(errNotFound).toBeInstanceOf(InputError);
      expect(errNotFound).not.toBeInstanceOf(FlatInputError);
      expect(errReadFailed).toBeInstanceOf(InputError);
      expect(errReadFailed).not.toBeInstanceOf(FlatInputError);
      expect(errConflict).toBeInstanceOf(InputError);
      expect(errConflict).not.toBeInstanceOf(FlatInputError);

      const errFlatArg = invalidFlatArgument("bad arg");
      const errLiteral = invalidJsonLiteral("bad literal");
      const errPath = inputPathConflict("path conflict");
      const errLimit = flatInputLimitExceeded("limit exceeded");

      expect(errFlatArg).toBeInstanceOf(FlatInputError);
      expect(errFlatArg).toBeInstanceOf(InputError);
      expect(errLiteral).toBeInstanceOf(FlatInputError);
      expect(errLiteral).toBeInstanceOf(InputError);
      expect(errPath).toBeInstanceOf(FlatInputError);
      expect(errPath).toBeInstanceOf(InputError);
      expect(errLimit).toBeInstanceOf(FlatInputError);
      expect(errLimit).toBeInstanceOf(InputError);
    });
  });
});
