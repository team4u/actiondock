import { runCommandSync, whichExecutable } from "../../../scripts/lib/spawn-helper.mjs";
import assert from "node:assert/strict";
import { after, afterEach, before, beforeEach, describe, it } from "node:test";

import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { initProject } from "@actiondock/core";

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

describe("CLI Workflow - Package Links & Outside Discovery", () => {
  let suiteBaseDir: string;
  let tempDir: string;
  let caseIndex = 0;

  before(() => {
    suiteBaseDir = mkdtempSync(join(tmpdir(), "actiondock-cli-links-suite-"));
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
    initProject(tempDir, { id: "team.github-ops", name: "GitHub Ops" });
  });

  afterEach(() => {
    if (tempHome) {
      safeCleanDir(tempHome);
      tempHome = undefined;
    }
    safeCleanDir(tempDir);
  });

  it("supports common CLI options before and after subcommands", () => {
    // Before subcommand: ad --json list
    const preJson = runCli(["--json", "list"], tempDir);
    assert.strictEqual(preJson.exitCode, 0);
    const preJsonList = JSON.parse(preJson.stdout.toString());
    assert.strictEqual(Array.isArray(preJsonList.items), true);

    // After subcommand: ad list --json
    const postJson = runCli(["list", "--json"], tempDir);
    assert.strictEqual(postJson.exitCode, 0);
    const postJsonList = JSON.parse(postJson.stdout.toString());
    assert.strictEqual(Array.isArray(postJsonList.items), true);
  });

  it("links package and discovers/executes actions and playbooks from outside directory", () => {
    runCli(["config", "set", "SAMPLE_GREETING", "Howdy"], tempDir);

    // 11. link package and execute from outside directory
    const linkProc = runCli(["link"], tempDir);
    assert.strictEqual(linkProc.exitCode, 0);
    assert.ok((linkProc.stdout.toString()).includes("[OK] Linked package"));

    // Info from outside directory (summary list)
    const outsideInfoList = runCli(["info", "--json"], tmpdir());
    assert.strictEqual(outsideInfoList.exitCode, 0);
    const outsideInfoListData = JSON.parse(outsideInfoList.stdout.toString());
    assert.notStrictEqual(outsideInfoListData.linkedPackages, undefined);
    const pkgInInfo = outsideInfoListData.linkedPackages.find((p: any) => p.id === "team.github-ops");
    assert.notStrictEqual(pkgInInfo, undefined);
    assert.ok((pkgInInfo.actionsCount) > 0);

    // Info for specific package from outside directory (exact match)
    const outsideInfoPkg = runCli(["info", "team.github-ops", "--json"], tmpdir());
    assert.strictEqual(outsideInfoPkg.exitCode, 0);
    const outsideInfoPkgData = JSON.parse(outsideInfoPkg.stdout.toString());
    assert.strictEqual(outsideInfoPkgData.id, "team.github-ops");

    // Info with fuzzy matching (multi-match pattern returns filtered list)
    const outsideInfoFuzzy = runCli(["info", "github", "--json"], tmpdir());
    assert.strictEqual(outsideInfoFuzzy.exitCode, 0);
    const outsideInfoFuzzyData = JSON.parse(outsideInfoFuzzy.stdout.toString());
    if (outsideInfoFuzzyData.linkedPackages) {
      assert.strictEqual(outsideInfoFuzzyData.linkedPackages.some((p: any) => p.id === "team.github-ops"), true);
    } else {
      assert.strictEqual(outsideInfoFuzzyData.id, "team.github-ops");
    }

    // Info with unique fuzzy matching pattern (returns single package detail)
    const outsideInfoUnique = runCli(["info", "github-ops", "--json"], tmpdir());
    assert.strictEqual(outsideInfoUnique.exitCode, 0);
    const outsideInfoUniqueData = JSON.parse(outsideInfoUnique.stdout.toString());
    assert.strictEqual(outsideInfoUniqueData.id, "team.github-ops");

    // Info with explicit intent flag (--intent)
    const outsideInfoIntent = runCli(["info", "-i", "github-ops", "--json"], tmpdir());
    assert.strictEqual(outsideInfoIntent.exitCode, 0);
    const outsideInfoIntentData = JSON.parse(outsideInfoIntent.stdout.toString());
    assert.notStrictEqual(outsideInfoIntentData.linkedPackages, undefined);
    assert.strictEqual(outsideInfoIntentData.linkedPackages.some((p: any) => p.id === "team.github-ops"), true);
    assert.strictEqual(outsideInfoIntentData.matchedCount, 1);

    // Info with unmatched intent + fallback (returns linked packages with isFallback)
    const outsideInfoFallback = runCli(["info", "nonexistent-keyword-xyz", "--fallback", "--json"], tmpdir());
    assert.strictEqual(outsideInfoFallback.exitCode, 0);
    const outsideInfoFallbackData = JSON.parse(outsideInfoFallback.stdout.toString());
    assert.notStrictEqual(outsideInfoFallbackData.linkedPackages, undefined);
    assert.strictEqual(outsideInfoFallbackData.isFallback, true);

    // Info with unmatched intent + --no-fallback (returns empty list with exit code 0)
    const outsideInfoNoFallback = runCli(["info", "nonexistent-keyword-xyz", "--no-fallback", "--json"], tmpdir());
    assert.strictEqual(outsideInfoNoFallback.exitCode, 0);
    const outsideInfoNoFallbackData = JSON.parse(outsideInfoNoFallback.stdout.toString());
    assert.notStrictEqual(outsideInfoNoFallbackData.linkedPackages, undefined);
    assert.strictEqual(outsideInfoNoFallbackData.linkedPackages.length, 0);

    // List actions and playbooks from outside directory
    const outsidePbList = runCli(["playbook", "list", "--json"], tmpdir());
    assert.strictEqual(outsidePbList.exitCode, 0);
    const outsidePbListData = JSON.parse(outsidePbList.stdout.toString());
    const pkgInList = outsidePbListData.packages.find((p: any) => p.packageId === "team.github-ops");
    assert.notStrictEqual(pkgInList, undefined);
    assert.strictEqual(pkgInList.playbooks.length, 1);
    assert.strictEqual(pkgInList.playbooks[0].id, "greet-user");

    // Show playbook from outside directory
    const outsidePbShow = runCli(["playbook", "show", "greet-user", "--json"], tmpdir());
    assert.strictEqual(outsidePbShow.exitCode, 0);
    const outsidePbShowData = JSON.parse(outsidePbShow.stdout.toString());
    assert.strictEqual(outsidePbShowData.id, "greet-user");
    assert.strictEqual(outsidePbShowData.packageId, "team.github-ops");

    // Validate playbooks from outside directory
    const outsidePbVal = runCli(["playbook", "validate", "--json"], tmpdir());
    assert.strictEqual(outsidePbVal.exitCode, 0);

    // Runs list from outside directory
    const outsideRunsList = runCli(["runs", "list", "--json"], tmpdir());
    assert.strictEqual(outsideRunsList.exitCode, 0);

    // State list from outside directory
    const outsideStateList = runCli(["state", "list", "--json"], tmpdir());
    assert.strictEqual(outsideStateList.exitCode, 0);

    // State get with package prefix from outside directory
    runCli(["state", "set", "user:session", "active"], tempDir);
    const outsideStateGet = runCli(["state", "get", "user:session", "-P", "team.github-ops", "--json"], tmpdir());
    assert.strictEqual(outsideStateGet.exitCode, 0);

    // Build with -P from outside directory
    const outsideBuildOut = mkdtempSync(join(tmpdir(), "actiondock-dist-outside-bin-"));
    try {
      const outsideBuild = runCli(["build", "-P", "team.github-ops", "-o", outsideBuildOut], tmpdir());
      assert.strictEqual(outsideBuild.exitCode, 0);
      assert.strictEqual(existsSync(join(outsideBuildOut, "entry.mjs")), true);
    } finally {
      safeCleanDir(outsideBuildOut);
    }

    // Export with -P from outside directory
    const outsideExportDir = mkdtempSync(join(tmpdir(), "actiondock-dist-outside-skill-"));
    try {
      const outsideExport = runCli(["export", "skill", "-P", "team.github-ops", "-o", outsideExportDir], tmpdir());
      assert.strictEqual(outsideExport.exitCode, 0);
      assert.strictEqual(existsSync(join(outsideExportDir, "SKILL.md")), true);
    } finally {
      safeCleanDir(outsideExportDir);
    }

    // Execute from root (outside tempDir)
    const outsideRun = runCli(
      ["run", "sample.greet", "--input", '{"name": "Globetrotter"}', "--json"],
      tmpdir()
    );
    assert.strictEqual(outsideRun.exitCode, 0);
    const outsideRes = JSON.parse(outsideRun.stdout.toString());
    assert.strictEqual(outsideRes.ok, true);
    assert.strictEqual(outsideRes.data.message, "Howdy, Globetrotter!");

    // 12. Validate cross-package action in playbook
    const pkgBDir = mkdtempSync(join(tmpdir(), "actiondock-test-pkgb-"));
    try {
      const rootNodeModules = resolve(import.meta.dirname, "../../../node_modules");
      if (existsSync(rootNodeModules)) {
        symlinkSync(rootNodeModules, join(pkgBDir, "node_modules"), "junction");
      }
      runCli(["init", "--id", "team.consumer-pkg", "."], pkgBDir);
      runCli(
        [
          "playbook",
          "create",
          "cross-playbook",
          "-d",
          "Cross package SOP",
          "-a",
          "team.github-ops/sample.greet",
        ],
        pkgBDir
      );
      const crossVal = runCli(["playbook", "validate", "cross-playbook", "--json"], pkgBDir);
      assert.strictEqual(crossVal.exitCode, 0);
      const crossValData = JSON.parse(crossVal.stdout.toString());
      assert.strictEqual(crossValData.valid, true);
      assert.strictEqual(crossValData.results[0].warnings.length, 0);
    } finally {
      safeCleanDir(pkgBDir);
    }

    // 13. unlink
    const unlinkProc = runCli(["unlink", "team.github-ops"], tmpdir());
    assert.strictEqual(unlinkProc.exitCode, 0);
    assert.ok((unlinkProc.stdout.toString()).includes("[OK] Unlinked package"));
  });

  it("supports linked package discovery when ~/.actiondock is a symlink", () => {
    // 1. Initialize a package in tempDir
    runCli(["init", "--id", "symlink-pkg.demo", "."], tempDir);

    // 2. Setup fake home where ~/.actiondock is a symlink to an external directory
    const realActionDockDir = join(tempDir, "real-symlink-actiondock");
    mkdirSync(realActionDockDir, { recursive: true });

    const fakeUserHome = join(tempDir, "fake-user-home");
    mkdirSync(fakeUserHome, { recursive: true });
    symlinkSync(realActionDockDir, join(fakeUserHome, ".actiondock"), "junction");

    const customEnv = { ACTIONDOCK_HOME: fakeUserHome };

    // 3. Link the package under this symlink home
    const linkProc = runCli(["link"], tempDir, customEnv);
    assert.strictEqual(linkProc.exitCode, 0);

    // 4. Test ad info from an outside directory
    const infoProc = runCli(["info", "symlink-pkg.demo", "--json"], tmpdir(), customEnv);
    assert.strictEqual(infoProc.exitCode, 0);
    const infoData = JSON.parse(infoProc.stdout.toString());
    assert.strictEqual(infoData.id, "symlink-pkg.demo");

    // 5. Test ad list from outside directory
    const listProc = runCli(["list", "-P", "symlink-pkg.demo", "--json"], tmpdir(), customEnv);
    assert.strictEqual(listProc.exitCode, 0);
    const listData = JSON.parse(listProc.stdout.toString());
    assert.strictEqual(Array.isArray(listData.items), true);
    assert.ok((listData.items.length) > 0);
  });
});
