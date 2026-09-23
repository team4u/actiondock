import { afterEach, beforeEach, describe, expect, it, setDefaultTimeout } from "bun:test";
setDefaultTimeout(120000);
import { existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { initProject } from "@actiondock/core";
import pkg from "../package.json";

const cliPath = resolve(import.meta.dirname, "../bin/ad.js");

let customHome: string | undefined;

function runCli(args: string[], cwd?: string, env?: Record<string, string>) {
  return Bun.spawnSync(["bun", cliPath, ...args], {
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

  it("supports ad action run defaulting to raw mode and machine format with --json", () => {
    // 默认 raw 纯文本输出
    const rawProc = runCli(
      ["action", "run", "sample.greet", "--input", '{"name":"Tester"}'],
      tempDir,
      env
    );
    expect(rawProc.exitCode).toBe(0);
    expect(rawProc.stdout.toString().trim()).toBe("Hello, Tester!");

    // --json 模式输出标准机器信封
    const jsonProc = runCli(
      ["action", "run", "sample.greet", "--input", '{"name":"Tester"}', "--json"],
      tempDir,
      env
    );
    expect(jsonProc.exitCode).toBe(0);
    const runRes = JSON.parse(jsonProc.stdout.toString());
    expect(runRes.ok).toBe(true);
    expect(runRes.data.message).toBe("Hello, Tester!");
  });
});
