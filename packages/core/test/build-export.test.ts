import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { buildProject } from "../src/build/builder";
import { exportSkill } from "../src/export/skill";
import { initProject } from "../src/project/init";

describe("Build & Skill Export Contract", () => {
  let tempDir: string;
  let customDataDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "actiondock-build-test-"));
    customDataDir = join(tempDir, ".custom-data");

    // Clean up any existing global test package data
    const globalDataDir = join(homedir(), ".actiondock", "data", "test.sample-tools");
    if (existsSync(globalDataDir)) {
      rmSync(globalDataDir, { recursive: true, force: true });
    }

    // Link root node_modules so @actiondock/sdk is resolvable during build
    const rootNodeModules = resolve(__dirname, "../../../node_modules");
    if (existsSync(rootNodeModules)) {
      symlinkSync(rootNodeModules, join(tempDir, "node_modules"), "dir");
    }
    initProject(tempDir, {
      id: "test.sample-tools",
      name: "Sample Tools",
      description: "Sample tool package for automated contract test",
    });
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
    const globalDataDir = join(homedir(), ".actiondock", "data", "test.sample-tools");
    if (existsSync(globalDataDir)) {
      try {
        rmSync(globalDataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
      } catch {
        // Ignore
      }
    }
  });

  it("builds a standalone executable and verifies CLI commands work in compiled binary", async () => {
    const buildRes = await buildProject({
      projectRoot: tempDir,
    });

    expect(existsSync(buildRes.executablePath)).toBe(true);
    expect(existsSync(buildRes.metadataPath)).toBe(true);

    const metadata = JSON.parse(readFileSync(buildRes.metadataPath, "utf-8"));
    expect(metadata.packageId).toBe("test.sample-tools");
    expect(metadata.actions).toEqual(["sample.greet"]);

    // 1. Test binary `list --json`
    const listProc = Bun.spawnSync([buildRes.executablePath, "list", "--json"], {
      cwd: tempDir,
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(listProc.exitCode).toBe(0);
    const listJson = JSON.parse(listProc.stdout.toString());
    expect(listJson).toEqual([
      { id: "sample.greet", description: "Greeting action demonstrating basic input, config, and state usage" },
    ]);

    // 1b. Test binary `list --intent greet --json` and `list nonexist --no-fallback --json`
    const listIntentProc = Bun.spawnSync(
      [buildRes.executablePath, "list", "--intent", "greet|other", "--json"],
      { cwd: tempDir, stdout: "pipe", stderr: "pipe" }
    );
    expect(listIntentProc.exitCode).toBe(0);
    expect(JSON.parse(listIntentProc.stdout.toString()).length).toBe(1);

    const listStrictProc = Bun.spawnSync(
      [buildRes.executablePath, "list", "nomatch", "--no-fallback", "--json"],
      { cwd: tempDir, stdout: "pipe", stderr: "pipe" }
    );
    expect(listStrictProc.exitCode).toBe(0);
    expect(JSON.parse(listStrictProc.stdout.toString())).toEqual([]);


    // 2. Test binary `describe <id> --json`
    const descProc = Bun.spawnSync(
      [buildRes.executablePath, "describe", "sample.greet", "--json"],
      {
        cwd: tempDir,
        stdout: "pipe",
        stderr: "pipe",
      }
    );
    expect(descProc.exitCode).toBe(0);
    const descJson = JSON.parse(descProc.stdout.toString());
    expect(descJson.id).toBe("sample.greet");
    expect(descJson.inputSchema).toBeDefined();

    // 3. Test binary `run <id> --input '...'` with default greeting
    const runProc = Bun.spawnSync(
      [
        buildRes.executablePath,
        "run",
        "sample.greet",
        "--input",
        '{"name": "Antigravity"}',
        "--timeout",
        "5s",
      ],
      {
        cwd: tempDir,
        stdout: "pipe",
        stderr: "pipe",
      }
    );
    expect(runProc.exitCode).toBe(0);
    const runJson = JSON.parse(runProc.stdout.toString());
    expect(runJson.ok).toBe(true);
    expect(runJson.data.message).toBe("Hello, Antigravity!");
    expect(runJson.runId).toBeDefined();

    // 3b. Test binary rejects --async
    const asyncProc = Bun.spawnSync(
      [
        buildRes.executablePath,
        "run",
        "sample.greet",
        "--input",
        '{"name": "Antigravity"}',
        "--async",
      ],
      {
        cwd: tempDir,
        stdout: "pipe",
        stderr: "pipe",
      }
    );
    expect(asyncProc.exitCode).toBe(1);
    expect(asyncProc.stderr.toString()).toContain(
      "Async execution is not supported in standalone single-execution binaries"
    );


    // 4. Test binary `config set` and verify persistence in subsequent run
    const confSet = Bun.spawnSync(
      [buildRes.executablePath, "config", "set", "SAMPLE_GREETING", "Welcome"],
      {
        cwd: tempDir,
        stdout: "pipe",
        stderr: "pipe",
      }
    );
    expect(confSet.exitCode).toBe(0);

    const confRun = Bun.spawnSync(
      [
        buildRes.executablePath,
        "run",
        "sample.greet",
        "--input",
        '{"name": "Antigravity"}',
      ],
      {
        cwd: tempDir,
        stdout: "pipe",
        stderr: "pipe",
      }
    );
    expect(confRun.exitCode).toBe(0);
    const confRunJson = JSON.parse(confRun.stdout.toString());
    expect(confRunJson.data.message).toBe("Welcome, Antigravity!");

    // 5. Test binary with custom --data-dir isolation
    const isolatedRun = Bun.spawnSync(
      [
        buildRes.executablePath,
        "--data-dir",
        customDataDir,
        "run",
        "sample.greet",
        "--input",
        '{"name": "Isolated"}',
      ],
      {
        cwd: tempDir,
        stdout: "pipe",
        stderr: "pipe",
      }
    );
    expect(isolatedRun.exitCode).toBe(0);
    const isoJson = JSON.parse(isolatedRun.stdout.toString());
    // In new isolated data-dir, it uses default greeting ("Hello")
    expect(isoJson.data.message).toBe("Hello, Isolated!");
  }, 30000);

  it("exports Source Skill package by default with SKILL.md, actiondock.json, actions, and playbooks", async () => {
    const exportRes = await exportSkill({
      projectRoot: tempDir,
    });

    expect(exportRes.mode).toBe("source");
    expect(existsSync(exportRes.skillDir)).toBe(true);
    expect(existsSync(join(exportRes.skillDir, "SKILL.md"))).toBe(true);
    expect(existsSync(join(exportRes.skillDir, "actiondock.json"))).toBe(true);
    expect(existsSync(join(exportRes.skillDir, "package.json"))).toBe(true);
    expect(existsSync(join(exportRes.skillDir, "actions", "greet.ts"))).toBe(true);
    expect(existsSync(join(exportRes.skillDir, "playbooks", "greet-user.md"))).toBe(true);

    const skillMd = readFileSync(join(exportRes.skillDir, "SKILL.md"), "utf-8");
    expect(skillMd.startsWith("---\nname:")).toBe(true);
    expect(skillMd).toContain("description:");
    expect(skillMd).toContain("# Sample Tools");
    expect(skillMd).toContain("ad link");
    expect(skillMd).toContain("test.sample-tools/sample.greet");
    expect(skillMd).toContain("Playbook SOPs");
    expect(skillMd).toContain("故障排查与环境安装指引");
    expect(skillMd).toContain("npm install -g @actiondock/cli");
    expect(skillMd).toContain("ad doctor");
  });

  it("exports standalone binary Skill package when standalone is true", async () => {
    const exportRes = await exportSkill({
      projectRoot: tempDir,
      standalone: true,
    });

    const expectedBinName = process.platform === "win32" ? "sample-tools.exe" : "sample-tools";
    expect(exportRes.mode).toBe("standalone");
    expect(existsSync(exportRes.skillDir)).toBe(true);
    expect(existsSync(join(exportRes.skillDir, "SKILL.md"))).toBe(true);
    expect(existsSync(join(exportRes.skillDir, "actiondock.skill.json"))).toBe(true);
    expect(existsSync(join(exportRes.skillDir, "bin", expectedBinName))).toBe(true);
    expect(existsSync(join(exportRes.skillDir, "playbooks", "greet-user.md"))).toBe(true);

    const skillMd = readFileSync(join(exportRes.skillDir, "SKILL.md"), "utf-8");
    expect(skillMd).toContain(`./bin/${expectedBinName}`);
    expect(skillMd).toContain("sample.greet");

    // Execute exported binary directly
    const exportedBin = join(exportRes.skillDir, "bin", expectedBinName);
    const binProc = Bun.spawnSync(
      [exportedBin, "run", "sample.greet", "--input", '{"name": "Agent"}'],
      {
        stdout: "pipe",
        stderr: "pipe",
      }
    );
    expect(binProc.exitCode).toBe(0);
    const res = JSON.parse(binProc.stdout.toString());
    expect(res.ok).toBe(true);
    expect(res.data.message).toBe("Hello, Agent!");
  }, 30000);

  it("supports Playbook-driven selective export (only packages specified playbook and its dependent actions)", async () => {
    const fs = await import("node:fs");
    // Add a second action
    const action2Code = `
import { defineAction } from "@actiondock/sdk";
export default defineAction({
  id: "sample.farewell",
  description: "Say farewell to user",
  run: async (ctx) => ({ message: "Goodbye" }),
});
`;
    fs.writeFileSync(join(tempDir, "actions", "farewell.ts"), action2Code, "utf-8");

    // Add a second playbook that only references sample.farewell
    const pb2Content = `---
id: farewell-sop
description: SOP for saying farewell
actions:
  - sample.farewell
---
# Farewell SOP
`;
    fs.writeFileSync(join(tempDir, "playbooks", "farewell-sop.md"), pb2Content, "utf-8");

    // 1. Export source skill for greet-user playbook only
    const exportRes = await exportSkill({
      projectRoot: tempDir,
      playbooks: ["greet-user"],
      outDir: join(tempDir, "dist", "selective-source-skill"),
    });

    expect(exportRes.actionsCount).toBe(1);
    expect(exportRes.playbooksCount).toBe(1);

    // Only greet-user.md should be in playbooks dir, farewell-sop.md must NOT exist
    expect(existsSync(join(exportRes.skillDir, "playbooks", "greet-user.md"))).toBe(true);
    expect(existsSync(join(exportRes.skillDir, "playbooks", "farewell-sop.md"))).toBe(false);

    // Only greet.ts should be in actions dir, farewell.ts must NOT exist
    expect(existsSync(join(exportRes.skillDir, "actions", "greet.ts"))).toBe(true);
    expect(existsSync(join(exportRes.skillDir, "actions", "farewell.ts"))).toBe(false);

    // SKILL.md should only mention sample.greet and greet-user
    const skillMd = fs.readFileSync(join(exportRes.skillDir, "SKILL.md"), "utf-8");
    expect(skillMd).toContain("sample.greet");
    expect(skillMd).not.toContain("sample.farewell");
    expect(skillMd).toContain("greet-user");
    expect(skillMd).not.toContain("farewell-sop");

    // 2. Export standalone binary skill for greet-user playbook only
    const exportStandaloneRes = await exportSkill({
      projectRoot: tempDir,
      standalone: true,
      playbooks: ["greet-user"],
      outDir: join(tempDir, "dist", "selective-standalone-skill"),
    });

    const expectedBinName = process.platform === "win32" ? "sample-tools.exe" : "sample-tools";
    const selectiveBin = join(exportStandaloneRes.skillDir, "bin", expectedBinName);
    const listProc = Bun.spawnSync([selectiveBin, "list", "--json"], {
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(listProc.exitCode).toBe(0);
    const listData = JSON.parse(listProc.stdout.toString());
    expect(listData.length).toBe(1);
    expect(listData[0].id).toBe("sample.greet");
  }, 30000);

  it("supports customizing --bytecode and --minify options when building", async () => {
    const unminifiedOut = join(tempDir, "dist", "unminified-bin");
    const buildRes = await buildProject({
      projectRoot: tempDir,
      outfile: unminifiedOut,
      bytecode: false,
      minify: false,
    });

    expect(existsSync(buildRes.executablePath)).toBe(true);

    const runProc = Bun.spawnSync(
      [buildRes.executablePath, "run", "sample.greet", "--input", '{"name": "NoMinify"}'],
      { cwd: tempDir, stdout: "pipe", stderr: "pipe" }
    );
    expect(runProc.exitCode).toBe(0);
    const res = JSON.parse(runProc.stdout.toString());
    expect(res.ok).toBe(true);
    expect(res.data.message).toBe("Hello, NoMinify!");
  }, 30000);
});

