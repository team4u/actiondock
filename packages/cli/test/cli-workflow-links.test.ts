import { afterEach, beforeEach, describe, expect, it, setDefaultTimeout } from "bun:test";
setDefaultTimeout(120000);
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { initProject } from "@actiondock/core";

const cliPath = resolve(import.meta.dirname, "../bin/ad.js");

let tempHome: string | undefined;

function runCli(args: string[], cwd?: string, env?: Record<string, string>) {
  return Bun.spawnSync(["bun", cliPath, ...args], {
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
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "actiondock-cli-links-"));
    tempHome = mkdtempSync(join(tmpdir(), "actiondock-cli-links-home-"));
    const rootNodeModules = resolve(import.meta.dirname, "../../../node_modules");
    if (existsSync(rootNodeModules)) {
      symlinkSync(rootNodeModules, join(tempDir, "node_modules"), "junction");
    }
    initProject(tempDir, { id: "team.github-ops", name: "GitHub Ops" });
  });

  afterEach(async () => {
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

  it("supports common CLI options before and after subcommands", () => {
    // Before subcommand: ad --json list
    const preJson = runCli(["--json", "list"], tempDir);
    expect(preJson.exitCode).toBe(0);
    const preJsonList = JSON.parse(preJson.stdout.toString());
    expect(Array.isArray(preJsonList)).toBe(true);

    // After subcommand: ad list --json
    const postJson = runCli(["list", "--json"], tempDir);
    expect(postJson.exitCode).toBe(0);
    const postJsonList = JSON.parse(postJson.stdout.toString());
    expect(Array.isArray(postJsonList)).toBe(true);
  });

  it("links package and discovers/executes actions and playbooks from outside directory", () => {
    runCli(["config", "set", "SAMPLE_GREETING", "Howdy"], tempDir);

    // 11. link package and execute from outside directory
    const linkProc = runCli(["link"], tempDir);
    expect(linkProc.exitCode).toBe(0);
    expect(linkProc.stdout.toString()).toContain("[OK] Linked package");

    // Info from outside directory (summary list)
    const outsideInfoList = runCli(["info", "--json"], tmpdir());
    expect(outsideInfoList.exitCode).toBe(0);
    const outsideInfoListData = JSON.parse(outsideInfoList.stdout.toString());
    expect(outsideInfoListData.linkedPackages).toBeDefined();
    const pkgInInfo = outsideInfoListData.linkedPackages.find((p: any) => p.id === "team.github-ops");
    expect(pkgInInfo).toBeDefined();
    expect(pkgInInfo.actionsCount).toBeGreaterThan(0);

    // Info for specific package from outside directory (exact match)
    const outsideInfoPkg = runCli(["info", "team.github-ops", "--json"], tmpdir());
    expect(outsideInfoPkg.exitCode).toBe(0);
    const outsideInfoPkgData = JSON.parse(outsideInfoPkg.stdout.toString());
    expect(outsideInfoPkgData.id).toBe("team.github-ops");

    // Info with fuzzy matching (multi-match pattern returns filtered list)
    const outsideInfoFuzzy = runCli(["info", "github", "--json"], tmpdir());
    expect(outsideInfoFuzzy.exitCode).toBe(0);
    const outsideInfoFuzzyData = JSON.parse(outsideInfoFuzzy.stdout.toString());
    if (outsideInfoFuzzyData.linkedPackages) {
      expect(outsideInfoFuzzyData.linkedPackages.some((p: any) => p.id === "team.github-ops")).toBe(true);
    } else {
      expect(outsideInfoFuzzyData.id).toBe("team.github-ops");
    }

    // Info with unique fuzzy matching pattern (returns single package detail)
    const outsideInfoUnique = runCli(["info", "github-ops", "--json"], tmpdir());
    expect(outsideInfoUnique.exitCode).toBe(0);
    const outsideInfoUniqueData = JSON.parse(outsideInfoUnique.stdout.toString());
    expect(outsideInfoUniqueData.id).toBe("team.github-ops");

    // Info with explicit intent flag (--intent)
    const outsideInfoIntent = runCli(["info", "-i", "github-ops", "--json"], tmpdir());
    expect(outsideInfoIntent.exitCode).toBe(0);
    const outsideInfoIntentData = JSON.parse(outsideInfoIntent.stdout.toString());
    expect(outsideInfoIntentData.linkedPackages).toBeDefined();
    expect(outsideInfoIntentData.linkedPackages.some((p: any) => p.id === "team.github-ops")).toBe(true);
    expect(outsideInfoIntentData.matchedCount).toBe(1);

    // Info with unmatched intent + fallback (returns linked packages with isFallback)
    const outsideInfoFallback = runCli(["info", "nonexistent-keyword-xyz", "--fallback", "--json"], tmpdir());
    expect(outsideInfoFallback.exitCode).toBe(0);
    const outsideInfoFallbackData = JSON.parse(outsideInfoFallback.stdout.toString());
    expect(outsideInfoFallbackData.linkedPackages).toBeDefined();
    expect(outsideInfoFallbackData.isFallback).toBe(true);

    // Info with unmatched intent + --no-fallback (returns empty list with exit code 0)
    const outsideInfoNoFallback = runCli(["info", "nonexistent-keyword-xyz", "--no-fallback", "--json"], tmpdir());
    expect(outsideInfoNoFallback.exitCode).toBe(0);
    const outsideInfoNoFallbackData = JSON.parse(outsideInfoNoFallback.stdout.toString());
    expect(outsideInfoNoFallbackData.linkedPackages).toBeDefined();
    expect(outsideInfoNoFallbackData.linkedPackages.length).toBe(0);

    // List actions and playbooks from outside directory
    const outsidePbList = runCli(["playbook", "list", "--json"], tmpdir());
    expect(outsidePbList.exitCode).toBe(0);
    const outsidePbListData = JSON.parse(outsidePbList.stdout.toString());
    const pkgInList = outsidePbListData.find((p: any) => p.packageId === "team.github-ops");
    expect(pkgInList).toBeDefined();
    expect(pkgInList.playbooks.length).toBe(1);
    expect(pkgInList.playbooks[0].id).toBe("greet-user");

    // Show playbook from outside directory
    const outsidePbShow = runCli(["playbook", "show", "greet-user", "--json"], tmpdir());
    expect(outsidePbShow.exitCode).toBe(0);
    const outsidePbShowData = JSON.parse(outsidePbShow.stdout.toString());
    expect(outsidePbShowData.id).toBe("greet-user");
    expect(outsidePbShowData.packageId).toBe("team.github-ops");

    // Validate playbooks from outside directory
    const outsidePbVal = runCli(["playbook", "validate", "--json"], tmpdir());
    expect(outsidePbVal.exitCode).toBe(0);

    // Runs list from outside directory
    const outsideRunsList = runCli(["runs", "list", "--json"], tmpdir());
    expect(outsideRunsList.exitCode).toBe(0);

    // State list from outside directory
    const outsideStateList = runCli(["state", "list", "--json"], tmpdir());
    expect(outsideStateList.exitCode).toBe(0);

    // State get with package prefix from outside directory
    runCli(["state", "set", "user:session", "active"], tempDir);
    const outsideStateGet = runCli(["state", "get", "user:session", "-P", "team.github-ops", "--json"], tmpdir());
    expect(outsideStateGet.exitCode).toBe(0);

    // Build with -P from outside directory
    const outsideBuildOut = mkdtempSync(join(tmpdir(), "actiondock-dist-outside-bin-"));
    try {
      const outsideBuild = runCli(["build", "-P", "team.github-ops", "-o", outsideBuildOut], tmpdir());
      expect(outsideBuild.exitCode).toBe(0);
      expect(existsSync(join(outsideBuildOut, "entry.mjs"))).toBe(true);
    } finally {
      rmSync(outsideBuildOut, { recursive: true, force: true });
    }

    // Export with -P from outside directory
    const outsideExportDir = mkdtempSync(join(tmpdir(), "actiondock-dist-outside-skill-"));
    try {
      const outsideExport = runCli(["export", "skill", "-P", "team.github-ops", "-o", outsideExportDir], tmpdir());
      expect(outsideExport.exitCode).toBe(0);
      expect(existsSync(join(outsideExportDir, "SKILL.md"))).toBe(true);
    } finally {
      rmSync(outsideExportDir, { recursive: true, force: true });
    }

    // Execute from root (outside tempDir)
    const outsideRun = runCli(
      ["run", "sample.greet", "--input", '{"name": "Globetrotter"}', "--json"],
      tmpdir()
    );
    expect(outsideRun.exitCode).toBe(0);
    const outsideRes = JSON.parse(outsideRun.stdout.toString());
    expect(outsideRes.ok).toBe(true);
    expect(outsideRes.data.message).toBe("Howdy, Globetrotter!");

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
      expect(crossVal.exitCode).toBe(0);
      const crossValData = JSON.parse(crossVal.stdout.toString());
      expect(crossValData.valid).toBe(true);
      expect(crossValData.results[0].warnings.length).toBe(0);
    } finally {
      rmSync(pkgBDir, { recursive: true, force: true });
    }

    // 13. unlink
    const unlinkProc = runCli(["unlink", "team.github-ops"], tmpdir());
    expect(unlinkProc.exitCode).toBe(0);
    expect(unlinkProc.stdout.toString()).toContain("[OK] Unlinked package");
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
    expect(linkProc.exitCode).toBe(0);

    // 4. Test ad info from an outside directory
    const infoProc = runCli(["info", "symlink-pkg.demo", "--json"], tmpdir(), customEnv);
    expect(infoProc.exitCode).toBe(0);
    const infoData = JSON.parse(infoProc.stdout.toString());
    expect(infoData.id).toBe("symlink-pkg.demo");

    // 5. Test ad list from outside directory
    const listProc = runCli(["list", "-P", "symlink-pkg.demo", "--json"], tmpdir(), customEnv);
    expect(listProc.exitCode).toBe(0);
    const listData = JSON.parse(listProc.stdout.toString());
    expect(Array.isArray(listData)).toBe(true);
    expect(listData.length).toBeGreaterThan(0);
  });
});
