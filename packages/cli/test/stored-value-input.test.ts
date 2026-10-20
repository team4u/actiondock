import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { afterEach, beforeEach, describe, it } from "node:test";
import { initProject } from "@actiondock/core";
import { createStorage } from "@actiondock/core/package";
import { runCliAsync } from "./helpers/run-cli";

for (const kind of ["config", "state"] as const) {
  describe(`${kind} set 完整值输入`, () => {
    let root: string;
    let home: string;
    beforeEach(() => {
      root = mkdtempSync(join(tmpdir(), "ad-value-input-"));
      home = mkdtempSync(join(tmpdir(), "ad-value-home-"));
      initProject(root, { id: "test.value-input", name: "Value Input" });
    });
    afterEach(() => {
      rmSync(root, { recursive: true, force: true, maxRetries: 5 });
      rmSync(home, { recursive: true, force: true, maxRetries: 5 });
    });
    const run = (args: string[], input?: string | NodeJS.ReadableStream) => runCliAsync(args, root, { ACTIONDOCK_HOME: home, ACTIONDOCK_PROFILE: undefined }, input);
    const read = async (key: string, namespace = "") => {
      const storage = createStorage("test.value-input", { customHome: home });
      try { return kind === "config" ? storage.getConfig(key) : await storage.getState(namespace, key); }
      finally { storage.close(); }
    };

    it("-- 后的扁平字段组装对象，继承字符串与 JSON、嵌套及数组语义", async () => {
      const result = await run([kind, "set", "VALUE", "--", "name=alice", "count:=2", "enabled:=true", "items.0.id:=1", "items.1.id:=2"]);
      assert.equal(result.exitCode, 0, result.stderr.toString());
      assert.deepEqual(await read("VALUE"), { name: "alice", count: 2, enabled: true, items: [{ id: 1 }, { id: 2 }] });
    });

    it("一个含等号的位置值仍是字符串，完整 JSON 根数组和 falsy 值保持原语义", async () => {
      for (const [value, expected] of [["a=b", "a=b"], ["[1,2]", [1, 2]], ["false", false], ["null", null], ["0", 0], ["", ""]] as const) {
        const result = await run([kind, "set", "VALUE", value]);
        assert.equal(result.exitCode, 0, result.stderr.toString());
        assert.deepEqual(await read("VALUE"), expected);
      }
      const flat = await run([kind, "set", "VALUE", "--", "a=b"]);
      assert.equal(flat.exitCode, 0, flat.stderr.toString());
      assert.deepEqual(await read("VALUE"), { a: "b" });
    });

    it("stdin-field 原样绑定文本并与扁平字段组合，不泄露正文到输出", async () => {
      const text = "\uFEFF{\"secret\":123}\r\n";
      const result = await run([kind, "set", "VALUE", "--stdin-field", "content", "--", "title=note", "revision:=3"], text);
      assert.equal(result.exitCode, 0, result.stderr.toString());
      assert.deepEqual(await read("VALUE"), { title: "note", revision: 3, content: text });
      assert.equal((result.stdout.toString() + result.stderr.toString()).includes(text), false);
      const empty = await run([kind, "set", "EMPTY_BODY", "--stdin-field", "content"], "");
      assert.equal(empty.exitCode, 0, empty.stderr.toString());
      assert.deepEqual(await read("EMPTY_BODY"), { content: "" });
    });

    it("完整 stdin 支持 JSON 或普通文本，裁剪末尾换行，空输入失败", async () => {
      const result = await run([kind, "set", "VALUE", "--stdin"], '{"nested":{"x":1}}\n');
      assert.equal(result.exitCode, 0, result.stderr.toString());
      assert.deepEqual(await read("VALUE"), { nested: { x: 1 } });
      assert.equal((await run([kind, "set", "TEXT", "--stdin"], "plain\r\n")).exitCode, 0);
      assert.equal(await read("TEXT"), "plain");
      assert.equal((await run([kind, "set", "VALUE", "--stdin"], "")).exitCode, 2);
      assert.deepEqual(await read("VALUE"), { nested: { x: 1 } });
    });

    it("新输入编码仍完整替换，未提交字段不会从旧值中合并", async () => {
      await run([kind, "set", "VALUE", '{"old":"secret","keep":true}']);
      const result = await run([kind, "set", "VALUE", "--", "new=value"]);
      assert.equal(result.exitCode, 0, result.stderr.toString());
      assert.deepEqual(await read("VALUE"), { new: "value" });
    });

    it("模式互斥、字段冲突与已知扁平错误在读取 stdin 前拒绝，旧值不变", async () => {
      await run([kind, "set", "VALUE", '{"old":true}']);
      for (const tail of [
        ["full-value", "--stdin"], ["full-value", "--", "x=1"],
        ["--stdin", "--stdin-field", "body"], ["full-value", "--stdin-field", "body"],
        ["--stdin", "--", "x=1"], ["--stdin-field", "body", "--", "body=x"],
        ["--stdin-field", "body", "--", "body.child=x"], ["--stdin-field", "body", "--", "x:=not-json"],
        ["--stdin-field", "__proto__"], ["--stdin-field", "nested.body"],
      ]) {
        let reads = 0;
        const unread = new Readable({ read() { reads++; } });
        const result = await run([kind, "set", "VALUE", ...tail], unread);
        unread.destroy();
        assert.equal(result.exitCode, 2, `${JSON.stringify(tail)}: ${result.stderr}`);
        assert.equal(reads, 0);
        assert.deepEqual(await read("VALUE"), { old: true });
      }
    });

    it("非法类型字面量、重复路径、原型字段与超限输入失败，诊断不泄露值", async () => {
      const secret = "secret-must-not-appear";
      await run([kind, "set", "VALUE", '"old-value"']);
      for (const tail of [
        ["--", `password:=${secret}`], ["--", "x:=1e999"], ["1e999"],
        ["--", "x=1", "x=2"], ["--", "items.1=x"], ["--", "__proto__.x=1"],
        ['{"__proto__":{"polluted":true}}'], ["--", 'data:={"__proto__":{"polluted":true}}'],
      ]) {
        const result = await run([kind, "set", "VALUE", ...tail]);
        assert.equal(result.exitCode, 2, result.stderr.toString());
        assert.equal((result.stdout.toString() + result.stderr.toString()).includes(secret), false);
        assert.equal(await read("VALUE"), "old-value");
      }
      const large = await run([kind, "set", "VALUE", "--stdin-field", "body"], "a".repeat(10 * 1024 * 1024 + 1));
      assert.equal(large.exitCode, 2);
      assert.equal(await read("VALUE"), "old-value");
      assert.equal(({} as any).polluted, undefined);
    });

    if (kind === "config") {
      it("模板对象写入先组装再校验，缺少必填密码不覆盖原连接", async () => {
        const file = join(root, "actiondock.json");
        const manifest = JSON.parse(readFileSync(file, "utf8"));
        manifest.config = { "MYSQL_*": { schema: { type: "object", properties: { host: { type: "string" }, password: { type: "string", secret: true } }, required: ["host", "password"], additionalProperties: false } } };
        writeFileSync(file, JSON.stringify(manifest));
        const good = await run(["config", "set", "MYSQL_LOCAL", "--stdin-field", "password", "--", "host=local"], "raw-password");
        assert.equal(good.exitCode, 0, good.stderr.toString());
        assert.deepEqual(await read("MYSQL_LOCAL"), { host: "local", password: "raw-password" });
        const bad = await run(["config", "set", "MYSQL_LOCAL", "--json", "--", "host=new-host"]);
        assert.equal(bad.exitCode, 2);
        assert.equal(JSON.parse(bad.stdout.toString()).error.code, "CONFIG_VALUE_INVALID");
        assert.deepEqual(await read("MYSQL_LOCAL"), { host: "local", password: "raw-password" });
      });
    } else {
      it("状态 action、namespace、复合键与 TTL 不受新编码影响", async () => {
        const result = await run(["state", "set", "cache:ENTRY", "-a", "audit", "--ttl", "60", "--stdin-field", "body", "--", "n:=1"], "raw-body\n");
        assert.equal(result.exitCode, 0, result.stderr.toString());
        assert.deepEqual(await read("ENTRY", "audit:cache"), { n: 1, body: "raw-body\n" });
        const storage = createStorage("test.value-input", { customHome: home });
        try { assert.ok(Date.parse((await storage.findState("ENTRY", "audit:cache"))!.expiresAt!) > Date.now()); }
        finally { storage.close(); }
        const dashNamespace = await run(["state", "set", "DASH", "value", "-n", "--"]);
        assert.equal(dashNamespace.exitCode, 0, dashNamespace.stderr.toString());
        assert.equal(await read("DASH", "--"), "value");
      });
    }
  });
}
