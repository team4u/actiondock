import { afterEach, beforeEach, describe, expect, it, setDefaultTimeout } from "bun:test";
setDefaultTimeout(120000);
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
    expect(stateList.exitCode).toBe(0);
    const stateKeys = JSON.parse(stateList.stdout.toString());
    expect(stateKeys).toContain("greet_count");

    const stateListIntent = await runCliAsync(["state", "list", "--intent", "greet", "--json"], tempDir);
    expect(stateListIntent.exitCode).toBe(0);
    expect(JSON.parse(stateListIntent.stdout.toString())).toContain("greet_count");

    // 机器模式（--json）无匹配且未显式 --fallback 时不回退：返回空集
    const stateListNoMatch = await runCliAsync(["state", "list", "--intent", "nomatch-xyz", "--json"], tempDir);
    expect(stateListNoMatch.exitCode).toBe(0);
    expect(JSON.parse(stateListNoMatch.stdout.toString())).toEqual([]);

    const stateGet = await runCliAsync(["state", "get", "greet_count", "--json"], tempDir);
    expect(stateGet.exitCode).toBe(0);
    const stateVal = JSON.parse(stateGet.stdout.toString());
    expect(stateVal.value).toBe(3);

    const stateSetTtl = await runCliAsync(
      ["state", "set", "short_lived", "session_abc", "--ttl", "60"],
      tempDir
    );
    expect(stateSetTtl.exitCode).toBe(0);
    const getShortLived = await runCliAsync(
      ["state", "get", "short_lived", "--json"],
      tempDir
    );
    if (getShortLived.exitCode !== 0) {
      throw new Error(
        `getShortLived failed with exitCode ${getShortLived.exitCode}\nSTDOUT: ${getShortLived.stdout.toString()}\nSTDERR: ${getShortLived.stderr.toString()}`
      );
    }
    expect(getShortLived.exitCode).toBe(0);
    expect(JSON.parse(getShortLived.stdout.toString()).value).toBe("session_abc");

    // 7b. Scoped state operations (namespace:key & -n flag)
    const stateSetScoped = await runCliAsync(
      ["state", "set", "cas-login:host", "vipshop.com"],
      tempDir
    );
    expect(stateSetScoped.exitCode).toBe(0);

    const stateGetScoped = await runCliAsync(
      ["state", "get", "cas-login:host", "--json"],
      tempDir
    );
    expect(stateGetScoped.exitCode).toBe(0);
    expect(JSON.parse(stateGetScoped.stdout.toString()).value).toBe("vipshop.com");
    expect(JSON.parse(stateGetScoped.stdout.toString()).namespace).toBe("cas-login");

    const stateGetScopedNs = await runCliAsync(
      ["state", "get", "host", "-n", "cas-login", "--json"],
      tempDir
    );
    expect(stateGetScopedNs.exitCode).toBe(0);
    expect(JSON.parse(stateGetScopedNs.stdout.toString()).value).toBe("vipshop.com");

    // Global list discovers scoped key
    const stateListAll = await runCliAsync(["state", "list", "--json"], tempDir);
    expect(stateListAll.exitCode).toBe(0);
    expect(JSON.parse(stateListAll.stdout.toString())).toContain("cas-login:host");

    // Scoped list only lists scoped keys
    const stateListNs = await runCliAsync(["state", "list", "-n", "cas-login", "--json"], tempDir);
    expect(stateListNs.exitCode).toBe(0);
    expect(JSON.parse(stateListNs.stdout.toString())).toEqual(["host"]);

    // Non-existent key delete fails with exitCode 1
    const stateDelNotFound = await runCliAsync(
      ["state", "delete", "not_exist_key"],
      tempDir
    );
    expect(stateDelNotFound.exitCode).toBe(1);
    expect(stateDelNotFound.stderr.toString()).toContain("not found");

    // Composite key delete succeeds
    const stateDelScoped = await runCliAsync(
      ["state", "delete", "cas-login:host"],
      tempDir
    );
    expect(stateDelScoped.exitCode).toBe(0);
    expect(stateDelScoped.stdout.toString()).toContain("deleted");

    // Verify it is actually deleted
    const stateGetAfterDel = await runCliAsync(
      ["state", "get", "cas-login:host", "--json"],
      tempDir
    );
    expect(stateGetAfterDel.exitCode).toBe(1);
    expect(stateGetAfterDel.stdout.toString() + stateGetAfterDel.stderr.toString()).toContain("not found");

    // Clear state test
    await runCliAsync(["state", "set", "cache:k1", "v1"], tempDir);
    await runCliAsync(["state", "set", "cache:k2", "v2"], tempDir);
    const clearProc = await runCliAsync(["state", "clear", "-n", "cache"], tempDir);
    expect(clearProc.exitCode).toBe(0);
    expect(clearProc.stdout.toString()).toContain("Cleared 2 state entry(s)");
  });

  it("tracks and manages execution runs: list, filter, show detail, reject local cancel, and clear", async () => {
    // Populate runs by executing the action 3 times
    await runCliAsync(["run", "sample.greet", "--input", '{"name": "Alice"}', "--json"], tempDir);
    await runCliAsync(["run", "sample.greet", "--input", '{"name": "Bob"}', "--json"], tempDir);
    await runCliAsync(["run", "sample.greet", "--input", '{"name": "Charlie"}', "--json"], tempDir);

    // 8. runs list & show
    const runsListProc = await runCliAsync(["runs", "list", "--json"], tempDir);
    expect(runsListProc.exitCode).toBe(0);
    const runs = JSON.parse(runsListProc.stdout.toString());
    expect(runs.length).toBe(3);

    const runsListIntent = await runCliAsync(["runs", "list", "--intent", "sample.greet", "--json"], tempDir);
    expect(runsListIntent.exitCode).toBe(0);
    expect(JSON.parse(runsListIntent.stdout.toString()).length).toBe(3);

    // 机器模式（--json）无匹配且未显式 --fallback 时不回退：返回空集
    const runsListNoMatch = await runCliAsync(["runs", "list", "--intent", "nomatch-xyz", "--json"], tempDir);
    expect(runsListNoMatch.exitCode).toBe(0);
    expect(JSON.parse(runsListNoMatch.stdout.toString())).toEqual([]);

    const runShowProc = await runCliAsync(["runs", "show", runs[0].id, "--json"], tempDir);
    expect(runShowProc.exitCode).toBe(0);
    const runDetail = JSON.parse(runShowProc.stdout.toString());
    expect(runDetail.id).toBe(runs[0].id);
    expect(runDetail.status).toBe("success");

    // Local runs cancel is rejected (ArgumentError, exit code 2)
    const cancelLocalProc = await runCliAsync(["runs", "cancel", runs[0].id], tempDir);
    expect(cancelLocalProc.exitCode).toBe(2);
    expect(cancelLocalProc.stderr.toString()).toContain("'ad runs cancel' is only supported for remote execution targets");

    // 8b. runs clear
    const clearRunsProc = await runCliAsync(["runs", "clear"], tempDir);
    expect(clearRunsProc.exitCode).toBe(0);
    expect(clearRunsProc.stdout.toString()).toContain("Cleared");

    const runsListAfterClear = await runCliAsync(["runs", "list", "--json"], tempDir);
    expect(runsListAfterClear.exitCode).toBe(0);
    expect(JSON.parse(runsListAfterClear.stdout.toString()).length).toBe(0);
  });
});
