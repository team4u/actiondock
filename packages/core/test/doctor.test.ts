import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { runDoctorChecks } from "../src/doctor";
import { initProject } from "../src/project/init";
import { linkPackage } from "../src/registry";

describe("Doctor Diagnostics Module", () => {
  let fakeHome: string;
  let pkgDir: string;

  beforeEach(() => {
    fakeHome = mkdtempSync(join(tmpdir(), "doctor-home-"));
    pkgDir = mkdtempSync(join(tmpdir(), "doctor-pkg-"));

    const rootNodeModules = resolve(import.meta.dirname, "../../../node_modules");
    if (existsSync(rootNodeModules)) {
      symlinkSync(rootNodeModules, join(pkgDir, "node_modules"), "junction");
    }

    initProject(pkgDir, {
      id: "team.doctor-test",
      name: "Doctor Test Package",
    });

    const configPath = join(pkgDir, "actiondock.json");
    const raw = JSON.parse(readFileSync(configPath, "utf-8"));
    raw.config = {
      REQ_API_KEY: {
        type: "string",
        description: "Required API key",
        required: true,
      },
    };
    writeFileSync(configPath, JSON.stringify(raw, null, 2));

    const actionContent = `
import { defineAction } from "@actiondock/sdk";
export default defineAction({
  id: "sample.doctor-action",
  inputSchema: { type: "object" },
  async run() { return { ok: true }; }
});
`;
    writeFileSync(join(pkgDir, "actions", "doctor-act.ts"), actionContent);
  });

  afterEach(() => {
    rmSync(fakeHome, { recursive: true, force: true });
    rmSync(pkgDir, { recursive: true, force: true });
  });

  it("runs system-only diagnostics when outside of project", async () => {
    const emptyDir = fakeHome;
    const report = await runDoctorChecks({ cwd: emptyDir, customHome: fakeHome });

    assert.strictEqual(report.hasProject, false);
    assert.ok((report.checks.length) >= 4);

    const nodeCheck = report.checks.find((c) => c.id === "runtime.node");
    assert.notStrictEqual(nodeCheck, undefined);
    assert.strictEqual(nodeCheck?.status, "ok");
    assert.ok((nodeCheck?.message).includes(">= 24.12.0 supported"));

    const storageCheck = report.checks.find((c) => c.id === "storage.global");
    assert.notStrictEqual(storageCheck, undefined);
    assert.strictEqual(storageCheck?.status, "ok");
  });

  it("runs full project diagnostics inside ActionDock project", async () => {
    const report = await runDoctorChecks({ cwd: pkgDir, customHome: fakeHome });

    assert.strictEqual(report.hasProject, true);
    assert.strictEqual(report.packageId, "team.doctor-test");

    const sdkCheck = report.checks.find((c) => c.id === "project.sdk");
    assert.notStrictEqual(sdkCheck, undefined);
    assert.strictEqual(sdkCheck?.status, "ok");

    const actionCheck = report.checks.find((c) => c.id === "project.actions");
    assert.notStrictEqual(actionCheck, undefined);
    assert.strictEqual(actionCheck?.status, "ok");

    const manifestCheck = report.checks.find((c) => c.id === "project.manifest");
    assert.notStrictEqual(manifestCheck, undefined);
    assert.strictEqual(manifestCheck?.status, "warn");
    assert.ok((manifestCheck?.message).includes("doctor-act.ts"));
    assert.ok(manifestCheck!.fix!.includes("actiondock.json"));

    const storageProjectCheck = report.checks.find((c) => c.id === "project.storage");
    assert.notStrictEqual(storageProjectCheck, undefined);
    assert.strictEqual(storageProjectCheck?.status, "ok");
    assert.ok((storageProjectCheck?.message).includes(fakeHome));

    // Config readiness check should detect missing REQ_API_KEY as a warning
    const configCheck = report.checks.find((c) => c.id === "project.config_readiness");
    assert.notStrictEqual(configCheck, undefined);
    assert.strictEqual(configCheck?.status, "warn");
    assert.ok((configCheck?.message).includes("REQ_API_KEY"));
  });

  it("detects stale registry links in doctor checks", async () => {
    // Link a directory, then delete that directory
    const tempPkg = mkdtempSync(join(tmpdir(), "temp-pkg-"));
    initProject(tempPkg, { id: "team.temp-stale", name: "Temp Stale" });
    await linkPackage(tempPkg, fakeHome);

    // Delete directory to make link stale
    rmSync(tempPkg, { recursive: true, force: true });

    const report = await runDoctorChecks({ cwd: fakeHome, customHome: fakeHome });
    const regCheck = report.checks.find((c) => c.id === "registry.global");
    assert.notStrictEqual(regCheck, undefined);
    assert.strictEqual(regCheck?.status, "warn");
    assert.ok((regCheck?.message).includes("stale"));
  });

  it("detects linked packages declaring dependencies with missing node_modules", async () => {
    const depPkg = mkdtempSync(join(tmpdir(), "doctor-dep-pkg-"));
    initProject(depPkg, { id: "team.missing-deps", name: "Missing Deps" });
    writeFileSync(
      join(depPkg, "package.json"),
      JSON.stringify({
        name: "team.missing-deps",
        dependencies: { "some-lib": "^1.0.0" },
      })
    );
    await linkPackage(depPkg, fakeHome);

    const report = await runDoctorChecks({ cwd: fakeHome, customHome: fakeHome });
    const depCheck = report.checks.find((c) => c.id === "registry.dependencies");
    assert.notStrictEqual(depCheck, undefined);
    assert.strictEqual(depCheck?.status, "warn");
    assert.ok((depCheck?.message).includes("team.missing-deps"));
    assert.ok((depCheck?.message).includes("miss node_modules"));
    assert.ok(depCheck!.fix!.includes("npm install"));
    assert.ok(!depCheck!.fix!.includes("bun install"));

    rmSync(depPkg, { recursive: true, force: true });
  });

  it("detects unresolvable cross-package references in manifest uses", async () => {
    const usesPkg = mkdtempSync(join(tmpdir(), "doctor-uses-pkg-"));
    initProject(usesPkg, { id: "team.uses-pkg", name: "Uses Pkg" });
    const manifest = {
      id: "team.uses-pkg",
      schemaVersion: 2,
      actions: {
        "call-external": {
          entry: "actions/call.ts",
          uses: ["unresolved.remote/service"],
        },
      },
    };
    writeFileSync(join(usesPkg, "actiondock.json"), JSON.stringify(manifest, null, 2));
    await linkPackage(usesPkg, fakeHome);

    const report = await runDoctorChecks({ cwd: fakeHome, customHome: fakeHome });
    const usesCheck = report.checks.find((c) => c.id === "registry.uses_closure");
    assert.notStrictEqual(usesCheck, undefined);
    assert.strictEqual(usesCheck?.status, "warn");
    assert.ok((usesCheck?.message).includes("unresolved.remote/service"));

    rmSync(usesPkg, { recursive: true, force: true });
  });

  it("diagnoses undeclared src module references and missing declared files", async () => {
    const srcDir = join(pkgDir, "src");
    mkdirSync(srcDir, { recursive: true });
    writeFileSync(join(srcDir, "lib.ts"), "export const ok = 1;");

    // Action 引用了 src 但 actiondock.json 未配置 files
    writeFileSync(
      join(pkgDir, "actions", "doctor-act.ts"),
      `import { defineAction } from "@actiondock/sdk";
import { ok } from "../src/lib.js";
export default defineAction(async () => ({ ok }));`
    );

    const reportError = await runDoctorChecks({ cwd: pkgDir, customHome: fakeHome });
    const filesCheckError = reportError.checks.find((c) => c.id === "project.files");
    assert.notStrictEqual(filesCheckError, undefined);
    assert.strictEqual(filesCheckError?.status, "error");
    assert.ok((filesCheckError?.message).includes("Actions import modules from 'src/'"));
    assert.ok(filesCheckError!.fix!.includes('"files": ["src"]'));

    // 声明 files: ["src"] 后变为 ok
    const configPath = join(pkgDir, "actiondock.json");
    const raw = JSON.parse(readFileSync(configPath, "utf-8"));
    raw.files = ["src"];
    writeFileSync(configPath, JSON.stringify(raw, null, 2));

    const reportOk = await runDoctorChecks({ cwd: pkgDir, customHome: fakeHome });
    const filesCheckOk = reportOk.checks.find((c) => c.id === "project.files");
    assert.notStrictEqual(filesCheckOk, undefined);
    assert.strictEqual(filesCheckOk?.status, "ok");
    assert.ok((filesCheckOk?.message).includes("boundaries verified"));
  });
});
