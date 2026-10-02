import { runCommandSync, whichExecutable } from "../../../scripts/lib/spawn-helper.mjs";
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";

import { existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { initProject } from "@actiondock/core";
import pkg from "../package.json";
import { runCliAsync } from "./helpers/run-cli";

const cliPath = resolve(import.meta.dirname, "../bin/ad.js");

let customHome: string | undefined;

function runCli(args: string[], cwd?: string, env?: Record<string, string>) {
  return runCommandSync(["bun", cliPath, ...args], {
    cwd,
    env: {
      ...process.env,
      ...(customHome ? { ACTIONDOCK_HOME: customHome } : {}),
      ...env,
    },
    stdout: "pipe",
    stderr: "pipe",
  });
}

describe("CLI Review - Commands & Arguments Regression", () => {
  let tempDir: string;
  let customDataDir: string;
  let env: Record<string, string>;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "actiondock-reg-cmd-project-"));
    customHome = mkdtempSync(join(tmpdir(), "actiondock-reg-cmd-home-"));
    customDataDir = mkdtempSync(join(tmpdir(), "actiondock-reg-cmd-data-"));
    process.env.ACTIONDOCK_HOME = customHome;
    env = { ACTIONDOCK_HOME: customHome };

    const rootNodeModules = resolve(import.meta.dirname, "../../../node_modules");
    if (existsSync(rootNodeModules)) {
      try {
        symlinkSync(rootNodeModules, join(tempDir, "node_modules"), "junction");
      } catch {
        // ignore
      }
    }

    initProject(tempDir, { id: "reg.demo", name: "Regression Demo" });
  });

  afterEach(() => {
    delete process.env.ACTIONDOCK_HOME;
    for (const dir of [tempDir, customHome, customDataDir]) {
      if (dir && existsSync(dir)) {
        try {
          rmSync(dir, { recursive: true, force: true });
        } catch {
          // ignore
        }
      }
    }
    customHome = undefined;
  });

  it("supports -v, -V, and --version flags returning exit code 0 and package version", async () => {
    const vProc = await runCliAsync(["-v"], tempDir, env);
    assert.strictEqual(vProc.exitCode, 0);
    assert.strictEqual(vProc.stdout.toString().trim(), pkg.version);

    const capVProc = await runCliAsync(["-V"], tempDir, env);
    assert.strictEqual(capVProc.exitCode, 0);
    assert.strictEqual(capVProc.stdout.toString().trim(), pkg.version);

    const fullVProc = await runCliAsync(["--version"], tempDir, env);
    assert.strictEqual(fullVProc.exitCode, 0);
    assert.strictEqual(fullVProc.stdout.toString().trim(), pkg.version);
  });

  it("supports top-level commands, rejects removed duplicate action subcommands and show alias", async () => {
    await runCliAsync(["init", "--id", "test.action-subcommands", "."], tempDir);

    // 1. 顶层 ad list
    const listProc = await runCliAsync(["list", "--json"], tempDir);
    assert.strictEqual(listProc.exitCode, 0);
    const listData = JSON.parse(listProc.stdout.toString());
    assert.strictEqual(listData.items.some((a: any) => a.id === "sample.greet"), true);

    // 2. 顶层 ad describe 正常工作，且废弃的 show 别名被移除
    const descProc = await runCliAsync(["describe", "sample.greet", "--json"], tempDir);
    assert.strictEqual(descProc.exitCode, 0);
    const descData = JSON.parse(descProc.stdout.toString());
    assert.strictEqual(descData.id, "sample.greet");

    const showProc = await runCliAsync(["show", "sample.greet", "--json"], tempDir);
    assert.notStrictEqual(showProc.exitCode, 0, "顶层 show 别名已被移除，应报错拒绝");

    // 3. 顶层 ad validate
    const valProc = await runCliAsync(["validate", "sample.greet", "--json"], tempDir);
    assert.strictEqual(valProc.exitCode, 0);
    assert.strictEqual(JSON.parse(valProc.stdout.toString()).valid, true);

    // 4. 顶层 ad run
    const runProc = await runCliAsync(["run", "sample.greet", "--input", '{"name":"Tester"}', "--json"], tempDir);
    assert.strictEqual(runProc.exitCode, 0);
    const runRes = JSON.parse(runProc.stdout.toString());
    assert.strictEqual(runRes.ok, true);
    assert.strictEqual(runRes.data.message, "Hello, Tester!");

    // 5. 验证 action 下重复套壳命令已被彻底删除，仅保留 action create
    const actListProc = await runCliAsync(["action", "list", "--json"], tempDir);
    assert.notStrictEqual(actListProc.exitCode, 0, "action list 套壳命令应被拒绝");

    const actDescProc = await runCliAsync(["action", "describe", "sample.greet", "--json"], tempDir);
    assert.notStrictEqual(actDescProc.exitCode, 0, "action describe 套壳命令应被拒绝");

    const actValProc = await runCliAsync(["action", "validate", "sample.greet", "--json"], tempDir);
    assert.notStrictEqual(actValProc.exitCode, 0, "action validate 套壳命令应被拒绝");

    const actRunProc = await runCliAsync(["action", "run", "sample.greet", "--input", '{"name":"Tester"}', "--json"], tempDir);
    assert.notStrictEqual(actRunProc.exitCode, 0, "action run 套壳命令应被拒绝");

    // 6. 验证彻底移除历史包袱：ad new、ad create 与 ad playbook new 均被拒绝
    const newActProc = await runCliAsync(["new", "action", "another-action"], tempDir);
    assert.notStrictEqual(newActProc.exitCode, 0);

    const createActProc = await runCliAsync(["create", "action", "another-action"], tempDir);
    assert.notStrictEqual(createActProc.exitCode, 0);

    const pbNewProc = await runCliAsync(["playbook", "new", "sop-task"], tempDir);
    assert.notStrictEqual(pbNewProc.exitCode, 0);
  });

  it("supports ad action create and rejects legacy action new alias", async () => {
    await runCliAsync(["init", "--id", "test.action-cmd", "."], tempDir);

    const createProc = await runCliAsync(["action", "create", "worker-task", "--desc", "Worker Task"], tempDir);
    assert.strictEqual(createProc.exitCode, 0);
    assert.strictEqual(existsSync(join(tempDir, "actions", "worker-task.ts")), true);
    const workerContent = readFileSync(join(tempDir, "actions", "worker-task.ts"), "utf-8");
    assert.ok((workerContent).includes('import type { ActionInput, ActionOutput } from "../.actiondock/generated/actions";'));
    assert.ok((workerContent).includes('export type Input = ActionInput<"worker-task">;'));
    assert.ok((workerContent).includes('export type Output = ActionOutput<"worker-task">;'));

    const create2Proc = await runCliAsync(["action", "create", "worker-task2", "--desc", "Worker Task 2"], tempDir);
    assert.strictEqual(create2Proc.exitCode, 0);
    assert.strictEqual(existsSync(join(tempDir, "actions", "worker-task2.ts")), true);
    const worker2Content = readFileSync(join(tempDir, "actions", "worker-task2.ts"), "utf-8");
    assert.ok((worker2Content).includes('import type { ActionInput, ActionOutput } from "../.actiondock/generated/actions";'));
    assert.ok((worker2Content).includes('export type Input = ActionInput<"worker-task2">;'));
    assert.ok((worker2Content).includes('export type Output = ActionOutput<"worker-task2">;'));

    // 验证废弃别名 action new 被严格拒绝
    const legacyNewProc = await runCliAsync(["action", "new", "worker-task3"], tempDir);
    assert.notStrictEqual(legacyNewProc.exitCode, 0);

    const typesPath = join(tempDir, ".actiondock", "generated", "actions.d.ts");
    assert.strictEqual(existsSync(typesPath), true);
    const typesContent = readFileSync(typesPath, "utf-8");
    assert.ok((typesContent).includes('"worker-task": {'));
    assert.ok((typesContent).includes('"worker-task2": {'));

    // 验证 --input 和 --output 快捷字段契约与中性占位模版生成
    const greetProc = await runCliAsync(
      ["action", "create", "custom-greet", "--desc", "Greet Action", "--input", "name:string", "--output", "message:string"],
      tempDir
    );
    assert.strictEqual(greetProc.exitCode, 0);
    const greetActionFile = readFileSync(join(tempDir, "actions", "custom-greet.ts"), "utf-8");
    assert.ok((greetActionFile).includes('message: "done",'));
    const manifestJson = JSON.parse(readFileSync(join(tempDir, "actiondock.json"), "utf-8"));
    assert.strictEqual(manifestJson.actions["custom-greet"].inputSchema.properties.name.type, "string");
    assert.strictEqual(manifestJson.actions["custom-greet"].outputSchema.properties.message.type, "string");

    // 验证带有自定义输入与输出字段时的中性类型占位生成，确保不产生虚假字段访问
    const calcProc = await runCliAsync(
      ["action", "create", "calculate", "--input", "count:number", "--output", "success:boolean,total:number"],
      tempDir
    );
    assert.strictEqual(calcProc.exitCode, 0);
    const calcContent = readFileSync(join(tempDir, "actions", "calculate.ts"), "utf-8");
    assert.ok((calcContent).includes("success: true,"));
    assert.ok((calcContent).includes("total: 0,"));
    assert.ok(!(calcContent).includes("exampleParam"));
  });

  it("enforces strict target resolution with exit code 2 on nonexistent package across all commands", async () => {
    const nonExistentId = "review-nonexistent-pkg";

    // 1. ad info -P
    const infoProc = await runCliAsync(["info", "-P", nonExistentId, "--json"], tempDir, env);
    assert.strictEqual(infoProc.exitCode, 2);
    const infoJson = JSON.parse(infoProc.stdout.toString());
    assert.strictEqual(infoJson.ok, false);
    assert.strictEqual(infoJson.error.code, "INVALID_ARGUMENT");
    assert.ok((infoJson.error.message).includes(`Package '${nonExistentId}' not found`));

    // 2. ad list -P
    const actListProc = await runCliAsync(["list", "-P", nonExistentId, "--json"], tempDir, env);
    assert.strictEqual(actListProc.exitCode, 2);
    const actListJson = JSON.parse(actListProc.stdout.toString());
    assert.strictEqual(actListJson.ok, false);
    assert.strictEqual(actListJson.error.code, "INVALID_ARGUMENT");

    // 3. ad run -P
    const actRunProc = await runCliAsync(["run", "greet", "-P", nonExistentId, "--json"], tempDir, env);
    assert.strictEqual(actRunProc.exitCode, 2);
    const actRunJson = JSON.parse(actRunProc.stdout.toString());
    assert.strictEqual(actRunJson.ok, false);
    assert.strictEqual(actRunJson.error.code, "INVALID_ARGUMENT");

    // 4. ad config list -P
    const cfgListProc = await runCliAsync(["config", "list", "-P", nonExistentId, "--json"], tempDir, env);
    assert.strictEqual(cfgListProc.exitCode, 2);
    const cfgListJson = JSON.parse(cfgListProc.stdout.toString());
    assert.strictEqual(cfgListJson.ok, false);
    assert.strictEqual(cfgListJson.error.code, "INVALID_ARGUMENT");

    // 5. ad config get -P
    const cfgGetProc = await runCliAsync(["config", "get", "api_key", "-P", nonExistentId, "--json"], tempDir, env);
    assert.strictEqual(cfgGetProc.exitCode, 2);
    const cfgGetJson = JSON.parse(cfgGetProc.stdout.toString());
    assert.strictEqual(cfgGetJson.ok, false);
    assert.strictEqual(cfgGetJson.error.code, "INVALID_ARGUMENT");

    // 6. ad state list -P
    const stateListProc = await runCliAsync(["state", "list", "-P", nonExistentId, "--json"], tempDir, env);
    assert.strictEqual(stateListProc.exitCode, 2);
    const stateListJson = JSON.parse(stateListProc.stdout.toString());
    assert.strictEqual(stateListJson.ok, false);
    assert.strictEqual(stateListJson.error.code, "INVALID_ARGUMENT");

    // 7. ad state get -P
    const stateGetProc = await runCliAsync(["state", "get", "mykey", "-P", nonExistentId, "--json"], tempDir, env);
    assert.strictEqual(stateGetProc.exitCode, 2);
    const stateGetJson = JSON.parse(stateGetProc.stdout.toString());
    assert.strictEqual(stateGetJson.ok, false);
    assert.strictEqual(stateGetJson.error.code, "INVALID_ARGUMENT");

    // 8. ad runs list -P
    const runsListProc = await runCliAsync(["runs", "list", "-P", nonExistentId, "--json"], tempDir, env);
    assert.strictEqual(runsListProc.exitCode, 2);
    const runsListJson = JSON.parse(runsListProc.stdout.toString());
    assert.strictEqual(runsListJson.ok, false);
    assert.strictEqual(runsListJson.error.code, "INVALID_ARGUMENT");

    // 9. ad playbook list -P
    const pbListProc = await runCliAsync(["playbook", "list", "-P", nonExistentId, "--json"], tempDir, env);
    assert.strictEqual(pbListProc.exitCode, 2);
    const pbListJson = JSON.parse(pbListProc.stdout.toString());
    assert.strictEqual(pbListJson.ok, false);
    assert.strictEqual(pbListJson.error.code, "INVALID_ARGUMENT");

    // 10. ad playbook show -P
    const pbShowProc = await runCliAsync(["playbook", "show", "mypb", "-P", nonExistentId, "--json"], tempDir, env);
    assert.strictEqual(pbShowProc.exitCode, 2);
    const pbShowJson = JSON.parse(pbShowProc.stdout.toString());
    assert.strictEqual(pbShowJson.ok, false);
    assert.strictEqual(pbShowJson.error.code, "INVALID_ARGUMENT");
  });

  it("supports ad run defaulting to raw mode and machine format with --json", async () => {
    // 默认 raw 纯文本输出（结构化对象按标准规范呈现）
    const rawProc = await runCliAsync(
      ["run", "sample.greet", "--input", '{"name":"Tester"}'],
      tempDir,
      env
    );
    assert.strictEqual(rawProc.exitCode, 0);
    const parsedRaw = JSON.parse(rawProc.stdout.toString());
    assert.strictEqual(parsedRaw.message, "Hello, Tester!");

    // --json 模式输出标准机器信封
    const jsonProc = await runCliAsync(
      ["run", "sample.greet", "--input", '{"name":"Tester"}', "--json"],
      tempDir,
      env
    );
    assert.strictEqual(jsonProc.exitCode, 0);
    const runRes = JSON.parse(jsonProc.stdout.toString());
    assert.strictEqual(runRes.ok, true);
    assert.strictEqual(runRes.data.message, "Hello, Tester!");
  });

  it("displays introspection guidance and flat input syntax in ad run help", async () => {
    const res = await runCliAsync(["run", "--help"], tempDir, env);
    assert.strictEqual(res.exitCode, 0);
    const output = res.stdout.toString();
    assert.ok((output).includes("Introspection & Guidance:"));
    assert.ok((output).includes("ad describe <id>"));
    assert.ok((output).includes("ad playbook list"));
    assert.ok((output).includes("ad playbook show <id>"));
    assert.ok((output).includes("Flat Input Syntax & Examples:"));
    assert.ok((output).includes("key=\"value\""));
    assert.ok((output).includes("count:=10"));
    assert.ok((output).includes("paths.0=\"src\""));
    assert.ok((output).includes("--input-file"));
  });
});

