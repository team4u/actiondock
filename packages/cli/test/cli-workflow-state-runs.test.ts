import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";

import { existsSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { initProject } from "@actiondock/core";
import { runCliAsync } from "./helpers/run-cli";

let tempHome: string | undefined;

describe("CLI Workflow - State & Runs Management", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "actiondock-cli-state-"));
    tempHome = mkdtempSync(join(tmpdir(), "actiondock-cli-state-home-"));
    process.env.ACTIONDOCK_HOME = tempHome;
    const rootNodeModules = resolve(import.meta.dirname, "../../../node_modules");
    if (existsSync(rootNodeModules)) {
      try {
        symlinkSync(rootNodeModules, join(tempDir, "node_modules"), "junction");
      } catch {}
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

  it("manages state lifecycle: get, set with TTL, scoped namespaces, deletion, and clearing", async () => {
    // Populate state by running the action 3 times
    await runCliAsync(["run", "sample.greet", "--input", '{"name": "User 1"}', "--json"], tempDir);
    await runCliAsync(["run", "sample.greet", "--input", '{"name": "User 2"}', "--json"], tempDir);
    await runCliAsync(["run", "sample.greet", "--input", '{"name": "User 3"}', "--json"], tempDir);

    // 7. state list & get & set with --ttl
    const stateList = await runCliAsync(["state", "list", "--json"], tempDir);
    assert.strictEqual(stateList.exitCode, 0);
    const stateKeys = JSON.parse(stateList.stdout.toString());
    assert.ok((stateKeys).includes("greet_count"));

    const stateListIntent = await runCliAsync(["state", "list", "--intent", "greet", "--json"], tempDir);
    assert.strictEqual(stateListIntent.exitCode, 0);
    assert.ok((JSON.parse(stateListIntent.stdout.toString())).includes("greet_count"));

    // 机器模式（--json）无匹配且未显式 --fallback 时不回退：返回空集
    const stateListNoMatch = await runCliAsync(["state", "list", "--intent", "nomatch-xyz", "--json"], tempDir);
    assert.strictEqual(stateListNoMatch.exitCode, 0);
    assert.deepStrictEqual(JSON.parse(stateListNoMatch.stdout.toString()), []);

    const stateGet = await runCliAsync(["state", "get", "greet_count", "--json"], tempDir);
    assert.strictEqual(stateGet.exitCode, 0);
    const stateVal = JSON.parse(stateGet.stdout.toString());
    assert.strictEqual(stateVal.value, 3);

    const stateSetTtl = await runCliAsync(
      ["state", "set", "short_lived", "session_abc", "--ttl", "60"],
      tempDir
    );
    assert.strictEqual(stateSetTtl.exitCode, 0);
    const getShortLived = await runCliAsync(
      ["state", "get", "short_lived", "--json"],
      tempDir
    );
    if (getShortLived.exitCode !== 0) {
      throw new Error(
        `getShortLived failed with exitCode ${getShortLived.exitCode}\nSTDOUT: ${getShortLived.stdout.toString()}\nSTDERR: ${getShortLived.stderr.toString()}`
      );
    }
    assert.strictEqual(getShortLived.exitCode, 0);
    assert.strictEqual(JSON.parse(getShortLived.stdout.toString()).value, "session_abc");

    // 7b. Scoped state operations (namespace:key & -n flag)
    const stateSetScoped = await runCliAsync(
      ["state", "set", "cas-login:host", "vipshop.com"],
      tempDir
    );
    assert.strictEqual(stateSetScoped.exitCode, 0);

    const stateGetScoped = await runCliAsync(
      ["state", "get", "cas-login:host", "--json"],
      tempDir
    );
    assert.strictEqual(stateGetScoped.exitCode, 0);
    assert.strictEqual(JSON.parse(stateGetScoped.stdout.toString()).value, "vipshop.com");
    assert.strictEqual(JSON.parse(stateGetScoped.stdout.toString()).namespace, "cas-login");

    const stateGetScopedNs = await runCliAsync(
      ["state", "get", "host", "-n", "cas-login", "--json"],
      tempDir
    );
    assert.strictEqual(stateGetScopedNs.exitCode, 0);
    assert.strictEqual(JSON.parse(stateGetScopedNs.stdout.toString()).value, "vipshop.com");

    // Global list discovers scoped key
    const stateListAll = await runCliAsync(["state", "list", "--json"], tempDir);
    assert.strictEqual(stateListAll.exitCode, 0);
    assert.ok((JSON.parse(stateListAll.stdout.toString())).includes("cas-login:host"));

    // Scoped list only lists scoped keys
    const stateListNs = await runCliAsync(["state", "list", "-n", "cas-login", "--json"], tempDir);
    assert.strictEqual(stateListNs.exitCode, 0);
    assert.deepStrictEqual(JSON.parse(stateListNs.stdout.toString()), ["host"]);

    // Non-existent key delete fails with exitCode 1
    const stateDelNotFound = await runCliAsync(
      ["state", "delete", "not_exist_key"],
      tempDir
    );
    assert.strictEqual(stateDelNotFound.exitCode, 1);
    assert.ok((stateDelNotFound.stderr.toString()).includes("not found"));

    // Composite key delete succeeds
    const stateDelScoped = await runCliAsync(
      ["state", "delete", "cas-login:host"],
      tempDir
    );
    assert.strictEqual(stateDelScoped.exitCode, 0);
    assert.ok((stateDelScoped.stdout.toString()).includes("deleted"));

    // Verify it is actually deleted
    const stateGetAfterDel = await runCliAsync(
      ["state", "get", "cas-login:host", "--json"],
      tempDir
    );
    assert.strictEqual(stateGetAfterDel.exitCode, 1);
    assert.ok((stateGetAfterDel.stdout.toString() + stateGetAfterDel.stderr.toString()).includes("not found"));

    // Clear state test
    await runCliAsync(["state", "set", "cache:k1", "v1"], tempDir);
    await runCliAsync(["state", "set", "cache:k2", "v2"], tempDir);
    const clearProc = await runCliAsync(["state", "clear", "-n", "cache"], tempDir);
    assert.strictEqual(clearProc.exitCode, 0);
    assert.ok((clearProc.stdout.toString()).includes("Cleared 2 state entry(s)"));
  });

  it("tracks and manages execution runs: list, filter, show detail, reject local cancel, and clear", async () => {
    // Populate runs by executing the action 3 times
    await runCliAsync(["run", "sample.greet", "--input", '{"name": "Alice"}', "--json"], tempDir);
    await runCliAsync(["run", "sample.greet", "--input", '{"name": "Bob"}', "--json"], tempDir);
    await runCliAsync(["run", "sample.greet", "--input", '{"name": "Charlie"}', "--json"], tempDir);

    // 8. runs list & show
    const runsListProc = await runCliAsync(["runs", "list", "--json"], tempDir);
    assert.strictEqual(runsListProc.exitCode, 0);
    const runs = JSON.parse(runsListProc.stdout.toString());
    assert.strictEqual(runs.length, 3);

    const runsListIntent = await runCliAsync(["runs", "list", "--intent", "sample.greet", "--json"], tempDir);
    assert.strictEqual(runsListIntent.exitCode, 0);
    assert.strictEqual(JSON.parse(runsListIntent.stdout.toString()).length, 3);

    // 机器模式（--json）无匹配且未显式 --fallback 时不回退：返回空集
    const runsListNoMatch = await runCliAsync(["runs", "list", "--intent", "nomatch-xyz", "--json"], tempDir);
    assert.strictEqual(runsListNoMatch.exitCode, 0);
    assert.deepStrictEqual(JSON.parse(runsListNoMatch.stdout.toString()), []);

    const runShowProc = await runCliAsync(["runs", "show", runs[0].id, "--json"], tempDir);
    assert.strictEqual(runShowProc.exitCode, 0);
    const runDetail = JSON.parse(runShowProc.stdout.toString());
    assert.strictEqual(runDetail.id, runs[0].id);
    assert.strictEqual(runDetail.status, "success");

    // Local runs cancel is rejected (ArgumentError, exit code 2)
    const cancelLocalProc = await runCliAsync(["runs", "cancel", runs[0].id], tempDir);
    assert.strictEqual(cancelLocalProc.exitCode, 2);
    assert.ok((cancelLocalProc.stderr.toString()).includes("'ad runs cancel' is only supported for remote execution targets"));

    // 8b. runs clear with filters
    // Run another action so we have at least 2 runs
    await runCliAsync(["run", "ping"], tempDir);
    const beforeClearRuns = await runCliAsync(["runs", "list", "--json"], tempDir);
    assert.ok((JSON.parse(beforeClearRuns.stdout.toString()).length) >= 2);

    // Clear runs older than 100 days (should clear 0)
    const clearOlderProc = await runCliAsync(["runs", "clear", "--older-than", "100d", "--json"], tempDir);
    assert.strictEqual(clearOlderProc.exitCode, 0);
    assert.deepStrictEqual(JSON.parse(clearOlderProc.stdout.toString()), { ok: true, clearedCount: 0 });

    // Clear keeping newest 1 run
    const clearKeepProc = await runCliAsync(["runs", "clear", "--keep", "1", "--json"], tempDir);
    assert.strictEqual(clearKeepProc.exitCode, 0);
    const keepResult = JSON.parse(clearKeepProc.stdout.toString());
    assert.strictEqual(keepResult.ok, true);
    assert.ok((keepResult.clearedCount) >= 1);

    const runsListAfterKeep = await runCliAsync(["runs", "list", "--json"], tempDir);
    assert.strictEqual(JSON.parse(runsListAfterKeep.stdout.toString()).length, 1);

    // Full clear
    const clearRunsProc = await runCliAsync(["runs", "clear"], tempDir);
    assert.strictEqual(clearRunsProc.exitCode, 0);
    assert.ok((clearRunsProc.stdout.toString()).includes("Cleared"));

    const runsListAfterClear = await runCliAsync(["runs", "list", "--json"], tempDir);
    assert.strictEqual(runsListAfterClear.exitCode, 0);
    assert.strictEqual(JSON.parse(runsListAfterClear.stdout.toString()).length, 0);
  });
});
