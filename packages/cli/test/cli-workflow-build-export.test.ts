import { afterEach, beforeEach, describe, expect, it, setDefaultTimeout } from "bun:test";
setDefaultTimeout(120000);
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { initProject } from "@actiondock/core";
import {
  ACTION_ID_REGEX,
  loadActions,
} from "@actiondock/core/project";

const cliPath = resolve(import.meta.dirname, "../bin/ad.js");

let tempHome: string | undefined;

function runCli(args: string[], cwd?: string, env?: Record<string, string>) {
  return Bun.spawnSync(["bun", cliPath, ...args], {
    cwd,
    env: {
      ...process.env,
      ...(tempHome ? { ACTIONDOCK_HOME: tempHome } : {}),
      ...env,
    },
    stdout: "pipe",
    stderr: "pipe",
  });
}

describe("CLI Workflow - Build, Export & Distribution", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "actiondock-cli-build-"));
    tempHome = mkdtempSync(join(tmpdir(), "actiondock-cli-build-home-"));
    const rootNodeModules = resolve(import.meta.dirname, "../../../node_modules");
    if (existsSync(rootNodeModules)) {
      symlinkSync(rootNodeModules, join(tempDir, "node_modules"), "junction");
    }
    initProject(tempDir, { id: "team.github-ops", name: "GitHub Ops" });
  });

  afterEach(async () => {
    if (tempHome && existsSync(tempHome)) {
      try {
        rmSync(tempHome, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
      } catch {}
      tempHome = undefined;
    }
    if (existsSync(tempDir)) {
      try {
        rmSync(tempDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
      } catch {
        await new Promise((r) => setTimeout(r, 200));
        try {
          rmSync(tempDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
        } catch {}
      }
    }
  });

  it("scaffolds new actions and playbooks via action create and playbook create", () => {
    const createAct = runCli(
      ["action", "create", "calc", "--desc", "Calculator action", "--file", "calc.ts"],
      tempDir
    );
    expect(createAct.exitCode).toBe(0);
    expect(existsSync(join(tempDir, "actions", "calc.ts"))).toBe(true);

    const manifestAfterAct = JSON.parse(readFileSync(join(tempDir, "actiondock.json"), "utf-8"));
    expect(manifestAfterAct.actions.calc).toBeDefined();
    expect(manifestAfterAct.actions.calc.entry).toBe("actions/calc.ts");

    const createPb = runCli(
      ["playbook", "create", "calc-flow", "--desc", "Calculation SOP", "--actions", "calc"],
      tempDir
    );
    expect(createPb.exitCode).toBe(0);
    expect(existsSync(join(tempDir, "playbooks", "calc-flow.md"))).toBe(true);

    const manifestAfterPb = JSON.parse(readFileSync(join(tempDir, "actiondock.json"), "utf-8"));
    expect(manifestAfterPb.playbooks["calc-flow"]).toBeDefined();
    expect(manifestAfterPb.playbooks["calc-flow"].actions).toEqual(["calc"]);

    const valPb = runCli(["playbook", "validate", "calc-flow", "--json"], tempDir);
    expect(valPb.exitCode).toBe(0);
  });

  it("builds delivery bundle and packages distribution tarball", () => {
    // 9. build
    const buildProc = runCli(["build"], tempDir);
    expect(buildProc.exitCode).toBe(0);
    expect(existsSync(join(tempDir, "dist", "github-ops-build", "entry.mjs"))).toBe(true);
    expect(existsSync(join(tempDir, "dist", "github-ops-build", "package.json"))).toBe(true);
    expect(existsSync(join(tempDir, "dist", "github-ops-build", "artifact.json"))).toBe(true);

    // 9b. pack: tarball aligns with package ID team.github-ops
    const packProc = runCli(["pack"], tempDir);
    expect(packProc.exitCode).toBe(0);
    expect(existsSync(join(tempDir, "dist", "team.github-ops-0.1.0.tgz"))).toBe(true);
  });

  it("exports skills in source and node modes, composite bundles, and validates constraints", async () => {
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

    // 10b. export skill --mode node
    const exportNodeProc = runCli(["export", "skill", "--mode", "node"], tempDir);
    expect(exportNodeProc.exitCode).toBe(0);
    expect(
      existsSync(join(tempDir, "dist", "github-ops-skill", "entry.mjs"))
    ).toBe(true);

    // 10c. export skill rejects --standalone
    const exportStandaloneProc = runCli(["export", "skill", "--standalone"], tempDir);
    expect(exportStandaloneProc.exitCode).not.toBe(0);

    // 10d. export skill with --playbook selective flag
    const selectiveOut = join(tempDir, "dist", "custom-skill");
    const exportSelectiveProc = runCli(
      ["export", "skill", "--playbook", "greet-user", "-o", selectiveOut],
      tempDir
    );
    expect(exportSelectiveProc.exitCode).toBe(0);
    expect(existsSync(join(selectiveOut, "SKILL.md"))).toBe(true);
    expect(existsSync(join(selectiveOut, "playbooks", "greet-user.md"))).toBe(true);
    expect(existsSync(join(selectiveOut, "actions", "greet.ts"))).toBe(true);

    // 10d. export skill --bundle composite mode
    const bundleOut = join(tempDir, "dist", "my-composite-suite");
    const exportBundleProc = runCli(
      ["export", "skill", "--bundle", "my-composite-suite", "-o", bundleOut],
      tempDir
    );
    expect(exportBundleProc.exitCode).toBe(0);
    expect(existsSync(join(bundleOut, "SKILL.md"))).toBe(true);
    expect(existsSync(join(bundleOut, "actiondock.skill.json"))).toBe(false);
    expect(existsSync(join(bundleOut, "packages", "github-ops"))).toBe(true);
    expect(existsSync(join(bundleOut, "packages", "github-ops", "SKILL.md"))).toBe(false);

    // Roundtrip verification: loadActions on each exported package must have zero errors
    const exportedPackagesDir = join(bundleOut, "packages");
    const subpkgs = readdirSync(exportedPackagesDir);
    expect(subpkgs.length).toBeGreaterThan(0);
    for (const subpkg of subpkgs) {
      const subpkgDir = join(exportedPackagesDir, subpkg);
      if (statSync(subpkgDir).isDirectory()) {
        const loaded = await loadActions(subpkgDir);
        expect(loaded.size).toBeGreaterThan(0);
        for (const [id] of loaded) {
          expect(ACTION_ID_REGEX.test(id)).toBe(true);
        }
      }
    }

    // 10e. export skill validation tests: conflict rejection
    const conflictProc = runCli(["export", "skill", "--bundle", "suite", "--mode", "node"], tempDir);
    expect(conflictProc.exitCode).not.toBe(0);
    expect(conflictProc.stderr.toString()).toContain("Composite Skill export (--bundle) currently only supports source mode");

    const conflictSourceProc = runCli(["export", "skill", "--all", "--workspace"], tempDir);
    expect(conflictSourceProc.exitCode).not.toBe(0);
    expect(conflictSourceProc.stderr.toString()).toContain("mutually exclusive");

    // 10f. export skill with pre-existing SKILL.md reuse
    const preExistingSkillPath = join(tempDir, "SKILL.md");
    writeFileSync(preExistingSkillPath, "# Custom Pre-existing CLI Skill\n", "utf-8");
    try {
      const reuseOut = join(tempDir, "dist", "reuse-skill");
      const reuseProc = runCli(["export", "skill", "-o", reuseOut], tempDir);
      expect(reuseProc.exitCode).toBe(0);
      expect(reuseProc.stdout.toString()).toContain("Reused existing file from");
      const content = readFileSync(join(reuseOut, "SKILL.md"), "utf-8");
      expect(content).toContain("Custom Pre-existing CLI Skill");
    } finally {
      rmSync(preExistingSkillPath, { force: true });
    }
  });

});

