import { afterEach, beforeEach, describe, expect, it, setDefaultTimeout } from "bun:test";
setDefaultTimeout(120000);
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { ACTION_ID_REGEX, loadActions } from "@actiondock/core";

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

describe("CLI Authoring & Build Workflow", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "actiondock-cli-wf-"));
    tempHome = mkdtempSync(join(tmpdir(), "actiondock-cli-wf-home-"));
    const rootNodeModules = resolve(import.meta.dirname, "../../../node_modules");
    if (existsSync(rootNodeModules)) {
      symlinkSync(rootNodeModules, join(tempDir, "node_modules"), "dir");
    }
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

  it("completes full authoring workflow: init -> info -> validate -> run -> config -> state -> runs -> build -> export", async () => {
    // 1. init
    const initProc = runCli(
      ["init", "--id", "team.github-ops", "--name", "GitHub Ops", "."],
      tempDir
    );
    expect(initProc.exitCode).toBe(0);

    // 2. info
    const infoProc = runCli(["info", "--json"], tempDir);
    expect(infoProc.exitCode).toBe(0);
    const info = JSON.parse(infoProc.stdout.toString());
    expect(info.id).toBe("team.github-ops");
    expect(info.actions).toContain("sample.greet");

    // 3. list & describe & validate (including intent fuzzy search and fallback)
    const listProc = runCli(["list", "--json"], tempDir);
    expect(listProc.exitCode).toBe(0);
    const actionsList = JSON.parse(listProc.stdout.toString());
    expect(actionsList.length).toBe(1);
    expect(actionsList[0].id).toBe("sample.greet");

    // 3b. Test list with --intent and positional fuzzy search
    const listIntentProc = runCli(["list", "--intent", "greet|hello", "--json"], tempDir);
    expect(listIntentProc.exitCode).toBe(0);
    expect(JSON.parse(listIntentProc.stdout.toString()).length).toBe(1);

    const listPositionalProc = runCli(["list", "greet", "--json"], tempDir);
    expect(listPositionalProc.exitCode).toBe(0);
    expect(JSON.parse(listPositionalProc.stdout.toString()).length).toBe(1);

    // In machine mode (--json / --envelope), no fallback by default when no match: returns empty array
    const listNoMatchProc = runCli(["list", "--intent", "nomatch", "--json"], tempDir);
    expect(listNoMatchProc.exitCode).toBe(0);
    expect(JSON.parse(listNoMatchProc.stdout.toString()).length).toBe(0);

    // Fallback only when explicitly requested via --fallback in machine mode
    const listFallbackProc = runCli(
      ["list", "--intent", "nomatch", "--fallback", "--json"],
      tempDir
    );
    expect(listFallbackProc.exitCode).toBe(0);
    const fallbackRes = JSON.parse(listFallbackProc.stdout.toString());
    expect(fallbackRes.isFallback).toBe(true);
    expect(fallbackRes.items.length).toBe(1);

    // No fallback when --no-fallback is specified
    const listNoFallbackProc = runCli(
      ["list", "--intent", "nomatch", "--no-fallback", "--json"],
      tempDir
    );
    expect(listNoFallbackProc.exitCode).toBe(0);
    expect(JSON.parse(listNoFallbackProc.stdout.toString()).length).toBe(0);

    const showProc = runCli(["describe", "sample.greet", "--json"], tempDir);

    expect(showProc.exitCode).toBe(0);
    const show = JSON.parse(showProc.stdout.toString());
    expect(show.id).toBe("sample.greet");
    expect(show.inputSchema).toBeDefined();

    const valProc = runCli(["validate", "--json"], tempDir);
    expect(valProc.exitCode).toBe(0);
    const val = JSON.parse(valProc.stdout.toString());
    expect(val.valid).toBe(true);

    // 4. run
    const runProc = runCli(
      ["run", "sample.greet", "--input", '{"name": "Developer"}', "--timeout", "5s"],
      tempDir
    );
    expect(runProc.exitCode).toBe(0);
    const runRes = JSON.parse(runProc.stdout.toString());
    expect(runRes.ok).toBe(true);
    expect(runRes.data.message).toBe("Hello, Developer!");

    // Local async is rejected
    const localAsyncProc = runCli(
      ["run", "sample.greet", "--input", '{"name": "Developer"}', "--async"],
      tempDir
    );
    expect(localAsyncProc.exitCode).toBe(1);
    expect(localAsyncProc.stderr.toString()).toContain("Async execution requires a long-running ActionDock server");


    // 5. playbook list & show & validate
    const pbListProc = runCli(["playbook", "list", "--json"], tempDir);
    expect(pbListProc.exitCode).toBe(0);
    const pbList = JSON.parse(pbListProc.stdout.toString());
    expect(pbList.length).toBe(1);

    const pbListIntent = runCli(["playbook", "list", "greet", "--json"], tempDir);
    expect(pbListIntent.exitCode).toBe(0);
    expect(JSON.parse(pbListIntent.stdout.toString()).length).toBe(1);

    const pbListStrict = runCli(["playbook", "list", "nomatch", "--no-fallback", "--json"], tempDir);
    expect(pbListStrict.exitCode).toBe(0);
    expect(JSON.parse(pbListStrict.stdout.toString()).length).toBe(0);

    const pbShowProc = runCli(["playbook", "show", "greet-user", "--json"], tempDir);
    expect(pbShowProc.exitCode).toBe(0);
    const pbShow = JSON.parse(pbShowProc.stdout.toString());
    expect(pbShow.id).toBe("greet-user");

    const pbValProc = runCli(["playbook", "validate", "--json"], tempDir);
    expect(pbValProc.exitCode).toBe(0);

    // 6. config set/get/list/delete
    const confSet = runCli(["config", "set", "SAMPLE_GREETING", "Howdy"], tempDir);
    expect(confSet.exitCode).toBe(0);

    const confGet = runCli(["config", "get", "SAMPLE_GREETING", "--json"], tempDir);
    expect(confGet.exitCode).toBe(0);
    const confObj = JSON.parse(confGet.stdout.toString());
    expect(confObj.value).toBe("Howdy");

    const confListIntent = runCli(["config", "list", "--intent", "SAMPLE.*GREETING", "--json"], tempDir);
    expect(confListIntent.exitCode).toBe(0);
    expect(JSON.parse(confListIntent.stdout.toString()).some((c: any) => c.key === "SAMPLE_GREETING")).toBe(true);

    const runWithNewConf = runCli(
      ["run", "sample.greet", "--input", '{"name": "Cowboy"}'],
      tempDir
    );
    expect(runWithNewConf.exitCode).toBe(0);
    const runWithNewConfRes = JSON.parse(runWithNewConf.stdout.toString());
    expect(runWithNewConfRes.data.message).toBe("Howdy, Cowboy!");

    // 6b. config from environment variables
    const confDel = runCli(["config", "delete", "SAMPLE_GREETING"], tempDir);
    expect(confDel.exitCode).toBe(0);

    const confGetEnv = runCli(
      ["config", "get", "SAMPLE_GREETING", "--json"],
      tempDir,
      { SAMPLE_GREETING: "Bonjour" }
    );
    expect(confGetEnv.exitCode).toBe(0);
    const confEnvObj = JSON.parse(confGetEnv.stdout.toString());
    expect(confEnvObj.value).toBe("Bonjour");
    expect(confEnvObj.source).toBe("env");

    const confSchemaEnv = runCli(
      ["config", "schema", "--json"],
      tempDir,
      { SAMPLE_GREETING: "Bonjour" }
    );
    expect(confSchemaEnv.exitCode).toBe(0);
    const schemaObj = JSON.parse(confSchemaEnv.stdout.toString());
    const greetingItem = schemaObj.configs.find((c: any) => c.key === "SAMPLE_GREETING");
    expect(greetingItem.source).toBe("env");
    expect(greetingItem.status).toBe("SET");

    // config env --json verification
    const confEnvCheck = runCli(
      ["config", "env", "--json"],
      tempDir,
      { SAMPLE_GREETING: "Bonjour" }
    );
    expect(confEnvCheck.exitCode).toBe(0);
    const envCheckObj = JSON.parse(confEnvCheck.stdout.toString());
    expect(envCheckObj.ok).toBe(true);
    const greetingEnvItem = envCheckObj.envChecks.find((c: any) => c.key === "SAMPLE_GREETING");
    expect(greetingEnvItem.satisfied).toBe(true);
    expect(greetingEnvItem.matchedEnv).toBe("SAMPLE_GREETING");

    const runWithEnv = runCli(
      ["run", "sample.greet", "--input", '{"name": "Jean"}'],
      tempDir,
      { SAMPLE_GREETING: "Bonjour" }
    );
    expect(runWithEnv.exitCode).toBe(0);
    const runWithEnvRes = JSON.parse(runWithEnv.stdout.toString());
    expect(runWithEnvRes.data.message).toBe("Bonjour, Jean!");

    // Restore SQLite config
    runCli(["config", "set", "SAMPLE_GREETING", "Howdy"], tempDir);

    // 7. state list & get & set with --ttl
    const stateList = runCli(["state", "list", "--json"], tempDir);
    expect(stateList.exitCode).toBe(0);
    const stateKeys = JSON.parse(stateList.stdout.toString());
    expect(stateKeys).toContain("greet_count");

    const stateListIntent = runCli(["state", "list", "--intent", "greet.*", "--json"], tempDir);
    expect(stateListIntent.exitCode).toBe(0);
    expect(JSON.parse(stateListIntent.stdout.toString())).toContain("greet_count");

    const stateGet = runCli(["state", "get", "greet_count", "--json"], tempDir);
    expect(stateGet.exitCode).toBe(0);
    const stateVal = JSON.parse(stateGet.stdout.toString());
    expect(stateVal.value).toBe(3);

    const stateSetTtl = runCli(
      ["state", "set", "short_lived", "session_abc", "--ttl", "1"],
      tempDir
    );
    expect(stateSetTtl.exitCode).toBe(0);
    const getShortLived = runCli(
      ["state", "get", "short_lived", "--json"],
      tempDir
    );
    expect(getShortLived.exitCode).toBe(0);
    expect(JSON.parse(getShortLived.stdout.toString()).value).toBe("session_abc");

    // 7b. Scoped state operations (namespace:key & -n flag)
    const stateSetScoped = runCli(
      ["state", "set", "cas-login:host", "vipshop.com"],
      tempDir
    );
    expect(stateSetScoped.exitCode).toBe(0);

    const stateGetScoped = runCli(
      ["state", "get", "cas-login:host", "--json"],
      tempDir
    );
    expect(stateGetScoped.exitCode).toBe(0);
    expect(JSON.parse(stateGetScoped.stdout.toString()).value).toBe("vipshop.com");
    expect(JSON.parse(stateGetScoped.stdout.toString()).namespace).toBe("cas-login");

    const stateGetScopedNs = runCli(
      ["state", "get", "host", "-n", "cas-login", "--json"],
      tempDir
    );
    expect(stateGetScopedNs.exitCode).toBe(0);
    expect(JSON.parse(stateGetScopedNs.stdout.toString()).value).toBe("vipshop.com");

    // Global list discovers scoped key
    const stateListAll = runCli(["state", "list", "--json"], tempDir);
    expect(stateListAll.exitCode).toBe(0);
    expect(JSON.parse(stateListAll.stdout.toString())).toContain("cas-login:host");

    // Scoped list only lists scoped keys
    const stateListNs = runCli(["state", "list", "-n", "cas-login", "--json"], tempDir);
    expect(stateListNs.exitCode).toBe(0);
    expect(JSON.parse(stateListNs.stdout.toString())).toEqual(["host"]);

    // Non-existent key delete fails with exitCode 1
    const stateDelNotFound = runCli(
      ["state", "delete", "not_exist_key"],
      tempDir
    );
    expect(stateDelNotFound.exitCode).toBe(1);
    expect(stateDelNotFound.stderr.toString()).toContain("not found");

    // Composite key delete succeeds
    const stateDelScoped = runCli(
      ["state", "delete", "cas-login:host"],
      tempDir
    );
    expect(stateDelScoped.exitCode).toBe(0);
    expect(stateDelScoped.stdout.toString()).toContain("deleted");

    // Verify it is actually deleted
    const stateGetAfterDel = runCli(
      ["state", "get", "cas-login:host", "--json"],
      tempDir
    );
    expect(stateGetAfterDel.exitCode).toBe(1);
    expect(stateGetAfterDel.stdout.toString() + stateGetAfterDel.stderr.toString()).toContain("not found");

    // Clear state test
    runCli(["state", "set", "cache:k1", "v1"], tempDir);
    runCli(["state", "set", "cache:k2", "v2"], tempDir);
    const clearProc = runCli(["state", "clear", "-n", "cache"], tempDir);
    expect(clearProc.exitCode).toBe(0);
    expect(clearProc.stdout.toString()).toContain("Cleared 2 state entry(s)");

    // 8. runs list & show
    const runsListProc = runCli(["runs", "list", "--json"], tempDir);
    expect(runsListProc.exitCode).toBe(0);
    const runs = JSON.parse(runsListProc.stdout.toString());
    expect(runs.length).toBe(3);

    const runsListIntent = runCli(["runs", "list", "--intent", "sample\\.greet", "--json"], tempDir);
    expect(runsListIntent.exitCode).toBe(0);
    expect(JSON.parse(runsListIntent.stdout.toString()).length).toBe(3);

    const runShowProc = runCli(["runs", "show", runs[0].id, "--json"], tempDir);
    expect(runShowProc.exitCode).toBe(0);
    const runDetail = JSON.parse(runShowProc.stdout.toString());
    expect(runDetail.id).toBe(runs[0].id);
    expect(runDetail.status).toBe("success");

    // Local runs cancel is rejected (ArgumentError, exit code 2)
    const cancelLocalProc = runCli(["runs", "cancel", runs[0].id], tempDir);
    expect(cancelLocalProc.exitCode).toBe(2);
    expect(cancelLocalProc.stderr.toString()).toContain("'ad runs cancel' is only supported for remote execution targets");

    // 8b. runs clear
    const clearRunsProc = runCli(["runs", "clear"], tempDir);
    expect(clearRunsProc.exitCode).toBe(0);
    expect(clearRunsProc.stdout.toString()).toContain("Cleared");

    const runsListAfterClear = runCli(["runs", "list", "--json"], tempDir);
    expect(runsListAfterClear.exitCode).toBe(0);
    expect(JSON.parse(runsListAfterClear.stdout.toString()).length).toBe(0);

    // 9. build
    const buildProc = runCli(["build"], tempDir);
    expect(buildProc.exitCode).toBe(0);
    expect(existsSync(join(tempDir, "dist", "github-ops-build", "entry.mjs"))).toBe(true);
    expect(existsSync(join(tempDir, "dist", "github-ops-build", "package.json"))).toBe(true);
    expect(existsSync(join(tempDir, "dist", "github-ops-build", "artifact.json"))).toBe(true);

    // 9b. pack：tarball 名采用 npm 实际产物名（与包名 team.github-ops 对齐）
    const packProc = runCli(["pack"], tempDir);
    expect(packProc.exitCode).toBe(0);
    expect(existsSync(join(tempDir, "dist", "team.github-ops-0.1.0.tgz"))).toBe(true);

    // 10. export skill (default: source skill)
    const exportProc = runCli(["export", "skill"], tempDir);
    expect(exportProc.exitCode).toBe(0);
    expect(
      existsSync(join(tempDir, "dist", "github-ops-skill", "SKILL.md"))
    ).toBe(true);
    expect(
      existsSync(join(tempDir, "dist", "github-ops-skill", "actiondock.json"))
    ).toBe(true);
    expect(
      existsSync(join(tempDir, "dist", "github-ops-skill", "package.json"))
    ).toBe(true);
    expect(
      existsSync(join(tempDir, "dist", "github-ops-skill", "actions", "greet.ts"))
    ).toBe(true);

    // 10b. export skill --mode node
    const exportNodeProc = runCli(["export", "skill", "--mode", "node"], tempDir);
    expect(exportNodeProc.exitCode).toBe(0);
    expect(
      existsSync(join(tempDir, "dist", "github-ops-skill", "entry.mjs"))
    ).toBe(true);

    // 10c. export skill rejects --standalone
    const exportStandaloneProc = runCli(["export", "skill", "--standalone"], tempDir);
    expect(exportStandaloneProc.exitCode).not.toBe(0);

    // 10d. export skill with --playbook selective flag
    const selectiveOut = join(tempDir, "dist", "custom-skill");
    const exportSelectiveProc = runCli(
      ["export", "skill", "--playbook", "greet-user", "-o", selectiveOut],
      tempDir
    );
    expect(exportSelectiveProc.exitCode).toBe(0);
    expect(existsSync(join(selectiveOut, "SKILL.md"))).toBe(true);
    expect(existsSync(join(selectiveOut, "playbooks", "greet-user.md"))).toBe(true);
    expect(existsSync(join(selectiveOut, "actions", "greet.ts"))).toBe(true);

    // 10d. export skill --bundle composite mode
    const bundleOut = join(tempDir, "dist", "my-composite-suite");
    const exportBundleProc = runCli(
      ["export", "skill", "--bundle", "my-composite-suite", "-o", bundleOut],
      tempDir
    );
    expect(exportBundleProc.exitCode).toBe(0);
    expect(existsSync(join(bundleOut, "SKILL.md"))).toBe(true);
    expect(existsSync(join(bundleOut, "actiondock.skill.json"))).toBe(false);
    expect(existsSync(join(bundleOut, "packages", "github-ops"))).toBe(true);
    expect(existsSync(join(bundleOut, "packages", "github-ops", "SKILL.md"))).toBe(false);

    // 往返校验：对每个导出包跑 loadActions 必须零错误
    const exportedPackagesDir = join(bundleOut, "packages");
    const subpkgs = readdirSync(exportedPackagesDir);
    expect(subpkgs.length).toBeGreaterThan(0);
    for (const subpkg of subpkgs) {
      const subpkgDir = join(exportedPackagesDir, subpkg);
      if (statSync(subpkgDir).isDirectory()) {
        const loaded = await loadActions(subpkgDir);
        expect(loaded.size).toBeGreaterThan(0);
        for (const [id] of loaded) {
          expect(ACTION_ID_REGEX.test(id)).toBe(true);
        }
      }
    }

    // 10e. export skill validation tests: conflict rejection
    const conflictProc = runCli(["export", "skill", "--bundle", "suite", "--mode", "node"], tempDir);
    expect(conflictProc.exitCode).not.toBe(0);
    expect(conflictProc.stderr.toString()).toContain("Composite Skill export (--bundle) currently only supports source mode");

    const conflictSourceProc = runCli(["export", "skill", "--all", "--workspace"], tempDir);
    expect(conflictSourceProc.exitCode).not.toBe(0);
    expect(conflictSourceProc.stderr.toString()).toContain("mutually exclusive");

    // 10f. export skill with pre-existing SKILL.md reuse
    const preExistingSkillPath = join(tempDir, "SKILL.md");
    writeFileSync(preExistingSkillPath, "# Custom Pre-existing CLI Skill\n", "utf-8");
    try {
      const reuseOut = join(tempDir, "dist", "reuse-skill");
      const reuseProc = runCli(["export", "skill", "-o", reuseOut], tempDir);
      expect(reuseProc.exitCode).toBe(0);
      expect(reuseProc.stdout.toString()).toContain("Reused existing file from");
      const content = readFileSync(join(reuseOut, "SKILL.md"), "utf-8");
      expect(content).toContain("Custom Pre-existing CLI Skill");
    } finally {
      rmSync(preExistingSkillPath, { force: true });
    }

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
    const outsideBuildOut = join(tmpdir(), "dist-outside-bin");
    const outsideBuild = runCli(["build", "-P", "team.github-ops", "-o", outsideBuildOut], tmpdir());
    expect(outsideBuild.exitCode).toBe(0);
    expect(existsSync(join(outsideBuildOut, "entry.mjs"))).toBe(true);

    // Export with -P from outside directory
    const outsideExportDir = join(tmpdir(), "dist-outside-skill");
    const outsideExport = runCli(["export", "skill", "-P", "team.github-ops", "-o", outsideExportDir], tmpdir());
    expect(outsideExport.exitCode).toBe(0);
    expect(existsSync(join(outsideExportDir, "SKILL.md"))).toBe(true);

    // Execute from root (outside tempDir)
    const outsideRun = runCli(
      ["run", "sample.greet", "--input", '{"name": "Globetrotter"}'],
      tmpdir()
    );
    expect(outsideRun.exitCode).toBe(0);
    const outsideRes = JSON.parse(outsideRun.stdout.toString());
    expect(outsideRes.ok).toBe(true);
    expect(outsideRes.data.message).toBe("Howdy, Globetrotter!");

    // 12. Validate cross-package action in playbook
    const pkgBDir = join(tmpdir(), `test-ad-pkgb-${Date.now()}`);
    mkdirSync(pkgBDir, { recursive: true });
    const rootNodeModules = resolve(import.meta.dirname, "../../../node_modules");
    if (existsSync(rootNodeModules)) {
      symlinkSync(rootNodeModules, join(pkgBDir, "node_modules"), "dir");
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
    rmSync(pkgBDir, { recursive: true, force: true });

    // 13. unlink
    const unlinkProc = runCli(["unlink", "team.github-ops"], tmpdir());
    expect(unlinkProc.exitCode).toBe(0);
    expect(unlinkProc.stdout.toString()).toContain("[OK] Unlinked package");
  }, 120000);
});
