import assert from "node:assert/strict";
import { Command } from "commander";
import { describe, it } from "node:test";
import { addStoredValueOptions, splitStoredValueArgs } from "../src/utils/value-input";

describe("写入命令的 Commander 分隔符边界", () => {
  async function parse(argv: string[]) {
    let result: any;
    let parseCount = 0;
    const root = new Command().exitOverride().option("--data-dir <path>").option("--json");
    const state = root.command("state");
    addStoredValueOptions(state.command("set <key> [values...]")
      .option("-g, --global")
      .option("-n, --namespace <name>")
      .option("-P, --package <id>")
      .option("--take <value>", "test parser", (value) => { parseCount++; return value; }))
      .action((key: string, values: string[], options: any, command: Command) => {
        result = { key, ...splitStoredValueArgs(command, values), options };
      });
    await root.parseAsync(["node", "ad", ...argv]);
    return { ...result, rootOptions: root.opts(), parseCount };
  }

  it("无 -- 的等号值仍是完整字符串，有 -- 才是扁平字段", async () => {
    const plain = await parse(["state", "set", "K", "a=b"]);
    assert.equal(plain.value, "a=b");
    assert.equal(plain.flatArgs, undefined);
    const flat = await parse(["state", "set", "K", "--", "a=b"]);
    assert.equal(flat.value, undefined);
    assert.deepEqual(flat.flatArgs, ["a=b"]);
    assert.deepEqual((await parse(["state", "set", "K", "--"])).flatArgs, []);
  });

  it("真实分隔符不与必填选项值中的 -- 混淆", async () => {
    for (const args of [
      ["state", "set", "K", "a=b", "--namespace", "--"],
      ["state", "set", "K", "a=b", "--namespace=--"],
      ["state", "set", "K", "-gn", "--", "a=b"],
    ]) {
      const result = await parse(args);
      assert.equal(result.value, "a=b");
      assert.equal(result.flatArgs, undefined);
      assert.equal(result.options.namespace, "--");
    }
    const combined = await parse(["state", "set", "K", "--namespace", "--", "--", "a=b"]);
    assert.equal(combined.options.namespace, "--");
    assert.deepEqual(combined.flatArgs, ["a=b"]);
  });

  it("父级选项与短选项合并仍按原 Commander 语义解析", async () => {
    const parent = await parse(["--data-dir", "--", "state", "set", "K", "a=b"]);
    assert.equal(parent.rootOptions.dataDir, "--");
    assert.equal(parent.value, "a=b");
    assert.equal(parent.flatArgs, undefined);
    const short = await parse(["state", "set", "K", "-gPpkg", "--", "a=b"]);
    assert.equal(short.options.global, true);
    assert.equal(short.options.package, "pkg");
    assert.deepEqual(short.flatArgs, ["a=b"]);
  });

  it("探测不会重复调用真实选项解析回调，分隔符后的内容不是选项", async () => {
    const result = await parse(["state", "set", "K", "--take", "value", "--", "--stdin", "body=text"]);
    assert.equal(result.parseCount, 1);
    assert.equal(result.options.stdin, undefined);
    assert.deepEqual(result.flatArgs, ["--stdin", "body=text"]);
  });

  it("保留完整值加结构化参数供模式仲裁，拒绝多个完整值和键位于 -- 后", async () => {
    const mixed = await parse(["state", "set", "K", "complete", "--", "a=b"]);
    assert.equal(mixed.value, "complete");
    assert.deepEqual(mixed.flatArgs, ["a=b"]);
    await assert.rejects(parse(["state", "set", "K", "one", "two"]));
    await assert.rejects(parse(["state", "set", "--", "K", "a=b"]));
  });
});
