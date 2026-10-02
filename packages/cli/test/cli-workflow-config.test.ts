import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";

import { existsSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { initProject } from "@actiondock/core";
import { runCliAsync } from "./helpers/run-cli";

let tempHome: string | undefined;

describe("CLI Workflow - Config Management", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "actiondock-cli-cfg-"));
    tempHome = mkdtempSync(join(tmpdir(), "actiondock-cli-cfg-home-"));
    process.env.ACTIONDOCK_HOME = tempHome;
    const rootNodeModules = resolve(import.meta.dirname, "../../../node_modules");
    if (existsSync(rootNodeModules)) {
      symlinkSync(rootNodeModules, join(tempDir, "node_modules"), "junction");
    }
    initProject(tempDir, { id: "team.github-ops", name: "GitHub Ops" });
  });

  afterEach(async () => {
    delete process.env.ACTIONDOCK_HOME;
    if (tempHome && existsSync(tempHome)) {
      try {
        rmSync(tempHome, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
      } catch {}
      tempHome = undefined;
    }
    if (existsSync(tempDir)) {
      try {
        rmSync(tempDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
      } catch {
        await new Promise((r) => setTimeout(r, 200));
        try {
          rmSync(tempDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
        } catch {}
      }
    }
  });

  it("manages configuration lifecycle: set, get, list, delete, schema, and environment variables", async () => {
    // 6. config set/get/list/delete
    const confSet = await runCliAsync(["config", "set", "SAMPLE_GREETING", "Howdy"], tempDir);
    assert.strictEqual(confSet.exitCode, 0);

    const confGet = await runCliAsync(["config", "get", "SAMPLE_GREETING", "--json"], tempDir);
    assert.strictEqual(confGet.exitCode, 0);
    const confObj = JSON.parse(confGet.stdout.toString());
    assert.strictEqual(confObj.value, "Howdy");

    const confListIntent = await runCliAsync(["config", "list", "--intent", "SAMPLE_GREETING", "--json"], tempDir);
    assert.strictEqual(confListIntent.exitCode, 0);
    assert.strictEqual(JSON.parse(confListIntent.stdout.toString()).some((c: any) => c.key === "SAMPLE_GREETING"), true);

    // 机器模式（--json）无匹配且未显式 --fallback 时不回退：返回空集
    const confListNoMatch = await runCliAsync(["config", "list", "--intent", "nomatch-xyz", "--json"], tempDir);
    assert.strictEqual(confListNoMatch.exitCode, 0);
    assert.deepStrictEqual(JSON.parse(confListNoMatch.stdout.toString()), []);

    const runWithNewConf = await runCliAsync(
      ["run", "sample.greet", "--input", '{"name": "Cowboy"}', "--json"],
      tempDir
    );
    assert.strictEqual(runWithNewConf.exitCode, 0);
    const runWithNewConfRes = JSON.parse(runWithNewConf.stdout.toString());
    assert.strictEqual(runWithNewConfRes.data.message, "Howdy, Cowboy!");

    // 6b. config from environment variables
    const confDel = await runCliAsync(["config", "delete", "SAMPLE_GREETING"], tempDir);
    assert.strictEqual(confDel.exitCode, 0);

    const confGetEnv = await runCliAsync(
      ["config", "get", "SAMPLE_GREETING", "--json"],
      tempDir,
      { SAMPLE_GREETING: "Bonjour" }
    );
    assert.strictEqual(confGetEnv.exitCode, 0);
    const confEnvObj = JSON.parse(confGetEnv.stdout.toString());
    assert.strictEqual(confEnvObj.value, "Bonjour");
    assert.strictEqual(confEnvObj.source, "env");

    const confSchemaEnv = await runCliAsync(
      ["config", "schema", "--json"],
      tempDir,
      { SAMPLE_GREETING: "Bonjour" }
    );
    assert.strictEqual(confSchemaEnv.exitCode, 0);
    const schemaObj = JSON.parse(confSchemaEnv.stdout.toString());
    const greetingItem = schemaObj.configs.find((c: any) => c.key === "SAMPLE_GREETING");
    assert.strictEqual(greetingItem.source, "env");
    assert.strictEqual(greetingItem.status, "SET");

    // config env --json verification
    const confEnvCheck = await runCliAsync(
      ["config", "env", "--json"],
      tempDir,
      { SAMPLE_GREETING: "Bonjour" }
    );
    assert.strictEqual(confEnvCheck.exitCode, 0);
    const envCheckObj = JSON.parse(confEnvCheck.stdout.toString());
    assert.strictEqual(envCheckObj.ok, true);
    const greetingEnvItem = envCheckObj.envChecks.find((c: any) => c.key === "SAMPLE_GREETING");
    assert.strictEqual(greetingEnvItem.satisfied, true);
    assert.strictEqual(greetingEnvItem.matchedEnv, "SAMPLE_GREETING");

    const runWithEnv = await runCliAsync(
      ["run", "sample.greet", "--input", '{"name": "Jean"}', "--json"],
      tempDir,
      { SAMPLE_GREETING: "Bonjour" }
    );
    assert.strictEqual(runWithEnv.exitCode, 0);
    const runWithEnvRes = JSON.parse(runWithEnv.stdout.toString());
    assert.strictEqual(runWithEnvRes.data.message, "Bonjour, Jean!");

    // Restore SQLite config
    const confRestore = await runCliAsync(["config", "set", "SAMPLE_GREETING", "Howdy"], tempDir);
    assert.strictEqual(confRestore.exitCode, 0);
  });
});
