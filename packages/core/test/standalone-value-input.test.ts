import assert from "node:assert/strict";
import { describe, it, type TestContext } from "node:test";
import { Readable } from "node:stream";
import { encodeStateKey, type JsonValue } from "@actiondock/sdk";
import { FakeClock } from "@actiondock/testing";
import { createActionDock } from "../src/service/factory";
import { createNodePlatform } from "../src/platform/node";
import { StandaloneDispatcher } from "../src/runtime/standalone";
import { handleConfig, handleState, type CommandContext } from "../src/runtime/standalone-commands";
import { emitError } from "../src/runtime/standalone-help";

type ValueCommand = "config" | "state";
const packageId = "pkg.standalone-value-input";

async function createHarness(t: TestContext) {
  const clock = new FakeClock({ now: "2026-01-01T00:00:00.000Z" });
  const service = await createActionDock({
    runtimeOptions: {
      projectConfig: {
        id: packageId,
        version: "1.0.0",
        config: {
          strict: {
            schema: {
              type: "object",
              properties: { count: { type: "integer", minimum: 0 } },
              required: ["count"],
              additionalProperties: false,
            },
          },
          secret: { secret: true },
        },
      },
      inMemory: true,
      clock,
      platform: createNodePlatform({ clock }),
    },
  });
  t.after(() => service.close());
  const stdout: string[] = [];
  const stderr: string[] = [];
  const options = {
    packageId,
    version: "1.0.0",
    service,
    stdout: (message: string) => stdout.push(message),
    stderr: (message: string) => stderr.push(message),
  };
  const ctx: CommandContext = {
    service,
    options,
    writeOut: options.stdout,
    writeErr: options.stderr,
    emitError: (isJson, code, message, exitCode, errorOptions) =>
      emitError(options.stdout, options.stderr, isJson, code, message, exitCode, errorOptions),
  };
  const dispatcher = new StandaloneDispatcher(options);

  function resetOutput() {
    stdout.length = 0;
    stderr.length = 0;
  }

  async function read(command: ValueCommand, key: string, namespace = ""): Promise<JsonValue | undefined> {
    return command === "config"
      ? (await service.management!.config.get(packageId, key)).value
      : service.management!.state.get(packageId, "", key, { namespace });
  }

  async function invoke(
    command: ValueCommand,
    args: string[],
    flatArgs?: string[],
    stdinText?: string,
    signal?: AbortSignal
  ) {
    resetOutput();
    const stdin = stdinText === undefined ? undefined : Readable.from([Buffer.from(stdinText)]);
    try {
      const handler = command === "config" ? handleConfig : handleState;
      return await handler(ctx, args, flatArgs, signal, stdin);
    } finally {
      stdin?.destroy();
    }
  }

  return { clock, service, stdout, stderr, dispatcher, ctx, read, invoke, resetOutput };
}

for (const command of ["config", "state"] as const) {
  describe(`独立入口 ${command} set 值输入`, () => {
    it("分发 -- 后的扁平参数，保留字符串与 JSON 类型并整键替换", async (t) => {
      const h = await createHarness(t);
      assert.equal(await h.dispatcher.dispatch([command, "set", "data", '{"old":true,"nested":{"old":1}}']), 0);
      h.resetOutput();
      assert.equal(await h.dispatcher.dispatch([
        command, "set", "data", "--",
        "nested.name=Alice", "nested.count:=2", "items.0=42", "items.1:=false",
        "literal=true", "nothing:=null", "flag=--stdin-field=body",
      ]), 0);
      assert.deepEqual(await h.read(command, "data"), {
        nested: { name: "Alice", count: 2 },
        items: ["42", false],
        literal: "true",
        nothing: null,
        flag: "--stdin-field=body",
      });
      assert.equal(h.stderr.length, 0);
      assert.ok(!h.stdout.join("\n").includes("Alice"));

      assert.equal(await h.dispatcher.dispatch([command, "set", "data", "--", "new=value"]), 0);
      assert.deepEqual(await h.read(command, "data"), { new: "value" });
      h.resetOutput();
      assert.equal(await h.dispatcher.dispatch([command, "get", "data"]), 0);
      assert.deepEqual(JSON.parse(h.stdout.join("\n")), { new: "value" });
      h.resetOutput();
      assert.equal(await h.dispatcher.dispatch([command, "list"]), 0);
      assert.ok(h.stdout.join("\n").includes("data"));
    });

    it("兼容完整字符串、标量、对象与 JSON 数组位置值", async (t) => {
      const h = await createHarness(t);
      const values: Array<[string, JsonValue]> = [
        ["plain text", "plain text"],
        ["", ""],
        ['"quoted text"', "quoted text"],
        ["42", 42],
        ["-3", -3],
        ["false", false],
        ["null", null],
        ['[1,"two",true,null]', [1, "two", true, null]],
        ['{"only":"new"}', { only: "new" }],
      ];
      for (const [text, expected] of values) {
        assert.equal(await h.dispatcher.dispatch([command, "set", "data", text]), 0, text);
        assert.deepEqual(await h.read(command, "data"), expected, text);
      }
    });

    it("完整 --stdin 按 JSON 或字符串解码，只裁剪末尾换行，空输入不写入", async (t) => {
      const h = await createHarness(t);
      const values: Array<[string, JsonValue]> = [
        ['[1,"two"]\r\n', [1, "two"]],
        ["  plain text  \r\n\n", "  plain text  "],
        ["false\n", false],
        ['"quoted"\n', "quoted"],
      ];
      for (const [text, expected] of values) {
        assert.equal(await h.invoke(command, ["set", "data", "--stdin"], undefined, text), 0);
        assert.deepEqual(await h.read(command, "data"), expected);
      }
      for (const text of ["", "\r\n"]) {
        assert.equal(await h.invoke(command, ["set", "data", "--stdin", "--json"], undefined, text), 2);
        assert.equal(JSON.parse(h.stdout.join("\n")).error.code, "INVALID_FLAT_ARGUMENT");
        assert.equal(await h.read(command, "data"), "quoted");
      }
    });

    it("--stdin-field 绑定原始正文，可补充扁平字段，不把选项当作完整值", async (t) => {
      const h = await createHarness(t);
      const text = '\uFEFF  {"looks":"json"}\r\n正文\n';
      assert.equal(await h.invoke(command, ["set", "data", '{"old":true}']), 0);
      assert.equal(await h.invoke(command, ["set", "data", "--stdin-field", "body"], ["kind=text", "enabled:=true"], text), 0);
      assert.deepEqual(await h.read(command, "data"), { body: text, kind: "text", enabled: true });
      assert.ok(!h.stdout.join("\n").includes(text));

      assert.equal(await h.invoke(command, ["set", "data", "--stdin-field=body"], undefined, ""), 0);
      assert.deepEqual(await h.read(command, "data"), { body: "" });
      assert.equal(await h.invoke(command, ["set", "data", "--stdin-field", "body"], [], "[1,2]\n"), 0);
      assert.deepEqual(await h.read(command, "data"), { body: "[1,2]\n" });
    });

    it("拒绝输入来源冲突、重复路径和非法字段名，失败不修改旧值且不读 stdin", async (t) => {
      const h = await createHarness(t);
      assert.equal(await h.invoke(command, ["set", "data", '{"keep":true}']), 0);
      const setSpy = t.mock.method(h.service.management![command], "set");
      const cases: Array<{ args: string[]; flat?: string[]; code: string }> = [
        { args: ["set", "data", "value"], flat: ["new=value"], code: "INPUT_CONFLICT" },
        { args: ["set", "data", "value", "--stdin"], code: "INPUT_CONFLICT" },
        { args: ["set", "data", "value", "--stdin-field", "body"], code: "INPUT_CONFLICT" },
        { args: ["set", "data", "--stdin"], flat: ["new=value"], code: "INPUT_CONFLICT" },
        { args: ["set", "data", "--stdin", "--stdin-field", "body"], code: "INPUT_CONFLICT" },
        { args: ["set", "data", "--stdin-field", "body"], flat: ["body=duplicate"], code: "INPUT_PATH_CONFLICT" },
        { args: ["set", "data", "--stdin-field", "body"], flat: ["body.child=conflict"], code: "INPUT_PATH_CONFLICT" },
        { args: ["set", "data", "--stdin-field", "body"], flat: ["other:=broken"], code: "INVALID_JSON_LITERAL" },
        ...["", " ", "body.child", "__proto__", "constructor", "prototype"].map((field) => ({
          args: ["set", "data", "--stdin-field", field], code: "INVALID_FLAT_ARGUMENT",
        })),
      ];
      for (const { args, flat, code } of cases) {
        const unread = new Readable({ read() { throw new Error("stdin must not be read"); } });
        h.resetOutput();
        try {
          const handler = command === "config" ? handleConfig : handleState;
          assert.equal(await handler(h.ctx, [...args, "--json"], flat, undefined, unread), 2, args.join(" "));
          assert.equal(JSON.parse(h.stdout.join("\n")).error.code, code, args.join(" "));
          assert.equal(unread.readableFlowing, null);
          assert.deepEqual(await h.read(command, "data"), { keep: true });
        } finally {
          unread.destroy();
        }
      }
      assert.equal(setSpy.mock.callCount(), 0);
    });

    it("缺值、多个完整位置值、未知选项或无效 -- 后数据都返回参数错误", async (t) => {
      const h = await createHarness(t);
      assert.equal(await h.dispatcher.dispatch([command, "set", "data", '{"keep":true}']), 0);
      const setSpy = t.mock.method(h.service.management![command], "set");
      const cases = [
        [command, "set"],
        [command, "set", "data"],
        [command, "set", "data", "--"],
        [command, "set", "data", "one", "two"],
        [command, "set", "data", "--unknown"],
        [command, "set", "data", "one", "--unknown=hidden-value"],
        [command, "set", "data", "--stdin-field"],
        [command, "set", "data", "--stdin-field", "--stdin"],
        [command, "set", "data", "--stdin-field=body", "--stdin-field=other"],
        [command, "set", "data", "--stdin", "--stdin"],
        [command, "set", "data", "--", "--stdin-field", "body"],
        [command, "set", "data", "--", "invalid"],
        [command, "set", "data", "--", "good=value", "invalid"],
      ];
      for (const args of cases) {
        h.resetOutput();
        assert.equal(await h.dispatcher.dispatch(args), 2, args.join(" "));
        assert.equal(h.stdout.length, 0);
        assert.ok(h.stderr.length > 0);
        assert.ok(!h.stderr.join("\n").includes("hidden-value"));
        assert.deepEqual(await h.read(command, "data"), { keep: true });
      }
      assert.equal(setSpy.mock.callCount(), 0);
    });

    it("非法 JSON 值、危险键及过深完整值不得回退为字符串，错误不泄露正文", async (t) => {
      const h = await createHarness(t);
      assert.equal(await h.dispatcher.dispatch([command, "set", "data", '{"keep":true}']), 0);
      const invalidWholeValues = [
        "1e999",
        '{"nested":{"number":1e999}}',
        '{"__proto__":{"secret":"private-value"}}',
        '{"nested":{"constructor":"private-value"}}',
        `${"[".repeat(258)}0${"]".repeat(258)}`,
      ];
      for (const value of invalidWholeValues) {
        h.resetOutput();
        assert.equal(await h.dispatcher.dispatch([command, "set", "data", value, "--json"]), 2, `Rejected complete value: ${value}`);
        assert.equal(JSON.parse(h.stdout.join("\n")).error.code, "INVALID_JSON");
        assert.ok(!h.stdout.join("\n").includes("private-value"));
        assert.deepEqual(await h.read(command, "data"), { keep: true });
        assert.equal(await h.invoke(command, ["set", "data", "--stdin", "--json"], undefined, value), 2);
        assert.deepEqual(await h.read(command, "data"), { keep: true });
      }
      for (const flat of [["number:=1e999"], ["secret:=private-value"], ["__proto__.secret=private-value"], ["items.1=private-value"]]) {
        h.resetOutput();
        assert.equal(await h.dispatcher.dispatch([command, "set", "data", "--json", "--", ...flat]), 2);
        assert.ok(!h.stdout.join("\n").includes("private-value"));
        assert.deepEqual(await h.read(command, "data"), { keep: true });
      }
    });

    it("转发取消信号，取消 stdin 输入后不执行写入", async (t) => {
      const h = await createHarness(t);
      assert.equal(await h.invoke(command, ["set", "data", "old"]), 0);
      const controller = new AbortController();
      controller.abort(new Error("Cancelled"));
      assert.equal(await h.invoke(command, ["set", "data", "--stdin-field", "body"], undefined, "new", controller.signal), 2);
      assert.equal(await h.read(command, "data"), "old");
      h.resetOutput();
      assert.equal(await h.dispatcher.dispatch([command, "set", "data", "--stdin"], {
        signal: controller.signal,
        cancellationSource: "sigint",
      }), 130);
      assert.equal(await h.read(command, "data"), "old");
    });
  });
}

describe("独立入口值写入的管理语义", () => {
  it("state 的 namespace、TTL 与转义复合键寻址在结构化写入后保持不变", async (t) => {
    const h = await createHarness(t);
    assert.equal(await h.dispatcher.dispatch([
      "state", "set", "data", "--namespace=session", "--ttl=2", "--", "value=temporary",
    ]), 0);
    assert.deepEqual(await h.read("state", "data", "session"), { value: "temporary" });
    assert.equal(await h.read("state", "data"), undefined);
    await h.clock.advance(1000);
    assert.deepEqual(await h.read("state", "data", "session"), { value: "temporary" });
    await h.clock.advance(1001);
    assert.equal(await h.read("state", "data", "session"), undefined);

    const composite = encodeStateKey("session:inner", "key:part");
    assert.equal(await h.dispatcher.dispatch(["state", "set", composite, "--ttl", "2", "--", "ok:=true"]), 0);
    assert.deepEqual(await h.read("state", "key:part", "session:inner"), { ok: true });
    h.resetOutput();
    assert.equal(await h.dispatcher.dispatch(["state", "get", composite, "--json"]), 0);
    assert.deepEqual(JSON.parse(h.stdout.join("\n")).value, { ok: true });

    assert.equal(await h.invoke("state", ["set", "literal:key", "--stdin-field", "body", "-n", "explicit", "--ttl", "1"], ["kind=raw"], "body\n"), 0);
    assert.deepEqual(await h.read("state", "literal:key", "explicit"), { body: "body\n", kind: "raw" });
    assert.equal(await h.read("state", "key", "literal"), undefined);
    await h.clock.advance(1001);
    assert.equal(await h.read("state", "literal:key", "explicit"), undefined);

    assert.equal(await h.dispatcher.dispatch(["state", "set", "legacy", "[1,2]", "-n", "session", "--ttl", "1"]), 0);
    assert.deepEqual(await h.read("state", "legacy", "session"), [1, 2]);
    await h.clock.advance(1001);
    assert.equal(await h.read("state", "legacy", "session"), undefined);
  });

  it("config 继续由核心 schema 校验，不合并旧值，校验失败保留原值", async (t) => {
    const h = await createHarness(t);
    assert.equal(await h.dispatcher.dispatch(["config", "set", "strict", "--", "count:=2"]), 0);
    assert.deepEqual(await h.read("config", "strict"), { count: 2 });
    for (const flat of [["count=3"], ["count:=-1"], ["unknown:=true"]]) {
      h.resetOutput();
      assert.equal(await h.dispatcher.dispatch(["config", "set", "strict", "--", ...flat]), 1);
      assert.ok(h.stderr.join("\n").includes("schema validation"));
      assert.deepEqual(await h.read("config", "strict"), { count: 2 });
    }
    await assert.rejects(
      () => h.invoke("config", ["set", "strict", "--stdin-field", "count"], undefined, "4"),
      { code: "CONFIG_VALUE_INVALID" }
    );
    assert.deepEqual(await h.read("config", "strict"), { count: 2 });
  });

  it("配置管理输出不回显秘密，原有来源及隐藏契约不变", async (t) => {
    const h = await createHarness(t);
    const secret = "private-configuration-value";
    assert.equal(await h.invoke("config", ["set", "secret", "--stdin-field", "body"], undefined, secret), 0);
    assert.ok(!h.stdout.join("\n").includes(secret));
    const view = await h.service.management!.config.get(packageId, "secret");
    assert.equal(view.source, "package");
    assert.equal(view.value, undefined);
    assert.deepEqual(view.redactedPaths, [""]);
    h.resetOutput();
    assert.equal(await h.dispatcher.dispatch(["config", "get", "secret"]), 0);
    assert.equal(h.stdout.join("\n"), "<hidden>");
    h.resetOutput();
    assert.equal(await h.dispatcher.dispatch(["config", "list"]), 0);
    assert.equal(JSON.parse(h.stdout.join("\n")).secret, "********");
    assert.ok(!h.stdout.join("\n").includes(secret));
  });

  it("帮助列出完整值、stdin、字段绑定、扁平参数与状态写入选项", async (t) => {
    const h = await createHarness(t);
    assert.equal(await h.dispatcher.dispatch(["help"]), 0);
    const help = h.stdout.join("\n");
    assert.ok(help.includes("config set <key> [<value> | --stdin]"));
    assert.ok(help.includes("config set <key> [--stdin-field <field>] [-- <assignments...>]"));
    assert.ok(help.includes("state set <key> [<value> | --stdin] [-n <namespace>] [--ttl <seconds>]"));
    assert.ok(help.includes("state set <key> [--stdin-field <field>]"));
  });
});
