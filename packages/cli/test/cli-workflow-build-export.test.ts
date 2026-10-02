import { runCommandSync, whichExecutable } from "../../../scripts/lib/spawn-helper.mjs";
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";

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
  return runCommandSync(["bun", cliPath, ...args], {
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
    assert.strictEqual(createAct.exitCode, 0);
    assert.strictEqual(existsSync(join(tempDir, "actions", "calc.ts")), true);

    const manifestAfterAct = JSON.parse(readFileSync(join(tempDir, "actiondock.json"), "utf-8"));
    assert.notStrictEqual(manifestAfterAct.actions.calc, undefined);
    assert.strictEqual(manifestAfterAct.actions.calc.entry, "actions/calc.ts");

    const createPb = runCli(
      ["playbook", "create", "calc-flow", "--desc", "Calculation SOP", "--actions", "calc"],
      tempDir
    );
    assert.strictEqual(createPb.exitCode, 0);
    assert.strictEqual(existsSync(join(tempDir, "playbooks", "calc-flow.md")), true);

    const manifestAfterPb = JSON.parse(readFileSync(join(tempDir, "actiondock.json"), "utf-8"));
    assert.notStrictEqual(manifestAfterPb.playbooks["calc-flow"], undefined);
    assert.deepStrictEqual(manifestAfterPb.playbooks["calc-flow"].actions, ["calc"]);

    const valPb = runCli(["playbook", "validate", "calc-flow", "--json"], tempDir);
    assert.strictEqual(valPb.exitCode, 0);
  });

  it("builds delivery bundle and packages distribution tarball", () => {
    // 9. build
    const buildProc = runCli(["build"], tempDir);
    assert.strictEqual(buildProc.exitCode, 0);
    assert.strictEqual(existsSync(join(tempDir, "dist", "github-ops-build", "entry.mjs")), true);
    assert.strictEqual(existsSync(join(tempDir, "dist", "github-ops-build", "package.json")), true);
    assert.strictEqual(existsSync(join(tempDir, "dist", "github-ops-build", "artifact.json")), true);

    // 9b. pack: tarball aligns with package ID team.github-ops
    const packProc = runCli(["pack"], tempDir);
    assert.strictEqual(packProc.exitCode, 0);
    assert.strictEqual(existsSync(join(tempDir, "dist", "team.github-ops-0.1.0.tgz")), true);
  });

  it("exports skills in source and node modes, composite bundles, and validates constraints", async () => {
    // 10. export skill (default: source skill)
    const exportProc = runCli(["export", "skill"], tempDir);
    assert.strictEqual(exportProc.exitCode, 0);
    assert.strictEqual(existsSync(join(tempDir, "dist", "github-ops-skill", "SKILL.md")), true);
    assert.strictEqual(existsSync(join(tempDir, "dist", "github-ops-skill", "actiondock.json")), true);
    assert.strictEqual(existsSync(join(tempDir, "dist", "github-ops-skill", "package.json")), true);
    assert.strictEqual(existsSync(join(tempDir, "dist", "github-ops-skill", "actions", "greet.ts")), true);

    // 10b. export skill --mode node
    const exportNodeProc = runCli(["export", "skill", "--mode", "node"], tempDir);
    assert.strictEqual(exportNodeProc.exitCode, 0);
    assert.strictEqual(existsSync(join(tempDir, "dist", "github-ops-skill", "entry.mjs")), true);

    // 10c. export skill rejects --standalone
    const exportStandaloneProc = runCli(["export", "skill", "--standalone"], tempDir);
    assert.notStrictEqual(exportStandaloneProc.exitCode, 0);

    // 10d. export skill with --playbook selective flag
    const selectiveOut = join(tempDir, "dist", "custom-skill");
    const exportSelectiveProc = runCli(
      ["export", "skill", "--playbook", "greet-user", "-o", selectiveOut],
      tempDir
    );
    assert.strictEqual(exportSelectiveProc.exitCode, 0);
    assert.strictEqual(existsSync(join(selectiveOut, "SKILL.md")), true);
    assert.strictEqual(existsSync(join(selectiveOut, "playbooks", "greet-user.md")), true);
    assert.strictEqual(existsSync(join(selectiveOut, "actions", "greet.ts")), true);

    // 10d. export skill --bundle composite mode
    const bundleOut = join(tempDir, "dist", "my-composite-suite");
    const exportBundleProc = runCli(
      ["export", "skill", "--bundle", "my-composite-suite", "-o", bundleOut],
      tempDir
    );
    assert.strictEqual(exportBundleProc.exitCode, 0);
    assert.strictEqual(existsSync(join(bundleOut, "SKILL.md")), true);
    assert.strictEqual(existsSync(join(bundleOut, "actiondock.skill.json")), false);
    assert.strictEqual(existsSync(join(bundleOut, "packages", "github-ops")), true);
    assert.strictEqual(existsSync(join(bundleOut, "packages", "github-ops", "SKILL.md")), false);

    // Roundtrip verification: loadActions on each exported package must have zero errors
    const exportedPackagesDir = join(bundleOut, "packages");
    const subpkgs = readdirSync(exportedPackagesDir);
    assert.ok((subpkgs.length) > 0);
    for (const subpkg of subpkgs) {
      const subpkgDir = join(exportedPackagesDir, subpkg);
      if (statSync(subpkgDir).isDirectory()) {
        const loaded = await loadActions(subpkgDir);
        assert.ok((loaded.size) > 0);
        for (const [id] of loaded) {
          assert.strictEqual(ACTION_ID_REGEX.test(id), true);
        }
      }
    }

    // 10e. export skill validation tests: conflict rejection
    const conflictProc = runCli(["export", "skill", "--bundle", "suite", "--mode", "node"], tempDir);
    assert.notStrictEqual(conflictProc.exitCode, 0);
    assert.ok((conflictProc.stderr.toString()).includes("Composite Skill export (--bundle) currently only supports source mode"));

    const conflictSourceProc = runCli(["export", "skill", "--all", "--workspace"], tempDir);
    assert.notStrictEqual(conflictSourceProc.exitCode, 0);
    assert.ok((conflictSourceProc.stderr.toString()).includes("mutually exclusive"));

    // 10f. export skill with pre-existing SKILL.md reuse
    const preExistingSkillPath = join(tempDir, "SKILL.md");
    writeFileSync(preExistingSkillPath, "# Custom Pre-existing CLI Skill\n", "utf-8");
    try {
      const reuseOut = join(tempDir, "dist", "reuse-skill");
      const reuseProc = runCli(["export", "skill", "-o", reuseOut], tempDir);
      assert.strictEqual(reuseProc.exitCode, 0);
      assert.ok((reuseProc.stdout.toString()).includes("Reused existing file from"));
      const content = readFileSync(join(reuseOut, "SKILL.md"), "utf-8");
      assert.ok((content).includes("Custom Pre-existing CLI Skill"));
    } finally {
      rmSync(preExistingSkillPath, { force: true });
    }
  });

});

