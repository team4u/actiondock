import { afterEach, beforeEach, describe, expect, it } from "bun:test";
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

    const rootNodeModules = resolve(__dirname, "../../../node_modules");
    if (existsSync(rootNodeModules)) {
      symlinkSync(rootNodeModules, join(pkgDir, "node_modules"), "dir");
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

    expect(report.hasProject).toBe(false);
    expect(report.checks.length).toBeGreaterThanOrEqual(4);

    const bunCheck = report.checks.find((c) => c.id === "runtime.bun");
    expect(bunCheck).toBeDefined();
    expect(bunCheck?.status).toBe("ok");

    const storageCheck = report.checks.find((c) => c.id === "storage.global");
    expect(storageCheck).toBeDefined();
    expect(storageCheck?.status).toBe("ok");
  });

  it("runs full project diagnostics inside ActionDock project", async () => {
    const report = await runDoctorChecks({ cwd: pkgDir, customHome: fakeHome });

    expect(report.hasProject).toBe(true);
    expect(report.packageId).toBe("team.doctor-test");

    const sdkCheck = report.checks.find((c) => c.id === "project.sdk");
    expect(sdkCheck).toBeDefined();
    expect(sdkCheck?.status).toBe("ok");

    const actionCheck = report.checks.find((c) => c.id === "project.actions");
    expect(actionCheck).toBeDefined();
    expect(actionCheck?.status).toBe("ok");

    const manifestCheck = report.checks.find((c) => c.id === "project.manifest");
    expect(manifestCheck).toBeDefined();
    expect(manifestCheck?.status).toBe("warn");
    expect(manifestCheck?.message).toContain("doctor-act.ts");
    expect(manifestCheck?.fix).toContain("ad action sync");

    const storageProjectCheck = report.checks.find((c) => c.id === "project.storage");
    expect(storageProjectCheck).toBeDefined();
    expect(storageProjectCheck?.status).toBe("ok");
    expect(storageProjectCheck?.message).toContain(fakeHome);

    // Config readiness check should detect missing REQ_API_KEY as a warning
    const configCheck = report.checks.find((c) => c.id === "project.config_readiness");
    expect(configCheck).toBeDefined();
    expect(configCheck?.status).toBe("warn");
    expect(configCheck?.message).toContain("REQ_API_KEY");
  });

  it("detects stale registry links in doctor checks", async () => {
    // Link a directory, then delete that directory
    const tempPkg = mkdtempSync(join(tmpdir(), "temp-pkg-"));
    initProject(tempPkg, { id: "team.temp-stale", name: "Temp Stale" });
    linkPackage(tempPkg, fakeHome);

    // Delete directory to make link stale
    rmSync(tempPkg, { recursive: true, force: true });

    const report = await runDoctorChecks({ cwd: fakeHome, customHome: fakeHome });
    const regCheck = report.checks.find((c) => c.id === "registry.global");
    expect(regCheck).toBeDefined();
    expect(regCheck?.status).toBe("warn");
    expect(regCheck?.message).toContain("stale");
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
    linkPackage(depPkg, fakeHome);

    const report = await runDoctorChecks({ cwd: fakeHome, customHome: fakeHome });
    const depCheck = report.checks.find((c) => c.id === "registry.dependencies");
    expect(depCheck).toBeDefined();
    expect(depCheck?.status).toBe("warn");
    expect(depCheck?.message).toContain("team.missing-deps");
    expect(depCheck?.message).toContain("miss node_modules");

    rmSync(depPkg, { recursive: true, force: true });
  });

  it("detects unresolvable cross-package references in manifest uses", async () => {
    const usesPkg = mkdtempSync(join(tmpdir(), "doctor-uses-pkg-"));
    initProject(usesPkg, { id: "team.uses-pkg", name: "Uses Pkg" });
    const manifest = {
      schemaVersion: 1,
      actions: {
        "call-external": {
          entry: "actions/call.ts",
          uses: ["unresolved.remote/service"],
        },
      },
    };
    writeFileSync(join(usesPkg, "actiondock.manifest.json"), JSON.stringify(manifest, null, 2));
    linkPackage(usesPkg, fakeHome);

    const report = await runDoctorChecks({ cwd: fakeHome, customHome: fakeHome });
    const usesCheck = report.checks.find((c) => c.id === "registry.uses_closure");
    expect(usesCheck).toBeDefined();
    expect(usesCheck?.status).toBe("warn");
    expect(usesCheck?.message).toContain("unresolved.remote/service");

    rmSync(usesPkg, { recursive: true, force: true });
  });
});
