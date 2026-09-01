import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const cliPath = resolve(__dirname, "../bin/ac.js");

function runCli(args: string[], cwd?: string, env?: Record<string, string>) {
  return Bun.spawnSync(["bun", cliPath, ...args], {
    cwd,
    env: {
      ...process.env,
      ...env,
    },
    stdout: "pipe",
    stderr: "pipe",
  });
}

describe("CLI End-to-End", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "actiondock-cli-e2e-"));
    // Link root node_modules so @actiondock/sdk is available
    const rootNodeModules = resolve(__dirname, "../../../node_modules");
    if (existsSync(rootNodeModules)) {
      symlinkSync(rootNodeModules, join(tempDir, "node_modules"), "dir");
    }
  });

  afterEach(async () => {
    if (existsSync(tempDir)) {
      try {
        rmSync(tempDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
      } catch {
        await new Promise((r) => setTimeout(r, 200));
        try {
          rmSync(tempDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
        } catch {
          // Ignore
        }
      }
    }
  });

  it("completes full authoring workflow: init -> info -> validate -> run -> config -> state -> runs -> build -> export", () => {
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

    // 3. action list & show & validate (including intent fuzzy search and fallback)
    const listProc = runCli(["action", "list", "--json"], tempDir);
    expect(listProc.exitCode).toBe(0);
    const actionsList = JSON.parse(listProc.stdout.toString());
    expect(actionsList.length).toBe(1);
    expect(actionsList[0].id).toBe("sample.greet");

    // 3b. Test action list with --intent and positional fuzzy search
    const listIntentProc = runCli(["action", "list", "--intent", "greet|hello", "--json"], tempDir);
    expect(listIntentProc.exitCode).toBe(0);
    expect(JSON.parse(listIntentProc.stdout.toString()).length).toBe(1);

    const listPositionalProc = runCli(["action", "list", "greet", "--json"], tempDir);
    expect(listPositionalProc.exitCode).toBe(0);
    expect(JSON.parse(listPositionalProc.stdout.toString()).length).toBe(1);

    // Fallback when no match: returns full list by default
    const listFallbackProc = runCli(["action", "list", "--intent", "nomatch", "--json"], tempDir);
    expect(listFallbackProc.exitCode).toBe(0);
    expect(JSON.parse(listFallbackProc.stdout.toString()).length).toBe(1);

    // No fallback when --no-fallback is specified
    const listNoFallbackProc = runCli(
      ["action", "list", "--intent", "nomatch", "--no-fallback", "--json"],
      tempDir
    );
    expect(listNoFallbackProc.exitCode).toBe(0);
    expect(JSON.parse(listNoFallbackProc.stdout.toString()).length).toBe(0);

    const showProc = runCli(["action", "show", "sample.greet", "--json"], tempDir);

    expect(showProc.exitCode).toBe(0);
    const show = JSON.parse(showProc.stdout.toString());
    expect(show.id).toBe("sample.greet");
    expect(show.inputSchema).toBeDefined();

    const valProc = runCli(["action", "validate", "--json"], tempDir);
    expect(valProc.exitCode).toBe(0);
    const val = JSON.parse(valProc.stdout.toString());
    expect(val.valid).toBe(true);

    // 4. action run
    const runProc = runCli(
      ["action", "run", "sample.greet", "--input", '{"name": "Developer"}', "--timeout", "5s"],
      tempDir
    );
    expect(runProc.exitCode).toBe(0);
    const runRes = JSON.parse(runProc.stdout.toString());
    expect(runRes.ok).toBe(true);
    expect(runRes.data.message).toBe("Hello, Developer!");

    // Local async is rejected
    const localAsyncProc = runCli(
      ["action", "run", "sample.greet", "--input", '{"name": "Developer"}', "--async"],
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
    expect(stateGetAfterDel.stderr.toString()).toContain("not found");

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

    // Local runs cancel is rejected
    const cancelLocalProc = runCli(["runs", "cancel", runs[0].id], tempDir);
    expect(cancelLocalProc.exitCode).toBe(1);
    expect(cancelLocalProc.stderr.toString()).toContain("'ac runs cancel' is only supported for remote execution targets");



    // 9. build
    const buildProc = runCli(["build"], tempDir);
    expect(buildProc.exitCode).toBe(0);
    const expectedGithubOpsBin = process.platform === "win32" ? "github-ops.exe" : "github-ops";
    expect(existsSync(join(tempDir, "dist", expectedGithubOpsBin))).toBe(true);

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

    // 10b. export skill --standalone
    const exportStandaloneProc = runCli(["export", "skill", "--standalone"], tempDir);
    expect(exportStandaloneProc.exitCode).toBe(0);
    expect(
      existsSync(join(tempDir, "dist", "github-ops-skill", "bin", expectedGithubOpsBin))
    ).toBe(true);
    expect(
      existsSync(join(tempDir, "dist", "github-ops-skill", "actiondock.skill.json"))
    ).toBe(true);

    // 10c. export skill with --playbook selective flag
    const selectiveOut = join(tempDir, "dist", "custom-skill");
    const exportSelectiveProc = runCli(
      ["export", "skill", "--playbook", "greet-user", "-o", selectiveOut],
      tempDir
    );
    expect(exportSelectiveProc.exitCode).toBe(0);
    expect(existsSync(join(selectiveOut, "SKILL.md"))).toBe(true);
    expect(existsSync(join(selectiveOut, "playbooks", "greet-user.md"))).toBe(true);
    expect(existsSync(join(selectiveOut, "actions", "greet.ts"))).toBe(true);

    // 11. link package and execute from outside directory
    const linkProc = runCli(["link"], tempDir);
    expect(linkProc.exitCode).toBe(0);
    expect(linkProc.stdout.toString()).toContain("[OK] Linked package");

    // Execute from root (outside tempDir)
    const outsideRun = runCli(
      ["run", "sample.greet", "--input", '{"name": "Globetrotter"}'],
      tmpdir()
    );
    expect(outsideRun.exitCode).toBe(0);
    const outsideRes = JSON.parse(outsideRun.stdout.toString());
    expect(outsideRes.ok).toBe(true);
    expect(outsideRes.data.message).toBe("Howdy, Globetrotter!");

    // 12. unlink
    const unlinkProc = runCli(["unlink", "team.github-ops"], tmpdir());
    expect(unlinkProc.exitCode).toBe(0);
    expect(unlinkProc.stdout.toString()).toContain("[OK] Unlinked package");
  }, 30000);

  it("manages execution profiles and dispatches remote runs via ac serve", async () => {
    // 1. Initialize project in tempDir
    runCli(["init", "--id", "cloud.remote-node", "."], tempDir);

    // 2. Start HTTP server process via 'ac serve'
    const SECRET = "auth-token-xyz-987";
    const port = 5199;
    const serverUrl = `http://127.0.0.1:${port}`;

    const serveProc = Bun.spawn(
      ["bun", cliPath, "serve", "--port", String(port), "--host", "127.0.0.1", "--token", SECRET],
      {
        cwd: tempDir,
        stdout: "pipe",
        stderr: "pipe",
      }
    );

    // Give server 150ms to bind port
    await new Promise((r) => setTimeout(r, 150));

    const clientHome = mkdtempSync(join(tmpdir(), "actiondock-client-home-"));
    const env = { ACTIONDOCK_HOME: clientHome };

    try {
      // 3. Profile management commands
      const addProfileProc = runCli(
        ["profile", "add", "cloud-aliyun", "--server", serverUrl, "--token", SECRET, "--desc", "Aliyun Node 1"],
        tmpdir(),
        env
      );
      expect(addProfileProc.exitCode).toBe(0);
      expect(addProfileProc.stdout.toString()).toContain("[OK] Profile 'cloud-aliyun' configured");

      // Add profile with --token-env
      const addTokenEnvProc = runCli(
        ["profile", "add", "cloud-token-env", "--server", serverUrl, "--token-env", "REMOTE_TEST_TOKEN", "--desc", "Token Env Node"],
        tmpdir(),
        env
      );
      expect(addTokenEnvProc.exitCode).toBe(0);
      expect(addTokenEnvProc.stdout.toString()).toContain("[OK] Profile 'cloud-token-env' configured");

      const showProfileProc = runCli(["profile", "show", "cloud-aliyun", "--json"], tmpdir(), env);
      expect(showProfileProc.exitCode).toBe(0);
      const profileData = JSON.parse(showProfileProc.stdout.toString());
      expect(profileData.name).toBe("cloud-aliyun");
      expect(profileData.serverUrl).toBe(serverUrl);
      expect(profileData.tokenConfigured).toBe(true);
      expect(profileData.tokenSource).toBe("profile");
      expect(profileData.token).toBe("********");

      const showRevealProc = runCli(["profile", "show", "cloud-aliyun", "--reveal", "--json"], tmpdir(), env);
      expect(showRevealProc.exitCode).toBe(0);
      const revealData = JSON.parse(showRevealProc.stdout.toString());
      expect(revealData.token).toBe(SECRET);

      const showTokenEnvProc = runCli(
        ["profile", "show", "cloud-token-env", "--reveal", "--json"],
        tmpdir(),
        { ...env, REMOTE_TEST_TOKEN: SECRET }
      );
      expect(showTokenEnvProc.exitCode).toBe(0);
      const tokenEnvData = JSON.parse(showTokenEnvProc.stdout.toString());
      expect(tokenEnvData.tokenSource).toBe("tokenEnv");
      expect(tokenEnvData.token).toBe(SECRET);

      const listProfileProc = runCli(["profile", "list", "--json"], tmpdir(), env);
      expect(listProfileProc.exitCode).toBe(0);
      const listProfilesData = JSON.parse(listProfileProc.stdout.toString());
      expect(listProfilesData.some((p: any) => p.name === "cloud-aliyun")).toBe(true);
      expect(listProfilesData.some((p: any) => p.name === "cloud-token-env")).toBe(true);

      const listProfileIntent = runCli(["profile", "list", "--intent", "aliyun|tencent", "--json"], tmpdir(), env);
      expect(listProfileIntent.exitCode).toBe(0);
      expect(JSON.parse(listProfileIntent.stdout.toString()).some((p: any) => p.name === "cloud-aliyun")).toBe(true);

      // 4. Test connection via ac profile test
      const testProc = runCli(["profile", "test", "cloud-aliyun", "--json"], tmpdir(), env);
      expect(testProc.exitCode).toBe(0);
      const testResult = JSON.parse(testProc.stdout.toString());
      expect(testResult.ok).toBe(true);
      expect(testResult.status).toBe("ok");

      // 5. Query remote actions and info via --profile
      const remoteInfoProc = runCli(["info", "--profile", "cloud-aliyun", "--json"], tmpdir(), env);
      expect(remoteInfoProc.exitCode).toBe(0);
      const remoteInfo = JSON.parse(remoteInfoProc.stdout.toString());
      expect(remoteInfo.id).toBe("cloud.remote-node");

      const remoteListProc = runCli(["action", "list", "--profile", "cloud-aliyun", "--json"], tmpdir(), env);
      expect(remoteListProc.exitCode).toBe(0);
      const remoteActions = JSON.parse(remoteListProc.stdout.toString());
      expect(remoteActions.some((a: any) => a.id === "sample.greet")).toBe(true);

      const remoteListIntentProc = runCli(
        ["action", "list", "--profile", "cloud-aliyun", "--intent", "sample\\.greet", "--json"],
        tmpdir(),
        env
      );
      expect(remoteListIntentProc.exitCode).toBe(0);
      expect(JSON.parse(remoteListIntentProc.stdout.toString()).length).toBe(1);

      // 6. Execute action on remote server via ac run --profile
      const remoteRunProc = runCli(
        [
          "run",
          "sample.greet",
          "--profile",
          "cloud-aliyun",
          "--input",
          '{"name": "RemoteAgent"}',
          "--config",
          "SAMPLE_GREETING=Greetings from Cloud",
        ],
        tmpdir(),
        env
      );
      expect(remoteRunProc.exitCode).toBe(0);
      const runResult = JSON.parse(remoteRunProc.stdout.toString());
      expect(runResult.ok).toBe(true);
      expect(runResult.runId).toBeDefined();
      expect(runResult.data.message).toBe("Greetings from Cloud, RemoteAgent!");

      // 6b. Remote Async Run & Remote Runs Show & Remote Runs Cancel
      const remoteAsyncProc = runCli(
        [
          "run",
          "sample.greet",
          "--profile",
          "cloud-aliyun",
          "--input",
          '{"name": "AsyncAgent"}',
          "--async",
        ],
        tmpdir(),
        env
      );
      expect(remoteAsyncProc.exitCode).toBe(0);
      const asyncRunResult = JSON.parse(remoteAsyncProc.stdout.toString());
      expect(asyncRunResult.ok).toBe(true);
      expect(asyncRunResult.runId).toBeDefined();
      expect(asyncRunResult.status).toBe("running");

      // Query remote run via ac runs show --profile
      const remoteShowProc = runCli(
        ["runs", "show", asyncRunResult.runId, "--profile", "cloud-aliyun", "--json"],
        tmpdir(),
        env
      );
      expect(remoteShowProc.exitCode).toBe(0);
      const remoteRunRecord = JSON.parse(remoteShowProc.stdout.toString());
      expect(remoteRunRecord.id).toBe(asyncRunResult.runId);

      // Cancel remote run via ac runs cancel --profile
      const remoteCancelProc = runCli(
        ["runs", "cancel", asyncRunResult.runId, "--profile", "cloud-aliyun", "--json"],
        tmpdir(),
        env
      );
      // It might be 0 if cancelled or 1 if already finished by the time CLI ran
      expect([0, 1]).toContain(remoteCancelProc.exitCode);

      // 7. Remove profile
      const rmProc = runCli(["profile", "rm", "cloud-aliyun"], tmpdir(), env);
      expect(rmProc.exitCode).toBe(0);
      expect(rmProc.stdout.toString()).toContain("[OK] Profile 'cloud-aliyun' removed");

    } finally {
      serveProc.kill();
      await serveProc.exited.catch(() => {});
      if (existsSync(clientHome)) {
        try {
          rmSync(clientHome, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
        } catch {
          // Ignore
        }
      }
    }
  }, 30000);
});
