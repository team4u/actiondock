import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  initProject,
} from "@actiondock/core";
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

    initProject(tempDir, { id: "reg.demo", name: "Regression Demo" });
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

  it("supports common options passed before or after subcommands", () => {
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
    const absActionProc = runCli(["action", "create", "test.abs-action", "--file", absPath], tempDir);
    expect(absActionProc.exitCode).not.toBe(0);
    expect(absActionProc.stderr.toString()).toContain("relative path");

    // Action create rejects path traversal
    const traversalActionProc = runCli(["action", "create", "test.traversal-action", "--file", "../outside.ts"], tempDir);
    expect(traversalActionProc.exitCode).not.toBe(0);

    // Playbook create rejects absolute path
    const absPbProc = runCli(["playbook", "create", "test.abs-playbook", "--file", absPath], tempDir);
    expect(absPbProc.exitCode).not.toBe(0);
    expect(absPbProc.stderr.toString()).toContain("relative path");

    // Playbook create rejects path traversal
    const traversalPbProc = runCli(["playbook", "create", "test.traversal-playbook", "--file", "../outside.md"], tempDir);
    expect(traversalPbProc.exitCode).not.toBe(0);

    // Valid playbook create produces unordered list in instructions
    const validPbProc = runCli(["playbook", "create", "test.valid-pb", "--desc", "Test SOP"], tempDir);
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
      ["run", "sample.greet", "--input", '{"name": "Beijing"}', "--json"],
      tempDir,
      env
    );
    expect(runProc.exitCode).toBe(0);
    const runRes = JSON.parse(runProc.stdout.toString());
    expect(runRes.ok).toBe(true);
    expect(runRes.data.message).toBe("Nihao, Beijing!");
  });

  it("scaffolds new actions and playbooks via action create and playbook create and updates actiondock.json", () => {
    runCli(["init", "--id", "test.scaffold", "."], tempDir);

    const newActionProc = runCli(
      ["action", "create", "calculator", "--desc", "Perform calculations", "--file", "calc.ts"],
      tempDir
    );
    expect(newActionProc.exitCode).toBe(0);
    expect(existsSync(join(tempDir, "actions", "calc.ts"))).toBe(true);
    const actionContent = readFileSync(join(tempDir, "actions", "calc.ts"), "utf-8");
    expect(actionContent).toContain('import type { ActionInput, ActionOutput } from "../.actiondock/generated/actions";');
    expect(actionContent).toContain('export type Input = ActionInput<"calculator">;');
    expect(actionContent).toContain('export type Output = ActionOutput<"calculator">;');
    expect(actionContent).not.toContain("export interface Input {");
    expect(actionContent).not.toContain("export interface Output {");

    // Verify .actiondock/generated/actions.d.ts is automatically generated
    const generatedTypesPath = join(tempDir, ".actiondock", "generated", "actions.d.ts");
    expect(existsSync(generatedTypesPath)).toBe(true);
    const generatedTypes = readFileSync(generatedTypesPath, "utf-8");
    expect(generatedTypes).toContain("export namespace Actions");
    expect(generatedTypes).toContain('"calculator": {');

    // Test nested action relative path computation
    const nestedActionProc = runCli(
      ["action", "create", "nested-calc", "--file", "math/sub/calc.ts"],
      tempDir
    );
    expect(nestedActionProc.exitCode).toBe(0);
    expect(existsSync(join(tempDir, "actions", "math", "sub", "calc.ts"))).toBe(true);
    const nestedContent = readFileSync(join(tempDir, "actions", "math", "sub", "calc.ts"), "utf-8");
    expect(nestedContent).toContain('import type { ActionInput, ActionOutput } from "../../../.actiondock/generated/actions";');
    expect(nestedContent).toContain('export type Input = ActionInput<"nested-calc">;');
    expect(nestedContent).toContain('export type Output = ActionOutput<"nested-calc">;');

    const manifestAfterAction = JSON.parse(readFileSync(join(tempDir, "actiondock.json"), "utf-8"));
    expect(manifestAfterAction.actions.calculator).toBeDefined();
    expect(manifestAfterAction.actions.calculator.description).toBe("Perform calculations");
    expect(manifestAfterAction.actions.calculator.entry).toBe("actions/calc.ts");
    expect(manifestAfterAction.actions["nested-calc"]).toBeDefined();
    expect(manifestAfterAction.actions["nested-calc"].entry).toBe("actions/math/sub/calc.ts");

    const newPlaybookProc = runCli(
      ["playbook", "create", "deploy-flow", "--desc", "Deployment flow SOP", "--actions", "calculator"],
      tempDir
    );
    expect(newPlaybookProc.exitCode).toBe(0);
    expect(existsSync(join(tempDir, "playbooks", "deploy-flow.md"))).toBe(true);

    const manifestAfterPb = JSON.parse(readFileSync(join(tempDir, "actiondock.json"), "utf-8"));
    expect(manifestAfterPb.playbooks["deploy-flow"]).toBeDefined();
    expect(manifestAfterPb.playbooks["deploy-flow"].description).toBe("Deployment flow SOP");
    expect(manifestAfterPb.playbooks["deploy-flow"].actions).toEqual(["calculator"]);
  });

  it("validates ad pack --dry-run", () => {
    runCli(["init", "--id", "test.build-modes", "."], tempDir);

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

  it("supports ad action create and rejects legacy action new alias", () => {
    runCli(["init", "--id", "test.action-cmd", "."], tempDir);

    const createProc = runCli(["action", "create", "worker-task", "--desc", "Worker Task"], tempDir);
    expect(createProc.exitCode).toBe(0);
    expect(existsSync(join(tempDir, "actions", "worker-task.ts"))).toBe(true);
    const workerContent = readFileSync(join(tempDir, "actions", "worker-task.ts"), "utf-8");
    expect(workerContent).toContain('import type { ActionInput, ActionOutput } from "../.actiondock/generated/actions";');
    expect(workerContent).toContain('export type Input = ActionInput<"worker-task">;');
    expect(workerContent).toContain('export type Output = ActionOutput<"worker-task">;');

    const create2Proc = runCli(["action", "create", "worker-task2", "--desc", "Worker Task 2"], tempDir);
    expect(create2Proc.exitCode).toBe(0);
    expect(existsSync(join(tempDir, "actions", "worker-task2.ts"))).toBe(true);
    const worker2Content = readFileSync(join(tempDir, "actions", "worker-task2.ts"), "utf-8");
    expect(worker2Content).toContain('import type { ActionInput, ActionOutput } from "../.actiondock/generated/actions";');
    expect(worker2Content).toContain('export type Input = ActionInput<"worker-task2">;');
    expect(worker2Content).toContain('export type Output = ActionOutput<"worker-task2">;');

    // 验证废弃别名 action new 被严格拒绝
    const legacyNewProc = runCli(["action", "new", "worker-task3"], tempDir);
    expect(legacyNewProc.exitCode).not.toBe(0);

    const typesPath = join(tempDir, ".actiondock", "generated", "actions.d.ts");
    expect(existsSync(typesPath)).toBe(true);
    const typesContent = readFileSync(typesPath, "utf-8");
    expect(typesContent).toContain('"worker-task": {');
    expect(typesContent).toContain('"worker-task2": {');

    // 验证 --input 和 --output 快捷字段契约与中性占位模版生成
    const greetProc = runCli(
      ["action", "create", "custom-greet", "--desc", "Greet Action", "--input", "name:string", "--output", "message:string"],
      tempDir
    );
    expect(greetProc.exitCode).toBe(0);
    const greetActionFile = readFileSync(join(tempDir, "actions", "custom-greet.ts"), "utf-8");
    expect(greetActionFile).toContain('message: "done",');
    const manifestJson = JSON.parse(readFileSync(join(tempDir, "actiondock.json"), "utf-8"));
    expect(manifestJson.actions["custom-greet"].inputSchema.properties.name.type).toBe("string");
    expect(manifestJson.actions["custom-greet"].outputSchema.properties.message.type).toBe("string");

    // 验证带有自定义输入与输出字段时的中性类型占位生成，确保不产生虚假字段访问
    const calcProc = runCli(
      ["action", "create", "calculate", "--input", "count:number", "--output", "success:boolean,total:number"],
      tempDir
    );
    expect(calcProc.exitCode).toBe(0);
    const calcContent = readFileSync(join(tempDir, "actions", "calculate.ts"), "utf-8");
    expect(calcContent).toContain("success: true,");
    expect(calcContent).toContain("total: 0,");
    expect(calcContent).not.toContain("exampleParam");
  });

  it("supports full action resource subcommands and strictly rejects legacy new/create commands", () => {
    runCli(["init", "--id", "test.action-subcommands", "."], tempDir);

    // 1. ad action list
    const listProc = runCli(["action", "list", "--json"], tempDir);
    expect(listProc.exitCode).toBe(0);
    const listData = JSON.parse(listProc.stdout.toString());
    expect(listData.some((a: any) => a.id === "sample.greet")).toBe(true);

    // 2. ad action describe / show
    const descProc = runCli(["action", "describe", "sample.greet", "--json"], tempDir);
    expect(descProc.exitCode).toBe(0);
    const descData = JSON.parse(descProc.stdout.toString());
    expect(descData.id).toBe("sample.greet");

    const showProc = runCli(["action", "show", "sample.greet", "--json"], tempDir);
    expect(showProc.exitCode).toBe(0);
    expect(JSON.parse(showProc.stdout.toString()).id).toBe("sample.greet");

    // 3. ad action validate
    const valProc = runCli(["action", "validate", "sample.greet", "--json"], tempDir);
    expect(valProc.exitCode).toBe(0);
    expect(JSON.parse(valProc.stdout.toString()).valid).toBe(true);

    // 4. ad action run
    const runProc = runCli(["action", "run", "sample.greet", "--input", '{"name":"Tester"}', "--json"], tempDir);
    expect(runProc.exitCode).toBe(0);
    const runRes = JSON.parse(runProc.stdout.toString());
    expect(runRes.ok).toBe(true);
    expect(runRes.data.message).toBe("Hello, Tester!");

    // 5. 验证彻底移除历史包袱：ad new、ad create 与 ad playbook new 均被拒绝
    const newActProc = runCli(["new", "action", "another-action"], tempDir);
    expect(newActProc.exitCode).not.toBe(0);

    const createActProc = runCli(["create", "action", "another-action"], tempDir);
    expect(createActProc.exitCode).not.toBe(0);

    const pbNewProc = runCli(["playbook", "new", "sop-task"], tempDir);
    expect(pbNewProc.exitCode).not.toBe(0);
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

  it("passes json option in ad build and ad pack", () => {
    runCli(["init", "--id", "test.json-pass", "."], tempDir);

    const packProc = runCli(["pack", "--dry-run", "--json"], tempDir);
    expect(packProc.exitCode).toBe(0);
    const packData = JSON.parse(packProc.stdout.toString());
    expect(packData.packageId).toBe("test.json-pass");

    const buildProc = runCli(["build", "--json"], tempDir);
    expect(buildProc.exitCode).toBe(0);
    const buildData = JSON.parse(buildProc.stdout.toString());
    expect(buildData.packageId).toBe("test.json-pass");
  });
});
