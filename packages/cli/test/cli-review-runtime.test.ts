import { runCommandSync, whichExecutable } from "../../../scripts/lib/spawn-helper.mjs";
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { initProject } from "@actiondock/core";

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

describe("CLI Review - Runtime & Project Regression", () => {
  let tempDir: string;
  let customDataDir: string;
  let env: Record<string, string>;

  before(() => {
    tempDir = mkdtempSync(join(tmpdir(), "actiondock-reg-rt-project-"));
    customHome = mkdtempSync(join(tmpdir(), "actiondock-reg-rt-home-"));
    customDataDir = mkdtempSync(join(tmpdir(), "actiondock-reg-rt-data-"));
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

  after(async () => {
    for (const dir of [tempDir, customHome, customDataDir]) {
      if (dir && existsSync(dir)) {
        try {
          rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
        } catch {
          await new Promise((r) => setTimeout(r, 200));
          try {
            rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
          } catch {
            // ignore
          }
        }
      }
    }
    customHome = undefined;
  });

  it("respects custom --data-dir isolation for state and config", () => {
    const otherDataDir = mkdtempSync(join(tmpdir(), "actiondock-reg-other-data-"));
    try {
      // Set state in customDataDir
      const setProc = runCli(
        ["state", "set", "custom_key", "custom_val", "--data-dir", customDataDir],
        tempDir,
        env
      );
      assert.strictEqual(setProc.exitCode, 0);

      // Get from customDataDir -> exists
      const getCustomProc = runCli(
        ["state", "get", "custom_key", "--json", "--data-dir", customDataDir],
        tempDir,
        env
      );
      assert.strictEqual(getCustomProc.exitCode, 0);
      const getCustomData = JSON.parse(getCustomProc.stdout.toString());
      assert.strictEqual(getCustomData.value, "custom_val");

      // Get from otherDataDir -> not found (exit code 1)
      const getOtherProc = runCli(
        ["state", "get", "custom_key", "--json", "--data-dir", otherDataDir],
        tempDir,
        env
      );
      assert.strictEqual(getOtherProc.exitCode, 1);
    } finally {
      if (existsSync(otherDataDir)) {
        try {
          rmSync(otherDataDir, { recursive: true, force: true });
        } catch {}
      }
    }
  });

  it("resolves global configuration in ad run via ctx.config.get fallback", () => {
    // 1. 设置全局配置: ad config set SAMPLE_GREETING Nihao --global
    const setGlobalProc = runCli(
      ["config", "set", "SAMPLE_GREETING", "Nihao", "--global"],
      tempDir,
      env
    );
    assert.strictEqual(setGlobalProc.exitCode, 0);

    // 2. 验证全局配置存在: ad config get SAMPLE_GREETING --global --json
    const getGlobalProc = runCli(
      ["config", "get", "SAMPLE_GREETING", "--global", "--json"],
      tempDir,
      env
    );
    assert.strictEqual(getGlobalProc.exitCode, 0);
    const getGlobalData = JSON.parse(getGlobalProc.stdout.toString());
    assert.strictEqual(getGlobalData.value, "Nihao");

    // 3. 执行 ad run，验证 ctx.config.get 回退到全局配置
    const runProc = runCli(
      ["run", "sample.greet", "--input", '{"name": "Beijing"}', "--json"],
      tempDir,
      env
    );
    assert.strictEqual(runProc.exitCode, 0);
    const runRes = JSON.parse(runProc.stdout.toString());
    assert.strictEqual(runRes.ok, true);
    assert.strictEqual(runRes.data.message, "Nihao, Beijing!");
  });

  it("sets exit code 1 on ad config schema when required config is missing", () => {
    initProject(tempDir, { id: "test.cfg-schema" });

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
    assert.strictEqual(schemaProc.exitCode, 1);
    const schemaData = JSON.parse(schemaProc.stdout.toString());
    assert.strictEqual(schemaData.ok, false);
    assert.strictEqual(schemaData.missingCount, 1);
  });

  it("scaffolds new actions and playbooks via action create and playbook create and updates actiondock.json", () => {
    initProject(tempDir, { id: "test.scaffold" });

    const newActionProc = runCli(
      ["action", "create", "calculator", "--desc", "Perform calculations", "--file", "calc.ts"],
      tempDir
    );
    assert.strictEqual(newActionProc.exitCode, 0);
    assert.strictEqual(existsSync(join(tempDir, "actions", "calc.ts")), true);
    const actionContent = readFileSync(join(tempDir, "actions", "calc.ts"), "utf-8");
    assert.ok((actionContent).includes('import type { ActionInput, ActionOutput } from "../.actiondock/generated/actions";'));
    assert.ok((actionContent).includes('export type Input = ActionInput<"calculator">;'));
    assert.ok((actionContent).includes('export type Output = ActionOutput<"calculator">;'));
    assert.ok(!(actionContent).includes("export interface Input {"));
    assert.ok(!(actionContent).includes("export interface Output {"));

    // Verify .actiondock/generated/actions.d.ts is automatically generated
    const generatedTypesPath = join(tempDir, ".actiondock", "generated", "actions.d.ts");
    assert.strictEqual(existsSync(generatedTypesPath), true);
    const generatedTypes = readFileSync(generatedTypesPath, "utf-8");
    assert.ok((generatedTypes).includes("export namespace Actions"));
    assert.ok((generatedTypes).includes('"calculator": {'));

    // Test nested action relative path computation
    const nestedActionProc = runCli(
      ["action", "create", "nested-calc", "--file", "math/sub/calc.ts"],
      tempDir
    );
    assert.strictEqual(nestedActionProc.exitCode, 0);
    assert.strictEqual(existsSync(join(tempDir, "actions", "math", "sub", "calc.ts")), true);
    const nestedContent = readFileSync(join(tempDir, "actions", "math", "sub", "calc.ts"), "utf-8");
    assert.ok((nestedContent).includes('import type { ActionInput, ActionOutput } from "../../../.actiondock/generated/actions";'));
    assert.ok((nestedContent).includes('export type Input = ActionInput<"nested-calc">;'));
    assert.ok((nestedContent).includes('export type Output = ActionOutput<"nested-calc">;'));

    const manifestAfterAction = JSON.parse(readFileSync(join(tempDir, "actiondock.json"), "utf-8"));
    assert.notStrictEqual(manifestAfterAction.actions.calculator, undefined);
    assert.strictEqual(manifestAfterAction.actions.calculator.description, "Perform calculations");
    assert.strictEqual(manifestAfterAction.actions.calculator.entry, "actions/calc.ts");
    assert.notStrictEqual(manifestAfterAction.actions["nested-calc"], undefined);
    assert.strictEqual(manifestAfterAction.actions["nested-calc"].entry, "actions/math/sub/calc.ts");

    const newPlaybookProc = runCli(
      ["playbook", "create", "deploy-flow", "--desc", "Deployment flow SOP", "--actions", "calculator"],
      tempDir
    );
    assert.strictEqual(newPlaybookProc.exitCode, 0);
    assert.strictEqual(existsSync(join(tempDir, "playbooks", "deploy-flow.md")), true);

    const manifestAfterPb = JSON.parse(readFileSync(join(tempDir, "actiondock.json"), "utf-8"));
    assert.notStrictEqual(manifestAfterPb.playbooks["deploy-flow"], undefined);
    assert.strictEqual(manifestAfterPb.playbooks["deploy-flow"].description, "Deployment flow SOP");
    assert.deepStrictEqual(manifestAfterPb.playbooks["deploy-flow"].actions, ["calculator"]);
  });

  it("validates ad pack --dry-run", () => {
    initProject(tempDir, { id: "test.build-modes" });

    const packDryProc = runCli(["pack", "--dry-run", "--json"], tempDir);
    assert.strictEqual(packDryProc.exitCode, 0);
    const packDryRes = JSON.parse(packDryProc.stdout.toString());
    assert.strictEqual(packDryRes.packageId, "test.build-modes");
    assert.strictEqual(packDryRes.tarballPath, undefined);
  });

  it("info does not auto install dependencies and does not import actions when manifest is absent", () => {
    const noManifestDir = mkdtempSync(join(tmpdir(), "actiondock-reg-no-manifest-"));
    mkdirSync(join(noManifestDir, "actions"), { recursive: true });

    try {
      writeFileSync(
        join(noManifestDir, "actiondock.json"),
        JSON.stringify({
          id: "team.no-manifest",
          name: "No Manifest",
          version: "1.0.0",
          actionsDir: "actions",
        }),
        "utf-8"
      );

      writeFileSync(
        join(noManifestDir, "package.json"),
        JSON.stringify({
          name: "team.no-manifest",
          version: "1.0.0",
          dependencies: {
            "non-existent-pkg-xyz": "^1.0.0",
          },
        }),
        "utf-8"
      );

      writeFileSync(
        join(noManifestDir, "actions", "foo.ts"),
        `import { defineAction } from "@actiondock/sdk";\nexport default defineAction({ id: "team.foo", run: async () => ({}) });\n`,
        "utf-8"
      );

      const infoProc = runCli(["info", "--json"], noManifestDir);
      assert.strictEqual(infoProc.exitCode, 0);
      const info = JSON.parse(infoProc.stdout.toString());
      assert.strictEqual(info.id, "team.no-manifest");
      assert.strictEqual(info.actions.length, 0);
      assert.strictEqual(existsSync(join(noManifestDir, "node_modules")), false);

      const actionListProc = runCli(["list", "--json"], noManifestDir);
      assert.strictEqual(actionListProc.exitCode, 0);
      const actionList = JSON.parse(actionListProc.stdout.toString());
      assert.strictEqual(actionList.items.length, 0);
      assert.strictEqual(existsSync(join(noManifestDir, "node_modules")), false);

      const doctorProc = runCli(["doctor", "--json"], noManifestDir);
      assert.strictEqual(doctorProc.exitCode, 0);
      assert.strictEqual(existsSync(join(noManifestDir, "node_modules")), false);

      writeFileSync(
        join(noManifestDir, "actiondock.json"),
        JSON.stringify({
          $schema: "https://actiondock.dev/schema/v2/actiondock.json",
          id: "team.no-manifest",
          name: "No Manifest",
          version: "1.0.0",
          actionsDir: "actions",
          actions: {
            "team.foo": {
              entry: "actions/foo.ts",
              description: "Test action foo",
              inputSchema: { type: "object" },
              outputSchema: { type: "object" },
            },
          },
        }),
        "utf-8"
      );

      const infoWithManifestProc = runCli(["info", "--json"], noManifestDir);
      assert.strictEqual(infoWithManifestProc.exitCode, 0);
      const infoWithManifest = JSON.parse(infoWithManifestProc.stdout.toString());
      assert.strictEqual(infoWithManifest.actions.length, 1);
      assert.strictEqual(infoWithManifest.actions[0].id, "team.foo");
      assert.strictEqual(existsSync(join(noManifestDir, "node_modules")), false);

      const actionListWithManifestProc = runCli(["list", "--json"], noManifestDir);
      assert.strictEqual(actionListWithManifestProc.exitCode, 0);
      const actionListWithManifest = JSON.parse(actionListWithManifestProc.stdout.toString());
      assert.strictEqual(actionListWithManifest.items.length, 1);
      assert.strictEqual(actionListWithManifest.items[0].id, "team.foo");
      assert.strictEqual(existsSync(join(noManifestDir, "node_modules")), false);

      const actionShowProc = runCli(["describe", "team.foo", "--json"], noManifestDir);
      assert.strictEqual(actionShowProc.exitCode, 0);
      const actionShow = JSON.parse(actionShowProc.stdout.toString());
      assert.strictEqual(actionShow.id, "team.foo");
      assert.strictEqual(actionShow.description, "Test action foo");
      assert.strictEqual(existsSync(join(noManifestDir, "node_modules")), false);

      const doctorWithManifestProc = runCli(["doctor", "--json"], noManifestDir);
      assert.strictEqual(doctorWithManifestProc.exitCode, 0);
      assert.strictEqual(existsSync(join(noManifestDir, "node_modules")), false);
    } finally {
      if (existsSync(noManifestDir)) {
        try {
          rmSync(noManifestDir, { recursive: true, force: true });
        } catch {}
      }
    }
  });
});
