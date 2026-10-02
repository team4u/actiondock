import { runCommandSync, whichExecutable } from "../../../scripts/lib/spawn-helper.mjs";
import assert from "node:assert/strict";
import { after, afterEach, before, beforeEach, describe, it } from "node:test";

import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const cliPath = resolve(import.meta.dirname, "../bin/ad.js");

const deferredCleanupDirs = new Set<string>();

/** 快速非阻塞清理目录，遇到 Windows 短暂句柄占用时安全捕获并推迟回收，杜绝用例生命周期中的阻塞延迟 */
function safeCleanDir(targetDir?: string): void {
  if (!targetDir || !existsSync(targetDir)) return;
  try {
    rmSync(targetDir, { recursive: true, force: true, maxRetries: 1, retryDelay: 10 });
  } catch {
    deferredCleanupDirs.add(targetDir);
  }
}

function flushDeferredCleanup(): void {
  for (const dir of deferredCleanupDirs) {
    if (existsSync(dir)) {
      try {
        rmSync(dir, { recursive: true, force: true, maxRetries: 1, retryDelay: 10 });
      } catch {}
    }
  }
  deferredCleanupDirs.clear();
}

let tempHome: string | undefined;

function runCli(args: string[], cwd?: string, env?: Record<string, string>) {
  return runCommandSync(["bun", cliPath, ...args], {
    cwd,
    env: {
      ...process.env,
      ...(tempHome ? { ACTIONDOCK_HOME: tempHome } : {}),
      ...env,
    },
    stdout: "pipe",
    stderr: "pipe",
  });
}

describe("CLI Workflow - Core Lifecycle", () => {
  let suiteBaseDir: string;
  let tempDir: string;
  let caseIndex = 0;

  before(() => {
    suiteBaseDir = mkdtempSync(join(tmpdir(), "actiondock-cli-core-suite-"));
  });

  after(() => {
    safeCleanDir(suiteBaseDir);
    flushDeferredCleanup();
  });

  beforeEach(() => {
    caseIndex++;
    tempDir = join(suiteBaseDir, `case-${caseIndex}`);
    mkdirSync(tempDir, { recursive: true });
    tempHome = join(suiteBaseDir, `home-${caseIndex}`);
    mkdirSync(tempHome, { recursive: true });
    const rootNodeModules = resolve(import.meta.dirname, "../../../node_modules");
    if (existsSync(rootNodeModules)) {
      symlinkSync(rootNodeModules, join(tempDir, "node_modules"), "junction");
    }
  });

  afterEach(() => {
    if (tempHome) {
      safeCleanDir(tempHome);
      tempHome = undefined;
    }
    safeCleanDir(tempDir);
  });

  it("covers project initial lifecycle: init, info, list, describe, validate, run, and playbook", { timeout: 120000 }, async () => {
    // 1. init
    const initProc = runCli(
      ["init", "--id", "team.github-ops", "--name", "GitHub Ops", "."],
      tempDir
    );
    assert.strictEqual(initProc.exitCode, 0);

    // 2. info
    const infoProc = runCli(["info", "--json"], tempDir);
    assert.strictEqual(infoProc.exitCode, 0);
    const info = JSON.parse(infoProc.stdout.toString());
    assert.strictEqual(info.id, "team.github-ops");
    assert.strictEqual(info.actions.some((a: any) => a.id === "sample.greet"), true);

    // 3. list & describe & validate (including intent fuzzy search and fallback)
    const listProc = runCli(["list", "--json"], tempDir);
    assert.strictEqual(listProc.exitCode, 0);
    const actionsList = JSON.parse(listProc.stdout.toString());
    assert.strictEqual(actionsList.items.length, 1);
    assert.strictEqual(actionsList.items[0].id, "sample.greet");

    // 3b. Test list with --intent and positional fuzzy search
    const listIntentProc = runCli(["list", "--intent", "greet|hello", "--json"], tempDir);
    assert.strictEqual(listIntentProc.exitCode, 0);
    assert.strictEqual(JSON.parse(listIntentProc.stdout.toString()).items.length, 1);

    const listPositionalProc = runCli(["list", "greet", "--json"], tempDir);
    assert.strictEqual(listPositionalProc.exitCode, 0);
    assert.strictEqual(JSON.parse(listPositionalProc.stdout.toString()).items.length, 1);

    // In machine mode (--json), no fallback by default when no match: returns empty array
    const listNoMatchProc = runCli(["list", "--intent", "nomatch", "--json"], tempDir);
    assert.strictEqual(listNoMatchProc.exitCode, 0);
    assert.strictEqual(JSON.parse(listNoMatchProc.stdout.toString()).items.length, 0);

    // Fallback only when explicitly requested via --fallback in machine mode
    const listFallbackProc = runCli(
      ["list", "--intent", "nomatch", "--fallback", "--json"],
      tempDir
    );
    assert.strictEqual(listFallbackProc.exitCode, 0);
    const fallbackRes = JSON.parse(listFallbackProc.stdout.toString());
    assert.strictEqual(fallbackRes.isFallback, true);
    assert.strictEqual(fallbackRes.items.length, 1);

    // No fallback when --no-fallback is specified
    const listNoFallbackProc = runCli(
      ["list", "--intent", "nomatch", "--no-fallback", "--json"],
      tempDir
    );
    assert.strictEqual(listNoFallbackProc.exitCode, 0);
    assert.strictEqual(JSON.parse(listNoFallbackProc.stdout.toString()).items.length, 0);

    const showProc = runCli(["describe", "sample.greet", "--json"], tempDir);
    assert.strictEqual(showProc.exitCode, 0);
    const show = JSON.parse(showProc.stdout.toString());
    assert.strictEqual(show.id, "sample.greet");
    assert.notStrictEqual(show.inputSchema, undefined);

    const valProc = runCli(["validate", "--json"], tempDir);
    assert.strictEqual(valProc.exitCode, 0);
    const val = JSON.parse(valProc.stdout.toString());
    assert.strictEqual(val.valid, true);

    // 4. run
    const runProc = runCli(
      ["run", "sample.greet", "--input", '{"name": "Developer"}', "--timeout", "5s", "--json"],
      tempDir
    );
    assert.strictEqual(runProc.exitCode, 0);
    const runRes = JSON.parse(runProc.stdout.toString());
    assert.strictEqual(runRes.ok, true);
    assert.strictEqual(runRes.data.message, "Hello, Developer!");

    // Local async is rejected
    const localAsyncProc = runCli(
      ["run", "sample.greet", "--input", '{"name": "Developer"}', "--async"],
      tempDir
    );
    assert.strictEqual(localAsyncProc.exitCode, 1);
    assert.ok((localAsyncProc.stderr.toString()).includes("Async execution requires a long-running ActionDock server"));

    // 5. playbook list & show & validate
    const pbListProc = runCli(["playbook", "list", "--json"], tempDir);
    assert.strictEqual(pbListProc.exitCode, 0);
    const pbList = JSON.parse(pbListProc.stdout.toString());
    assert.strictEqual(pbList.items.length, 1);

    const pbListIntent = runCli(["playbook", "list", "greet", "--json"], tempDir);
    assert.strictEqual(pbListIntent.exitCode, 0);
    assert.strictEqual(JSON.parse(pbListIntent.stdout.toString()).items.length, 1);

    const pbListStrict = runCli(["playbook", "list", "nomatch", "--no-fallback", "--json"], tempDir);
    assert.strictEqual(pbListStrict.exitCode, 0);
    assert.strictEqual(JSON.parse(pbListStrict.stdout.toString()).items.length, 0);

    const pbShowProc = runCli(["playbook", "show", "greet-user", "--json"], tempDir);
    assert.strictEqual(pbShowProc.exitCode, 0);
    const pbShow = JSON.parse(pbShowProc.stdout.toString());
    assert.strictEqual(pbShow.id, "greet-user");

    const pbValProc = runCli(["playbook", "validate", "--json"], tempDir);
    assert.strictEqual(pbValProc.exitCode, 0);
  });
});
