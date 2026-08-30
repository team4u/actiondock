import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const cliPath = resolve(__dirname, "../bin/ac.js");

function runCli(args: string[], cwd?: string) {
  return Bun.spawnSync(["bun", cliPath, ...args], {
    cwd,
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

  afterEach(() => {
    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
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

    // 3. action list & show & validate
    const listProc = runCli(["action", "list", "--json"], tempDir);
    expect(listProc.exitCode).toBe(0);
    const actionsList = JSON.parse(listProc.stdout.toString());
    expect(actionsList.length).toBe(1);
    expect(actionsList[0].id).toBe("sample.greet");

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
      ["action", "run", "sample.greet", "--input", '{"name": "Developer"}'],
      tempDir
    );
    expect(runProc.exitCode).toBe(0);
    const runRes = JSON.parse(runProc.stdout.toString());
    expect(runRes.ok).toBe(true);
    expect(runRes.data.message).toBe("Hello, Developer!");

    // 5. playbook list & show & validate
    const pbListProc = runCli(["playbook", "list", "--json"], tempDir);
    expect(pbListProc.exitCode).toBe(0);
    const pbList = JSON.parse(pbListProc.stdout.toString());
    expect(pbList.length).toBe(1);

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

    const runWithNewConf = runCli(
      ["run", "sample.greet", "--input", '{"name": "Cowboy"}'],
      tempDir
    );
    expect(runWithNewConf.exitCode).toBe(0);
    const runWithNewConfRes = JSON.parse(runWithNewConf.stdout.toString());
    expect(runWithNewConfRes.data.message).toBe("Howdy, Cowboy!");

    // 7. state list & get
    const stateList = runCli(["state", "list", "--json"], tempDir);
    expect(stateList.exitCode).toBe(0);
    const stateKeys = JSON.parse(stateList.stdout.toString());
    expect(stateKeys).toContain("greet_count");

    const stateGet = runCli(["state", "get", "greet_count", "--json"], tempDir);
    expect(stateGet.exitCode).toBe(0);
    const stateVal = JSON.parse(stateGet.stdout.toString());
    expect(stateVal.value).toBe(2);

    // 8. runs list & show
    const runsListProc = runCli(["runs", "list", "--json"], tempDir);
    expect(runsListProc.exitCode).toBe(0);
    const runs = JSON.parse(runsListProc.stdout.toString());
    expect(runs.length).toBe(2);

    const runShowProc = runCli(["runs", "show", runs[0].id, "--json"], tempDir);
    expect(runShowProc.exitCode).toBe(0);
    const runDetail = JSON.parse(runShowProc.stdout.toString());
    expect(runDetail.id).toBe(runs[0].id);
    expect(runDetail.status).toBe("success");

    // 9. build
    const buildProc = runCli(["build"], tempDir);
    expect(buildProc.exitCode).toBe(0);
    expect(existsSync(join(tempDir, "dist", "github-ops"))).toBe(true);

    // 10. export skill
    const exportProc = runCli(["export", "skill"], tempDir);
    expect(exportProc.exitCode).toBe(0);
    expect(
      existsSync(join(tempDir, "dist", "github-ops-skill", "SKILL.md"))
    ).toBe(true);
    expect(
      existsSync(join(tempDir, "dist", "github-ops-skill", "bin", "github-ops"))
    ).toBe(true);

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
  });
});
