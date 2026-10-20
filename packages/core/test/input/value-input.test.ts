import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { describe, it } from "node:test";
import { parseValueLiteral, resolveActionInput, resolveInput, resolveValueInput } from "../../src/input/input-resolver";

const stdin = (text: string) => Readable.from([Buffer.from(text)]);

describe("通用完整值与结构化输入解码", () => {
  it("Action 与完整值写入共享同一个结构化解码器", async () => {
    assert.equal(resolveActionInput, resolveInput);
    const options = { flatArgs: ["name=alice", "count:=2", "items.0.id:=1", "items.1.id:=2"] };
    const expected = { name: "alice", count: 2, items: [{ id: 1 }, { id: 2 }] };
    assert.deepEqual(await resolveInput(options), expected);
    assert.deepEqual(await resolveValueInput(options), expected);
  });

  it("完整位置值支持旧字符串语义与任意 JSON 根类型", async () => {
    for (const [text, expected] of [
      ["plain text", "plain text"], ["a=b", "a=b"], ["", ""], ["0", 0], ["false", false],
      ["null", null], ['"quoted"', "quoted"], ['[1,"two"]', [1, "two"]], ['{"host":"h"}', { host: "h" }],
    ] as const) {
      assert.deepEqual(await resolveValueInput({ value: text }), expected);
    }
    assert.equal(parseValueLiteral("not-json"), "not-json");
  });

  it("完整 stdin 值裁剪末尾换行并进行 JSON 或字符串解码", async () => {
    assert.deepEqual(await resolveValueInput({ fromStdin: true, stdin: stdin('{"port":3306}\n') }), { port: 3306 });
    assert.equal(await resolveValueInput({ fromStdin: true, stdin: stdin("line1\nline2\r\n") }), "line1\nline2");
    await assert.rejects(resolveValueInput({ fromStdin: true, stdin: stdin("") }));
  });

  it("stdin 字段始终保留原始文本，支持扁平补充字段与空内容", async () => {
    const text = "\uFEFF{\"password\":123}\r\n";
    const result = await resolveValueInput({ stdinField: "password", stdin: stdin(text), flatArgs: ["host=local", "port:=3306"] });
    assert.deepEqual(result, { host: "local", port: 3306, password: text });
    assert.deepEqual(await resolveValueInput({ stdinField: "body", stdin: stdin("") }), { body: "" });
  });

  it("多种完整值来源互斥，冲突在读取 stdin 之前被拒绝", async () => {
    const conflicts = [
      { value: "v", fromStdin: true }, { value: "v", flatArgs: ["x=1"] },
      { value: "v", stdinField: "body" }, { fromStdin: true, flatArgs: ["x=1"] },
      { fromStdin: true, stdinField: "body" },
    ];
    for (const options of conflicts) {
      let reads = 0;
      const unread = new Readable({ read() { reads++; } });
      await assert.rejects(resolveValueInput({ ...options, stdin: unread }), { code: "INPUT_CONFLICT" });
      assert.equal(reads, 0);
      unread.destroy();
    }
  });

  it("字段冲突、危险字段与扁平语法错误在读流前拒绝", async () => {
    for (const options of [
      { stdinField: "password", flatArgs: ["password=duplicate"] },
      { stdinField: "password", flatArgs: ["password.child=duplicate"] },
      { stdinField: "password", flatArgs: ["port:=not-json"] },
      { stdinField: "__proto__" }, { stdinField: "nested.password" },
    ]) {
      let reads = 0;
      const unread = new Readable({ read() { reads++; } });
      await assert.rejects(resolveValueInput({ ...options, stdin: unread }));
      assert.equal(reads, 0);
      unread.destroy();
    }
  });

  it("没有明确输入时不生成空对象，避免误覆盖旧值", async () => {
    await assert.rejects(resolveValueInput({}));
    await assert.rejects(resolveValueInput({ flatArgs: [] }));
    assert.deepEqual(await resolveValueInput({ value: "{}" }), {});
  });

  it("非有限数、危险属性和过深 JSON 不能回退为普通字符串", async () => {
    for (const value of ["1e999", '{"n":1e999}', '{"__proto__":{"polluted":true}}']) {
      await assert.rejects(resolveValueInput({ value }), { code: "INVALID_JSON" });
    }
    await assert.rejects(resolveValueInput({ value: "[[[[[[0]]]]]]", policy: { maxJsonDepth: 3 } }), { code: "INVALID_JSON" });
    assert.equal(({} as any).polluted, undefined);
  });

  it("错误诊断不包含输入原文，保留稳定错误码", async () => {
    const secret = "secret-token-must-not-appear";
    await assert.rejects(resolveValueInput({ flatArgs: [`password:=${secret}`], policy: { sanitizeInputErrors: true } }), (error: any) => {
      assert.equal(error.code, "INVALID_JSON_LITERAL");
      assert.equal(JSON.stringify(error).includes(secret), false);
      assert.equal(error.message.includes(secret), false);
      return true;
    });
  });

  it("原始 stdin 与最终对象均受大小限制，并支持取消", async () => {
    await assert.rejects(resolveValueInput({ stdinField: "body", stdin: stdin("abcdef"), policy: { maxInputBytes: 3 } }), { code: "INPUT_LIMIT_EXCEEDED" });
    await assert.rejects(resolveValueInput({ stdinField: "body", stdin: stdin('"'.repeat(10)), flatOptions: { maxMaterializedSizeBytes: 20 } }), { code: "FLAT_INPUT_LIMIT_EXCEEDED" });
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(resolveValueInput({ fromStdin: true, stdin: stdin("value"), signal: controller.signal }), { name: "AbortError" });
    await assert.rejects(resolveValueInput({ value: "value", signal: controller.signal }), { name: "AbortError" });
    await assert.rejects(resolveValueInput({ flatArgs: ["x=1"], signal: controller.signal }), { name: "AbortError" });
  });
});
