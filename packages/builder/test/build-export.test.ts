import { runCommandSync } from "../../../scripts/lib/spawn-helper.mjs";
import assert from "node:assert/strict";
import { after, afterEach, before, beforeEach, describe, it } from "node:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { buildProject, buildProjectWithPlan } from "../src/build";
import { exportSkill } from "../src/exporter";
import { SelectionPlanner } from "../src/planner";
import { initProject } from "@actiondock/core";

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

describe("Build & Skill Export Contract", () => {
  let suiteBaseDir: string;
  let tempDir: string;
  let tempHome: string;
  let customDataDir: string;
  let caseIndex = 0;

  function runBin(cmdArray: string[], options: any = {}) {
    return runCommandSync(cmdArray, {
      cwd: tempDir,
      stdout: "pipe",
      stderr: "pipe",
      ...options,
      env: {
        ...process.env,
        ...(tempHome ? { ACTIONDOCK_HOME: tempHome } : {}),
        ...options.env,
      },
    });
  }

  before(() => {
    suiteBaseDir = mkdtempSync(join(tmpdir(), "actiondock-build-suite-"));
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
    customDataDir = join(tempDir, ".custom-data");

    // Link root node_modules so @actiondock/sdk is resolvable during build
    const rootNodeModules = resolve(import.meta.dirname, "../../../node_modules");
    if (existsSync(rootNodeModules)) {
      try {
        symlinkSync(rootNodeModules, join(tempDir, "node_modules"), "junction");
      } catch {}
    }
    initProject(tempDir, {
      id: "test.sample-tools",
      name: "Sample Tools",
      description: "Sample tool package for automated contract test",
    });
  });

  afterEach(() => {
    safeCleanDir(tempHome);
    safeCleanDir(tempDir);
  });

  it("builds a standalone executable and verifies CLI commands work in compiled binary", { timeout: 30000 }, async () => {
    const buildRes = await buildProject({
      projectRoot: tempDir,
    });

    assert.strictEqual(existsSync(buildRes.executablePath), true);
    assert.strictEqual(existsSync(buildRes.metadataPath), true);

    const metadata = JSON.parse(readFileSync(buildRes.metadataPath, "utf-8"));
    assert.strictEqual(metadata.packageId, "test.sample-tools");
    assert.deepStrictEqual(metadata.actions, ["sample.greet"]);

    // 1. Test binary `list --json`
    const listProc = runBin([buildRes.executablePath, "list", "--json"]);
    assert.strictEqual(listProc.exitCode, 0);
    const listJson = JSON.parse(listProc.stdout.toString());
    assert.deepStrictEqual(listJson.items, [
      { id: "sample.greet", description: "Greeting action demonstrating basic input, config, and state usage" },
    ]);
    assert.deepStrictEqual(listJson.hints, [
      "Tip: For composite or multi-step tasks, check 'ad playbook list' for standard operating procedures.",
    ]);

    // 1b. Test binary `list --intent greet --json` and `list nonexist --no-fallback --json`
    const listIntentProc = runBin([buildRes.executablePath, "list", "--intent", "greet|other", "--json"]);
    assert.strictEqual(listIntentProc.exitCode, 0);
    assert.strictEqual(JSON.parse(listIntentProc.stdout.toString()).items.length, 1);

    const listStrictProc = runBin([buildRes.executablePath, "list", "nomatch", "--no-fallback", "--json"]);
    assert.strictEqual(listStrictProc.exitCode, 0);
    assert.deepStrictEqual(JSON.parse(listStrictProc.stdout.toString()).items, []);

    // 2. Test binary `describe <id> --json`
    const descProc = runBin([buildRes.executablePath, "describe", "sample.greet", "--json"]);
    assert.strictEqual(descProc.exitCode, 0);
    const descJson = JSON.parse(descProc.stdout.toString());
    assert.strictEqual(descJson.id, "sample.greet");
    assert.notStrictEqual(descJson.inputSchema, undefined);

    // 3. Test binary `run <id> --input '...'` with default greeting
    const runProc = runBin([
      buildRes.executablePath,
      "run",
      "sample.greet",
      "--input",
      '{"name": "Antigravity"}',
      "--timeout",
      "5s",
      "--json",
    ]);
    assert.strictEqual(runProc.exitCode, 0);
    const runJson = JSON.parse(runProc.stdout.toString());
    assert.strictEqual(runJson.ok, true);
    assert.strictEqual(runJson.data.message, "Hello, Antigravity!");
    assert.notStrictEqual(runJson.runId, undefined);

    // 3b. Test binary rejects --async
    const asyncProc = runBin([
      buildRes.executablePath,
      "run",
      "sample.greet",
      "--input",
      '{"name": "Antigravity"}',
      "--async",
    ]);
    assert.strictEqual(asyncProc.exitCode, 1);
    assert.ok((asyncProc.stderr.toString()).includes(
      "Async execution is not supported in standalone single-execution binaries"
    ));

    // 4. Test binary `config set` and verify persistence in subsequent run
    const confSet = runBin([buildRes.executablePath, "config", "set", "SAMPLE_GREETING", "Welcome"]);
    assert.strictEqual(confSet.exitCode, 0);

    const confRun = runBin([
      buildRes.executablePath,
      "run",
      "sample.greet",
      "--input",
      '{"name": "Antigravity"}',
      "--json",
    ]);
    assert.strictEqual(confRun.exitCode, 0);
    const confRunJson = JSON.parse(confRun.stdout.toString());
    assert.strictEqual(confRunJson.data.message, "Welcome, Antigravity!");

    // 5. Test binary with custom --data-dir isolation
    const isolatedRun = runBin([
      buildRes.executablePath,
      "--data-dir",
      customDataDir,
      "run",
      "sample.greet",
      "--input",
      '{"name": "Isolated"}',
      "--json",
    ]);
    assert.strictEqual(isolatedRun.exitCode, 0);
    const isoJson = JSON.parse(isolatedRun.stdout.toString());
    // In new isolated data-dir, it uses default greeting ("Hello")
    assert.strictEqual(isoJson.data.message, "Hello, Isolated!");
  });

  it("exports Source Skill package by default with SKILL.md, actiondock.json, actions, and playbooks", async () => {
    const exportRes = await exportSkill({
      projectRoot: tempDir,
    });

    assert.strictEqual(exportRes.mode, "source");
    assert.strictEqual(existsSync(exportRes.skillDir), true);
    assert.strictEqual(existsSync(join(exportRes.skillDir, "SKILL.md")), true);
    assert.strictEqual(existsSync(join(exportRes.skillDir, "actiondock.json")), true);
    assert.strictEqual(existsSync(join(exportRes.skillDir, "package.json")), true);
    assert.strictEqual(existsSync(join(exportRes.skillDir, "actions", "greet.ts")), true);
    assert.strictEqual(existsSync(join(exportRes.skillDir, "playbooks", "greet-user.md")), true);

    const skillMd = readFileSync(join(exportRes.skillDir, "SKILL.md"), "utf-8");
    assert.strictEqual(skillMd.startsWith("---\nname:"), true);
    assert.ok((skillMd).includes("description:"));
    assert.ok((skillMd).includes("# Sample Tools"));
    assert.ok((skillMd).includes("ad link"));
    assert.ok((skillMd).includes("test.sample-tools/sample.greet"));
    assert.ok((skillMd).includes("Playbook SOPs"));
    assert.ok((skillMd).includes("故障排查与环境安装指引"));
    // 主说明不展开完整安装教程：只保留按需参考链接
    assert.ok((skillMd).includes("references/actiondock-runtime.md"));
    assert.ok(!(skillMd).includes("npm install -g @actiondock/cli"));
    // 完整安装与自愈指引落在运行参考文件，且路径可读取
    const referenceMd = readFileSync(join(exportRes.skillDir, "references", "actiondock-runtime.md"), "utf-8");
    assert.ok((referenceMd).includes("npm install -g @actiondock/cli"));
    assert.ok((referenceMd).includes("npm install --omit=dev"));
    assert.ok((referenceMd).includes("ad doctor"));
    assert.ok((referenceMd).includes("ad link"));
  });

  it("exports Source Skill package including dependent lib files and non-action helpers", async () => {
    const fs = await import("node:fs");
    // 准备 lib 目录与源码辅助文件
    fs.mkdirSync(join(tempDir, "lib", "utils"), { recursive: true });
    fs.writeFileSync(
      join(tempDir, "lib", "utils", "formatter.ts"),
      'export function formatGreeting(name: string): string { return `Welcome, ${name}!`; }',
      "utf-8"
    );
    fs.writeFileSync(
      join(tempDir, "lib", "greet-client.ts"),
      'import { formatGreeting } from "./utils/formatter.js";\nexport function buildGreeting(name: string) { return formatGreeting(name); }',
      "utf-8"
    );

    // 更新 actions/greet.ts 引入 lib/greet-client.js
    const greetActionCode = `
import { defineAction } from "@actiondock/sdk";
import { buildGreeting } from "../lib/greet-client.js";

export default defineAction({
  id: "sample.greet",
  description: "Greeting with lib helper",
  run: async (input: { name: string }) => ({ message: buildGreeting(input.name) }),
});
`;
    fs.writeFileSync(join(tempDir, "actions", "greet.ts"), greetActionCode, "utf-8");

    // 在 actiondock.json 中声明 files 包含 lib 目录
    const configPath = join(tempDir, "actiondock.json");
    const cfg = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    cfg.files = ["lib"];
    fs.writeFileSync(configPath, JSON.stringify(cfg, null, 2), "utf-8");

    const exportRes = await exportSkill({
      projectRoot: tempDir,
    });

    assert.strictEqual(exportRes.mode, "source");
    assert.strictEqual(existsSync(join(exportRes.skillDir, "lib", "greet-client.ts")), true);
    assert.strictEqual(existsSync(join(exportRes.skillDir, "lib", "utils", "formatter.ts")), true);

    // 验证导出的文件列表中包含 lib 文件
    assert.ok((exportRes.files).includes("lib/greet-client.ts"));
    assert.ok((exportRes.files).includes("lib/utils/formatter.ts"));
  });

  it("exports Node directory Skill package when mode is node", { timeout: 30000 }, async () => {
    const exportRes = await exportSkill({
      projectRoot: tempDir,
      mode: "node",
    });

    assert.strictEqual(exportRes.mode, "node");
    assert.strictEqual(existsSync(exportRes.skillDir), true);
    assert.strictEqual(existsSync(join(exportRes.skillDir, "SKILL.md")), true);
    assert.strictEqual(existsSync(join(exportRes.skillDir, "entry.mjs")), true);
    assert.strictEqual(existsSync(join(exportRes.skillDir, "playbooks", "greet-user.md")), true);

    const skillMd = readFileSync(join(exportRes.skillDir, "SKILL.md"), "utf-8");
    assert.ok((skillMd).includes("node ./entry.mjs"));
    assert.ok((skillMd).includes("sample.greet"));

    // Execute exported entrypoint directly
    const exportedEntry = join(exportRes.skillDir, "entry.mjs");
    const binProc = runBin(
      [exportedEntry, "run", "sample.greet", "--input", '{"name": "Agent"}', "--json"]
    );
    assert.strictEqual(binProc.exitCode, 0);
    const res = JSON.parse(binProc.stdout.toString());
    assert.strictEqual(res.ok, true);
    assert.strictEqual(res.data.message, "Hello, Agent!");
  });

  it("supports Playbook-driven selective export (only packages specified playbook and its dependent actions)", { timeout: 30000 }, async () => {
    const fs = await import("node:fs");
    // Add a second action
    const action2Code = `
import { defineAction } from "@actiondock/sdk";
export default defineAction({
  id: "sample.farewell",
  description: "Say farewell to user",
  run: async (ctx) => ("Goodbye"),
});
`;
    fs.writeFileSync(join(tempDir, "actions", "farewell.ts"), action2Code, "utf-8");

    // Add a second action and playbook in actiondock.json
    const manifestPath = join(tempDir, "actiondock.json");
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
    manifest.actions["sample.farewell"] = {
      entry: "actions/farewell.ts",
      description: "Say farewell to user",
    };
    manifest.playbooks["farewell-sop"] = {
      entry: "playbooks/farewell-sop.md",
      description: "SOP for saying farewell",
      actions: ["sample.farewell"],
    };
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

    const pb2Content = `# Farewell SOP\n`;
    fs.writeFileSync(join(tempDir, "playbooks", "farewell-sop.md"), pb2Content, "utf-8");

    // 1. Export source skill for greet-user playbook only
    const exportRes = await exportSkill({
      projectRoot: tempDir,
      playbooks: ["greet-user"],
      outDir: join(tempDir, "dist", "selective-source-skill"),
    });

    assert.strictEqual(exportRes.actionsCount, 1);
    assert.strictEqual(exportRes.playbooksCount, 1);

    // Only greet-user.md should be in playbooks dir, farewell-sop.md must NOT exist
    assert.strictEqual(existsSync(join(exportRes.skillDir, "playbooks", "greet-user.md")), true);
    assert.strictEqual(existsSync(join(exportRes.skillDir, "playbooks", "farewell-sop.md")), false);

    // actiondock.json should contain greet-user playbook and exclude farewell-sop
    const exportedManifest = JSON.parse(fs.readFileSync(join(exportRes.skillDir, "actiondock.json"), "utf-8"));
    assert.notStrictEqual(exportedManifest.playbooks?.["greet-user"], undefined);
    assert.strictEqual(exportedManifest.playbooks?.["farewell-sop"], undefined);

    // Only greet.ts should be in actions dir, farewell.ts must NOT exist
    assert.strictEqual(existsSync(join(exportRes.skillDir, "actions", "greet.ts")), true);
    assert.strictEqual(existsSync(join(exportRes.skillDir, "actions", "farewell.ts")), false);

    // SKILL.md should only mention sample.greet and greet-user
    const skillMd = fs.readFileSync(join(exportRes.skillDir, "SKILL.md"), "utf-8");
    assert.ok((skillMd).includes("sample.greet"));
    assert.ok(!(skillMd).includes("sample.farewell"));
    assert.ok((skillMd).includes("greet-user"));
    assert.ok(!(skillMd).includes("farewell-sop"));

    // 2. Export node directory skill for greet-user playbook only
    const exportNodeRes = await exportSkill({
      projectRoot: tempDir,
      mode: "node",
      playbooks: ["greet-user"],
      outDir: join(tempDir, "dist", "selective-node-skill"),
    });

    const selectiveEntry = join(exportNodeRes.skillDir, "entry.mjs");
    const listProc = runBin([selectiveEntry, "list", "--json"]);
    assert.strictEqual(listProc.exitCode, 0);
    const listData = JSON.parse(listProc.stdout.toString());
    assert.strictEqual(listData.items.length, 1);
    assert.strictEqual(listData.items[0].id, "sample.greet");
  });

  it("builds project with precomputed plan directly via buildProjectWithPlan", async () => {
    const plan = SelectionPlanner.plan({
      projectRoot: tempDir,
    });

    const outDir = join(tempDir, "dist", "direct-plan-build");
    const result = await buildProjectWithPlan(plan, {
      projectRoot: tempDir,
      outDir,
    });

    assert.strictEqual(result.outputDir, resolve(outDir));
    assert.strictEqual(existsSync(result.entrypointPath), true);
    assert.strictEqual(existsSync(result.metadataPath), true);

    const metadata = JSON.parse(readFileSync(result.metadataPath, "utf-8"));
    assert.strictEqual(metadata.packageId, "test.sample-tools");

    // 验证未显式提供 options.projectRoot 时回退采用 plan.projectRoot
    const fallbackResult = await buildProjectWithPlan(plan, {
      outDir: join(tempDir, "dist", "fallback-plan-build"),
    });
    assert.strictEqual(fallbackResult.outputDir, resolve(tempDir, "dist", "fallback-plan-build"));
    assert.strictEqual(existsSync(fallbackResult.entrypointPath), true);
  });
});

