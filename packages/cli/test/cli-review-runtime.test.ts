import { afterAll, beforeAll, describe, expect, it, setDefaultTimeout } from "bun:test";
setDefaultTimeout(120000);
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { initProject } from "@actiondock/core";

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

describe("CLI Review - Runtime & Project Regression", () => {
  let tempDir: string;
  let customDataDir: string;
  let env: Record<string, string>;

  beforeAll(() => {
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

  afterAll(async () => {
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
    expect(schemaProc.exitCode).toBe(1);
    const schemaData = JSON.parse(schemaProc.stdout.toString());
    expect(schemaData.ok).toBe(false);
    expect(schemaData.missingCount).toBe(1);
  });

  it("scaffolds new actions and playbooks via action create and playbook create and updates actiondock.json", () => {
    initProject(tempDir, { id: "test.scaffold" });

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
    initProject(tempDir, { id: "test.build-modes" });

    const packDryProc = runCli(["pack", "--dry-run", "--json"], tempDir);
    expect(packDryProc.exitCode).toBe(0);
    const packDryRes = JSON.parse(packDryProc.stdout.toString());
    expect(packDryRes.packageId).toBe("test.build-modes");
    expect(packDryRes.tarballPath).toBeUndefined();
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
      expect(infoProc.exitCode).toBe(0);
      const info = JSON.parse(infoProc.stdout.toString());
      expect(info.id).toBe("team.no-manifest");
      expect(info.actionsCount).toBe(0);
      expect(info.actions.length).toBe(0);
      expect(existsSync(join(noManifestDir, "node_modules"))).toBe(false);

      const actionListProc = runCli(["list", "--json"], noManifestDir);
      expect(actionListProc.exitCode).toBe(0);
      const actionList = JSON.parse(actionListProc.stdout.toString());
      expect(actionList.length).toBe(0);
      expect(existsSync(join(noManifestDir, "node_modules"))).toBe(false);

      const doctorProc = runCli(["doctor", "--json"], noManifestDir);
      expect(doctorProc.exitCode).toBe(0);
      expect(existsSync(join(noManifestDir, "node_modules"))).toBe(false);

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
      expect(infoWithManifestProc.exitCode).toBe(0);
      const infoWithManifest = JSON.parse(infoWithManifestProc.stdout.toString());
      expect(infoWithManifest.actionsCount).toBe(1);
      expect(infoWithManifest.actions).toEqual(["team.foo"]);
      expect(existsSync(join(noManifestDir, "node_modules"))).toBe(false);

      const actionListWithManifestProc = runCli(["list", "--json"], noManifestDir);
      expect(actionListWithManifestProc.exitCode).toBe(0);
      const actionListWithManifest = JSON.parse(actionListWithManifestProc.stdout.toString());
      expect(actionListWithManifest.length).toBe(1);
      expect(actionListWithManifest[0].id).toBe("team.foo");
      expect(existsSync(join(noManifestDir, "node_modules"))).toBe(false);

      const actionShowProc = runCli(["describe", "team.foo", "--json"], noManifestDir);
      expect(actionShowProc.exitCode).toBe(0);
      const actionShow = JSON.parse(actionShowProc.stdout.toString());
      expect(actionShow.id).toBe("team.foo");
      expect(actionShow.description).toBe("Test action foo");
      expect(existsSync(join(noManifestDir, "node_modules"))).toBe(false);

      const doctorWithManifestProc = runCli(["doctor", "--json"], noManifestDir);
      expect(doctorWithManifestProc.exitCode).toBe(0);
      expect(existsSync(join(noManifestDir, "node_modules"))).toBe(false);
    } finally {
      if (existsSync(noManifestDir)) {
        try {
          rmSync(noManifestDir, { recursive: true, force: true });
        } catch {}
      }
    }
  });
});
