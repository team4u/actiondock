import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { describe, it } from "node:test";
import { createActionDock, createNodePlatform, startActionDockServer } from "@actiondock/core";
import { SqliteRuntimeStorage } from "@actiondock/core/package";
import { runCliAsync } from "./helpers/run-cli";

describe("配置和状态输入的真实远端写入", () => {
  it("先在客户端构造完整值，远端保留配置校验与状态作用域，失败不写入", async (t) => {
    const root = mkdtempSync(join(tmpdir(), "ad-value-remote-"));
    const home = mkdtempSync(join(tmpdir(), "ad-value-remote-home-"));
    const storage = new SqliteRuntimeStorage({ dbPath: ":memory:", packageId: "remote.value-input" });
    const platform = createNodePlatform();
    const host = await createActionDock({
      inMemory: true, autoLoadCurrentProject: false,
      platform: { ...platform, storage: { ...platform.storage, createStorage: () => storage } },
      packages: [{ projectConfig: { id: "remote.value-input", config: {
        "MYSQL_*": { schema: {
          type: "object", required: ["host", "password"], additionalProperties: false,
          properties: { host: { type: "string" }, port: { type: "integer" }, password: { type: "string", secret: true } },
        } },
      } } }],
    });
    const token = "stored-value-test-token";
    const server = await startActionDockServer({ service: host, hostname: "127.0.0.1", port: 0, token, enableManagement: true });
    t.after(async () => { await server.stop(); await host.close(); rmSync(root, { recursive: true, force: true }); rmSync(home, { recursive: true, force: true }); });
    const target = ["--server", `http://127.0.0.1:${server.port}`, "--token", token, "-P", "remote.value-input"];
    const run = (args: string[], input?: string | NodeJS.ReadableStream) => runCliAsync(args, root, { ACTIONDOCK_HOME: home, ACTIONDOCK_PROFILE: undefined }, input);

    const password = "raw-password\r\n";
    const configured = await run(["config", "set", "MYSQL_REMOTE", ...target, "--stdin-field", "password", "--", "host=remote", "port:=3306"], password);
    assert.equal(configured.exitCode, 0, configured.stderr.toString());
    assert.deepEqual(storage.getConfig("MYSQL_REMOTE"), { host: "remote", port: 3306, password });
    const displayed = await run(["config", "get", "MYSQL_REMOTE", ...target, "--json"]);
    assert.equal(displayed.exitCode, 0, displayed.stderr.toString());
    assert.deepEqual(JSON.parse(displayed.stdout.toString()).value, { host: "remote", port: 3306, password: "********" });
    assert.equal((displayed.stdout.toString() + displayed.stderr.toString()).includes(password), false);

    const body = "\uFEFF# 原始正文\r\n";
    const state = await run(["state", "set", "cache:article", ...target, "-a", "draft", "--ttl", "60", "--stdin-field", "content", "--", "title=远端笔记", "revision:=2"], body);
    assert.equal(state.exitCode, 0, state.stderr.toString());
    assert.deepEqual(await storage.getState("draft:cache", "article"), { title: "远端笔记", revision: 2, content: body });
    assert.ok(Date.parse((await storage.findState("article", "draft:cache"))!.expiresAt!) > Date.now());

    const invalid = await run(["config", "set", "MYSQL_REMOTE", ...target, "--json", "--", "host=changed"]);
    assert.equal(invalid.exitCode, 2);
    assert.equal(JSON.parse(invalid.stdout.toString()).error.code, "CONFIG_VALUE_INVALID");
    assert.deepEqual(storage.getConfig("MYSQL_REMOTE"), { host: "remote", port: 3306, password });

    const setSpy = t.mock.method(host.management!.state, "set");
    const broken = new Readable({ read() { this.push("private-partial-body"); this.destroy(new Error("private-partial-body")); } });
    const failed = await run(["state", "set", "cache:article", ...target, "-a", "draft", "--stdin-field", "content", "--", "revision:=3"], broken);
    assert.equal(failed.exitCode, 2);
    assert.equal(setSpy.mock.callCount(), 0);
    assert.equal((failed.stdout.toString() + failed.stderr.toString()).includes("private-partial-body"), false);
    assert.deepEqual(await storage.getState("draft:cache", "article"), { title: "远端笔记", revision: 2, content: body });
  });
});
