import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import pkg from "../package.json";

const cliPath = resolve(import.meta.dirname, "../bin/ad.js");

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

describe("CLI Review & Machine Contract Regression", () => {
  let tempDir: string;
  let customHome: string;
  let customDataDir: string;
  let env: Record<string, string>;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "actiondock-regression-project-"));
    customHome = mkdtempSync(join(tmpdir(), "actiondock-regression-home-"));
    customDataDir = mkdtempSync(join(tmpdir(), "actiondock-regression-data-"));
    env = { ACTIONDOCK_HOME: customHome };

    const rootNodeModules = resolve(import.meta.dirname, "../../../node_modules");
    if (existsSync(rootNodeModules)) {
      symlinkSync(rootNodeModules, join(tempDir, "node_modules"), "dir");
    }

    runCli(["init", "--id", "reg.demo", "--name", "Regression Demo", "."], tempDir, env);
  });

  afterEach(() => {
    for (const dir of [tempDir, customHome, customDataDir]) {
      if (existsSync(dir)) {
        try {
          rmSync(dir, { recursive: true, force: true });
        } catch {
          // ignore
        }
      }
    }
  });

  it("supports -v, -V, and --version flags returning exit code 0 and package version", () => {
    const vProc = runCli(["-v"], tempDir, env);
    expect(vProc.exitCode).toBe(0);
    expect(vProc.stdout.toString().trim()).toBe(pkg.version);

    const capVProc = runCli(["-V"], tempDir, env);
    expect(capVProc.exitCode).toBe(0);
    expect(capVProc.stdout.toString().trim()).toBe(pkg.version);

    const fullVProc = runCli(["--version"], tempDir, env);
    expect(fullVProc.exitCode).toBe(0);
    expect(fullVProc.stdout.toString().trim()).toBe(pkg.version);
  });

  it("enforces strict target resolution with exit code 2 on nonexistent package across all commands", () => {
    const nonExistentId = "review-nonexistent-pkg";

    // 1. ad info -P
    const infoProc = runCli(["info", "-P", nonExistentId, "--json"], tempDir, env);
    expect(infoProc.exitCode).toBe(2);
    const infoJson = JSON.parse(infoProc.stdout.toString());
    expect(infoJson.ok).toBe(false);
    expect(infoJson.error.code).toBe("INVALID_ARGUMENT");
    expect(infoJson.error.message).toContain(`Package '${nonExistentId}' not found`);

    // 2. ad list -P
    const actListProc = runCli(["list", "-P", nonExistentId, "--json"], tempDir, env);
    expect(actListProc.exitCode).toBe(2);
    const actListJson = JSON.parse(actListProc.stdout.toString());
    expect(actListJson.ok).toBe(false);
    expect(actListJson.error.code).toBe("INVALID_ARGUMENT");

    // 3. ad run -P
    const actRunProc = runCli(["run", "greet", "-P", nonExistentId, "--json"], tempDir, env);
    expect(actRunProc.exitCode).toBe(2);
    const actRunJson = JSON.parse(actRunProc.stdout.toString());
    expect(actRunJson.ok).toBe(false);
    expect(actRunJson.error.code).toBe("INVALID_ARGUMENT");

    // 4. ad config list -P
    const cfgListProc = runCli(["config", "list", "-P", nonExistentId, "--json"], tempDir, env);
    expect(cfgListProc.exitCode).toBe(2);
    const cfgListJson = JSON.parse(cfgListProc.stdout.toString());
    expect(cfgListJson.ok).toBe(false);
    expect(cfgListJson.error.code).toBe("INVALID_ARGUMENT");

    // 5. ad config get -P
    const cfgGetProc = runCli(["config", "get", "api_key", "-P", nonExistentId, "--json"], tempDir, env);
    expect(cfgGetProc.exitCode).toBe(2);
    const cfgGetJson = JSON.parse(cfgGetProc.stdout.toString());
    expect(cfgGetJson.ok).toBe(false);
    expect(cfgGetJson.error.code).toBe("INVALID_ARGUMENT");

    // 6. ad state list -P
    const stateListProc = runCli(["state", "list", "-P", nonExistentId, "--json"], tempDir, env);
    expect(stateListProc.exitCode).toBe(2);
    const stateListJson = JSON.parse(stateListProc.stdout.toString());
    expect(stateListJson.ok).toBe(false);
    expect(stateListJson.error.code).toBe("INVALID_ARGUMENT");

    // 7. ad state get -P
    const stateGetProc = runCli(["state", "get", "mykey", "-P", nonExistentId, "--json"], tempDir, env);
    expect(stateGetProc.exitCode).toBe(2);
    const stateGetJson = JSON.parse(stateGetProc.stdout.toString());
    expect(stateGetJson.ok).toBe(false);
    expect(stateGetJson.error.code).toBe("INVALID_ARGUMENT");

    // 8. ad runs list -P
    const runsListProc = runCli(["runs", "list", "-P", nonExistentId, "--json"], tempDir, env);
    expect(runsListProc.exitCode).toBe(2);
    const runsListJson = JSON.parse(runsListProc.stdout.toString());
    expect(runsListJson.ok).toBe(false);
    expect(runsListJson.error.code).toBe("INVALID_ARGUMENT");

    // 9. ad playbook list -P
    const pbListProc = runCli(["playbook", "list", "-P", nonExistentId, "--json"], tempDir, env);
    expect(pbListProc.exitCode).toBe(2);
    const pbListJson = JSON.parse(pbListProc.stdout.toString());
    expect(pbListJson.ok).toBe(false);
    expect(pbListJson.error.code).toBe("INVALID_ARGUMENT");

    // 10. ad playbook show -P
    const pbShowProc = runCli(["playbook", "show", "mypb", "-P", nonExistentId, "--json"], tempDir, env);
    expect(pbShowProc.exitCode).toBe(2);
    const pbShowJson = JSON.parse(pbShowProc.stdout.toString());
    expect(pbShowJson.ok).toBe(false);
    expect(pbShowJson.error.code).toBe("INVALID_ARGUMENT");
  });

  it("maintains stable machine contract with exit code 0 when search keywords have no matches", () => {
    // Unmatched keyword in info search
    const noMatchProc = runCli(["info", "nonexistent-keyword-9999", "--json"], tmpdir(), env);
    expect(noMatchProc.exitCode).toBe(0);
    const noMatchJson = JSON.parse(noMatchProc.stdout.toString());
    expect(noMatchJson.linkedPackages).toEqual([]);
    expect(noMatchJson.matchedCount).toBe(0);
    expect(noMatchJson.isFallback).toBe(false);

    // Unmatched keyword with --intent
    const noMatchIntentProc = runCli(["info", "-i", "nonexistent-keyword-9999", "--json"], tmpdir(), env);
    expect(noMatchIntentProc.exitCode).toBe(0);
    const noMatchIntentJson = JSON.parse(noMatchIntentProc.stdout.toString());
    expect(noMatchIntentJson.linkedPackages).toEqual([]);
    expect(noMatchIntentJson.matchedCount).toBe(0);
    expect(noMatchIntentJson.isFallback).toBe(false);

    // Unmatched action list
    const noMatchActionProc = runCli(["list", "--intent", "nonexistent-act-9999", "--json"], tempDir, env);
    expect(noMatchActionProc.exitCode).toBe(0);
    expect(JSON.parse(noMatchActionProc.stdout.toString())).toEqual([]);
  });

  it("supports common options passed before or after subcommands and envelope formatting", () => {
    // Before subcommand: ad --json list
    const preJson = runCli(["--json", "list"], tempDir, env);
    expect(preJson.exitCode).toBe(0);
    const preJsonList = JSON.parse(preJson.stdout.toString());
    expect(Array.isArray(preJsonList)).toBe(true);

    // After subcommand: ad list --json
    const postJson = runCli(["list", "--json"], tempDir, env);
    expect(postJson.exitCode).toBe(0);
    const postJsonList = JSON.parse(postJson.stdout.toString());
    expect(Array.isArray(postJsonList)).toBe(true);

    // Independent --envelope mode (without explicit --json): ad --envelope list
    const preEnv = runCli(["--envelope", "list"], tempDir, env);
    expect(preEnv.exitCode).toBe(0);
    const preEnvData = JSON.parse(preEnv.stdout.toString());
    expect(preEnvData.ok).toBe(true);
    expect(Array.isArray(preEnvData.data)).toBe(true);

    // After subcommand: ad list --envelope
    const postEnv = runCli(["list", "--envelope"], tempDir, env);
    expect(postEnv.exitCode).toBe(0);
    const postEnvData = JSON.parse(postEnv.stdout.toString());
    expect(postEnvData.ok).toBe(true);
    expect(Array.isArray(postEnvData.data)).toBe(true);
  });

  it("respects custom --data-dir isolation for state and config", () => {
    const otherDataDir = mkdtempSync(join(tmpdir(), "actiondock-regression-other-data-"));
    try {
      // Set state in customDataDir
      const setProc = runCli(
        ["state", "set", "custom_key", "custom_val", "--data-dir", customDataDir],
        tempDir,
        env
      );
      expect(setProc.exitCode).toBe(0);

      // Get from customDataDir -> exists
      const getCustomProc = runCli(
        ["state", "get", "custom_key", "--json", "--data-dir", customDataDir],
        tempDir,
        env
      );
      expect(getCustomProc.exitCode).toBe(0);
      const getCustomData = JSON.parse(getCustomProc.stdout.toString());
      expect(getCustomData.value).toBe("custom_val");

      // Get from otherDataDir -> not found (exit code 1)
      const getOtherProc = runCli(
        ["state", "get", "custom_key", "--json", "--data-dir", otherDataDir],
        tempDir,
        env
      );
      expect(getOtherProc.exitCode).toBe(1);
    } finally {
      if (existsSync(otherDataDir)) {
        rmSync(otherDataDir, { recursive: true, force: true });
      }
    }
  });

  it("enforces project boundary on --file for action create and playbook create and verifies playbook template format", () => {
    // Initialize project
    const initProc = runCli(["init", "--id", "test.boundary-app", "."], tempDir);
    expect(initProc.exitCode).toBe(0);

    // Action create rejects absolute path
    const absPath = resolve(tempDir, "outside-action.ts");
    const absActionProc = runCli(["new", "action", "test.abs-action", "--file", absPath], tempDir);
    expect(absActionProc.exitCode).not.toBe(0);
    expect(absActionProc.stderr.toString()).toContain("relative path");

    // Action create rejects path traversal
    const traversalActionProc = runCli(["new", "action", "test.traversal-action", "--file", "../outside.ts"], tempDir);
    expect(traversalActionProc.exitCode).not.toBe(0);

    // Playbook create rejects absolute path
    const absPbProc = runCli(["new", "playbook", "test.abs-playbook", "--file", absPath], tempDir);
    expect(absPbProc.exitCode).not.toBe(0);
    expect(absPbProc.stderr.toString()).toContain("relative path");

    // Playbook create rejects path traversal
    const traversalPbProc = runCli(["new", "playbook", "test.traversal-playbook", "--file", "../outside.md"], tempDir);
    expect(traversalPbProc.exitCode).not.toBe(0);

    // Valid playbook create produces unordered list in instructions
    const validPbProc = runCli(["new", "playbook", "test.valid-pb", "--desc", "Test SOP"], tempDir);
    expect(validPbProc.exitCode).toBe(0);

    const pbFilePath = join(tempDir, "playbooks", "test-valid-pb.md");
    expect(existsSync(pbFilePath)).toBe(true);
    const pbContent = readFileSync(pbFilePath, "utf-8");

    // Must contain unordered list bullet points
    expect(pbContent).toContain("- Inspect available actions with `<binary> list --json`.");
    expect(pbContent).toContain("- Follow the required steps to complete the task.");

    // Must NOT contain ordered list numbers
    expect(pbContent).not.toMatch(/^\s*\d+\.\s/m);
  });

  it("resolves global configuration in ad run via ctx.config.get fallback", () => {
    // 1. 设置全局配置: ad config set SAMPLE_GREETING Nihao --global
    const setGlobalProc = runCli(
      ["config", "set", "SAMPLE_GREETING", "Nihao", "--global"],
      tempDir,
      env
    );
    expect(setGlobalProc.exitCode).toBe(0);

    // 2. 验证全局配置存在: ad config get SAMPLE_GREETING --global --json
    const getGlobalProc = runCli(
      ["config", "get", "SAMPLE_GREETING", "--global", "--json"],
      tempDir,
      env
    );
    expect(getGlobalProc.exitCode).toBe(0);
    const getGlobalData = JSON.parse(getGlobalProc.stdout.toString());
    expect(getGlobalData.value).toBe("Nihao");

    // 3. 执行 ad run，验证 ctx.config.get 回退到全局配置
    const runProc = runCli(
      ["run", "sample.greet", "--input", '{"name": "Beijing"}'],
      tempDir,
      env
    );
    expect(runProc.exitCode).toBe(0);
    const runRes = JSON.parse(runProc.stdout.toString());
    expect(runRes.ok).toBe(true);
    expect(runRes.data.message).toBe("Nihao, Beijing!");
  });

  it("scaffolds new actions and playbooks via ad new and updates actiondock.json", () => {
    runCli(["init", "--id", "test.scaffold", "."], tempDir);

    const newActionProc = runCli(
      ["new", "action", "calculator", "--desc", "Perform calculations", "--file", "calc.ts"],
      tempDir
    );
    expect(newActionProc.exitCode).toBe(0);
    expect(existsSync(join(tempDir, "actions", "calc.ts"))).toBe(true);

    const manifestAfterAction = JSON.parse(readFileSync(join(tempDir, "actiondock.json"), "utf-8"));
    expect(manifestAfterAction.actions.calculator).toBeDefined();
    expect(manifestAfterAction.actions.calculator.description).toBe("Perform calculations");
    expect(manifestAfterAction.actions.calculator.entry).toBe("actions/calc.ts");

    const newPlaybookProc = runCli(
      ["new", "playbook", "deploy-flow", "--desc", "Deployment flow SOP", "--actions", "calculator"],
      tempDir
    );
    expect(newPlaybookProc.exitCode).toBe(0);
    expect(existsSync(join(tempDir, "playbooks", "deploy-flow.md"))).toBe(true);

    const manifestAfterPb = JSON.parse(readFileSync(join(tempDir, "actiondock.json"), "utf-8"));
    expect(manifestAfterPb.playbooks["deploy-flow"]).toBeDefined();
    expect(manifestAfterPb.playbooks["deploy-flow"].description).toBe("Deployment flow SOP");
    expect(manifestAfterPb.playbooks["deploy-flow"].actions).toEqual(["calculator"]);
  });

  it("enforces UNSUPPORTED_BUILD_MODE on ad build with --target or --bytecode and validates ad pack --dry-run", () => {
    runCli(["init", "--id", "test.build-modes", "."], tempDir);

    const targetProc = runCli(["build", "--target", "linux-x64", "--json"], tempDir);
    expect(targetProc.exitCode).not.toBe(0);
    const targetErr = JSON.parse(targetProc.stdout.toString() || targetProc.stderr.toString());
    expect(targetErr.error?.code || targetErr.code).toBe("UNSUPPORTED_BUILD_MODE");

    const byteProc = runCli(["build", "--bytecode", "--json"], tempDir);
    expect(byteProc.exitCode).not.toBe(0);
    const byteErr = JSON.parse(byteProc.stdout.toString() || byteProc.stderr.toString());
    expect(byteErr.error?.code || byteErr.code).toBe("UNSUPPORTED_BUILD_MODE");

    const packDryProc = runCli(["pack", "--dry-run", "--json"], tempDir);
    expect(packDryProc.exitCode).toBe(0);
    const packDryRes = JSON.parse(packDryProc.stdout.toString());
    expect(packDryRes.packageId).toBe("test.build-modes");
    expect(packDryRes.tarballPath).toBeUndefined();
  });

  it("supports linked package discovery and execution when ~/.actiondock is a symlink (OpenClaw setup)", () => {
    // 1. Initialize a package in tempDir
    runCli(["init", "--id", "openclaw.demo", "."], tempDir);

    // 2. Setup fake home where ~/.actiondock is a symlink to an external directory
    const realActionDockDir = join(tempDir, "real-openclaw-actiondock");
    mkdirSync(realActionDockDir, { recursive: true });

    const fakeUserHome = join(tempDir, "fake-user-home");
    mkdirSync(fakeUserHome, { recursive: true });
    symlinkSync(realActionDockDir, join(fakeUserHome, ".actiondock"), "dir");

    const customEnv = { ACTIONDOCK_HOME: fakeUserHome };

    // 3. Link the package under this symlink home
    const linkProc = runCli(["link"], tempDir, customEnv);
    expect(linkProc.exitCode).toBe(0);

    // 4. Test ad info from an outside directory
    const infoProc = runCli(["info", "openclaw.demo", "--json"], tmpdir(), customEnv);
    expect(infoProc.exitCode).toBe(0);
    const infoData = JSON.parse(infoProc.stdout.toString());
    expect(infoData.id).toBe("openclaw.demo");

    // 5. Test ad list from outside directory (Host-based discovery)
    const listProc = runCli(["list", "-P", "openclaw.demo", "--json"], tmpdir(), customEnv);
    expect(listProc.exitCode).toBe(0);
    const listData = JSON.parse(listProc.stdout.toString());
    expect(Array.isArray(listData)).toBe(true);
    expect(listData.length).toBeGreaterThan(0);

    // 6. Test ad describe from outside directory
    const firstActionId = listData[0].id;
    const describeProc = runCli(["describe", `openclaw.demo/${firstActionId}`, "--json"], tmpdir(), customEnv);
    expect(describeProc.exitCode).toBe(0);
    const describeData = JSON.parse(describeProc.stdout.toString());
    expect(describeData.id).toBe(firstActionId);
  });

  it("supports ad action create and ad action new aliases", () => {
    runCli(["init", "--id", "test.action-cmd", "."], tempDir);

    const createProc = runCli(["action", "create", "worker-task", "--desc", "Worker Task"], tempDir);
    expect(createProc.exitCode).toBe(0);
    expect(existsSync(join(tempDir, "actions", "worker-task.ts"))).toBe(true);

    const newProc = runCli(["action", "new", "worker-task2", "--desc", "Worker Task 2"], tempDir);
    expect(newProc.exitCode).toBe(0);
    expect(existsSync(join(tempDir, "actions", "worker-task2.ts"))).toBe(true);
  });

  it("outputs single JSON without duplicate error envelope and sets exit code 1 on execution failure", () => {
    runCli(["init", "--id", "test.err-double", "."], tempDir);

    // Create an action that throws an error
    const failActionPath = join(tempDir, "actions", "fail.ts");
    writeFileSync(
      failActionPath,
      `import { defineAction } from "@actiondock/sdk";
export default defineAction(async () => {
  throw new Error("Deliberate failure inside action");
});
`
    );

    const manifestPath = join(tempDir, "actiondock.json");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
    manifest.actions.fail = {
      entry: "actions/fail.ts",
      description: "Failing action",
    };
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

    const runProc = runCli(["run", "fail", "--json"], tempDir);
    expect(runProc.exitCode).toBe(1);

    const rawOutput = runProc.stdout.toString().trim();
    // rawOutput must be a single valid JSON object without trailing duplicate envelopes
    const parsed = JSON.parse(rawOutput);
    expect(parsed.ok).toBe(false);
  });

  it("sets exit code 1 on ad config schema when required config is missing", () => {
    runCli(["init", "--id", "test.cfg-schema", "."], tempDir);

    const manifestPath = join(tempDir, "actiondock.json");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
    manifest.config = {
      API_KEY: {
        description: "API Key required",
        required: true,
      },
    };
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

    const schemaProc = runCli(["config", "schema", "--json"], tempDir);
    expect(schemaProc.exitCode).toBe(1);
    const schemaData = JSON.parse(schemaProc.stdout.toString());
    expect(schemaData.ok).toBe(false);
    expect(schemaData.missingCount).toBe(1);
  });

  it("passes envelope option in ad build and ad pack", () => {
    runCli(["init", "--id", "test.envelope-pass", "."], tempDir);

    const packProc = runCli(["pack", "--dry-run", "--envelope"], tempDir);
    expect(packProc.exitCode).toBe(0);
    const packEnvelope = JSON.parse(packProc.stdout.toString());
    expect(packEnvelope.ok).toBe(true);
    expect(packEnvelope.data).toBeDefined();
    expect(packEnvelope.data.packageId).toBe("test.envelope-pass");

    const buildProc = runCli(["build", "--envelope"], tempDir);
    expect(buildProc.exitCode).toBe(0);
    const buildEnvelope = JSON.parse(buildProc.stdout.toString());
    expect(buildEnvelope.ok).toBe(true);
    expect(buildEnvelope.data).toBeDefined();
    expect(buildEnvelope.data.packageId).toBe("test.envelope-pass");
  });
});
