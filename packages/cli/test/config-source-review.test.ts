import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { initProject, type ConfigSource, type ConfigValueView } from "@actiondock/core";
import { runCliAsync } from "./helpers/run-cli";

describe("CLI 来源独立验收", () => {
  let root: string;
  let home: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "ad-source-review-"));
    home = mkdtempSync(join(tmpdir(), "ad-source-home-"));
    initProject(root, { id: "source.review", name: "Source Review" });
    const manifest = JSON.parse(readFileSync(join(root, "actiondock.json"), "utf8"));
    manifest.config = {
      SOURCE_MISSING: { required: true },
      SOURCE_DEFAULT: { default: "default-value" },
      "DYNAMIC_*": { type: "string" },
    };
    writeFileSync(join(root, "actiondock.json"), JSON.stringify(manifest));
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true, maxRetries: 5 });
    rmSync(home, { recursive: true, force: true, maxRetries: 5 });
  });
  const json = (result: Awaited<ReturnType<typeof runCliAsync>>) => JSON.parse(result.stdout.toString());
  const run = (args: string[]) => runCliAsync(args, root, { ACTIONDOCK_HOME: home, ACTIONDOCK_PROFILE: undefined });

  it("全局未命中 JSON 来源必须为 null，不是 default", async () => {
    const result = await run(["config", "get", "SOURCE_NEVER_STORED", "--global", "--json"]);
    assert.equal(result.exitCode, 0, result.stderr.toString());
    assert.equal(json(result).source, null);
    assert.equal(json(result).configured, false);
  });

  it("包级与全局实际来源在 JSON 和文本中均如实传递", async () => {
    assert.equal((await run(["config", "set", "SOURCE_STORED", "stored-value"])).exitCode, 0);
    const stored = await run(["config", "get", "SOURCE_STORED", "--json"]);
    assert.equal(json(stored).source, "package");
    const text = await run(["config", "list"]);
    const row = text.stdout.toString().split("\n").find((line) => line.includes("SOURCE_STORED"))!;
    assert.ok(row.includes("(package)"), row);
    assert.equal(row.includes("(project)"), false);
    assert.equal((await run(["config", "set", "SOURCE_SHARED", "shared-value", "--global"])).exitCode, 0);
    const shared = await run(["config", "get", "SOURCE_SHARED", "--json"]);
    assert.equal(json(shared).source, "global");
    const globalList = json(await run(["config", "list", "--global", "--json"]));
    assert.equal(globalList.find((item: any) => item.key === "SOURCE_SHARED").source, "global");
  });

  it("模板和缺失诊断只用 status 表达，不发明额外 source", async () => {
    await run(["config", "set", "DYNAMIC_CASE", "value"]);
    const result = await run(["config", "schema", "--json"]);
    assert.equal(result.exitCode, 1);
    const items = json(result).configs;
    const template = items.find((item: any) => item.key === "DYNAMIC_*");
    assert.equal(template.status, "TEMPLATE");
    assert.equal(template.source, null);
    assert.equal(template.matchCount, 1);
    const missing = items.find((item: any) => item.key === "SOURCE_MISSING");
    assert.equal(missing.status, "MISSING");
    assert.equal(missing.source, null);
    assert.equal(items.find((item: any) => item.key === "SOURCE_DEFAULT").source, "default");
    const text = await run(["config", "schema"]);
    assert.ok(text.stdout.toString().includes("TEMPLATE"));
  });

  it("远端传输不改变五种来源，缺少单项契约时直接报错", async (t) => {
    const sources: ConfigSource[] = ["override", "package", "global", "env", "default"];
    const views: ConfigValueView[] = sources.map((source) => ({
      key: `REMOTE_${source.toUpperCase()}`, source, configured: source !== "default",
      secret: false, value: source, redactedPaths: [],
    }));
    let invalidSingle = false;
    const server = createServer((req, res) => {
      const key = new URL(req.url!, "http://localhost").searchParams.get("key");
      const envelope: any = { configViewVersion: 1, packageId: "remote.source-review", declared: {} };
      if (key !== null && !invalidSingle) {
        envelope.item = views.find((item) => item.key === key) ?? { key, source: null, configured: false, secret: false, redactedPaths: [] };
      } else envelope.items = views;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify(envelope));
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    t.after(() => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())));
    const url = `http://127.0.0.1:${(server.address() as any).port}`;
    for (const source of sources) {
      const result = await run(["config", "get", `REMOTE_${source.toUpperCase()}`, "--server", url, "--json"]);
      assert.equal(result.exitCode, 0, result.stderr.toString());
      assert.equal(json(result).source, source);
    }
    const text = (await run(["config", "list", "--server", url])).stdout.toString();
    for (const source of sources) assert.ok(text.includes(`(${source})`), text);
    assert.equal(text.includes("(remote)"), false);
    assert.equal(text.includes("(project)"), false);
    invalidSingle = true;
    const invalid = await run(["config", "get", "REMOTE_PACKAGE", "--server", url, "--json"]);
    assert.notEqual(invalid.exitCode, 0);
    assert.ok((invalid.stdout.toString() + invalid.stderr.toString()).includes("PROTOCOL_UNSUPPORTED"));
  });
});
