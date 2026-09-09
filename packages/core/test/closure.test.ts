import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ensureDependencyClosure } from "../src/project/closure";
import { initProject } from "../src/project/init";
import { linkPackage } from "../src/registry/registry";

describe("Dependency Closure Pre-installation", () => {
  let fakeHome: string;
  let pkgADir: string;
  let pkgBDir: string;

  beforeEach(() => {
    fakeHome = mkdtempSync(join(tmpdir(), "closure-home-"));
    pkgADir = mkdtempSync(join(tmpdir(), "closure-pkg-a-"));
    pkgBDir = mkdtempSync(join(tmpdir(), "closure-pkg-b-"));

    initProject(pkgADir, {
      id: "team.pkg-a",
      name: "Package A",
    });

    initProject(pkgBDir, {
      id: "team.pkg-b",
      name: "Package B",
    });

    linkPackage(pkgADir, fakeHome);
    linkPackage(pkgBDir, fakeHome);
  });

  afterEach(() => {
    rmSync(fakeHome, { recursive: true, force: true });
    rmSync(pkgADir, { recursive: true, force: true });
    rmSync(pkgBDir, { recursive: true, force: true });
  });

  it("traverses uses dependency closure and ensures dependencies across packages", async () => {
    // Package A uses Package B
    const manifestA = {
      schemaVersion: 1,
      actions: {
        "a-act": {
          entry: "actions/a-act.ts",
          uses: ["team.pkg-b/b-act"],
        },
      },
    };
    writeFileSync(join(pkgADir, "actiondock.manifest.json"), JSON.stringify(manifestA, null, 2));

    const manifestB = {
      schemaVersion: 1,
      actions: {
        "b-act": {
          entry: "actions/b-act.ts",
        },
      },
    };
    writeFileSync(join(pkgBDir, "actiondock.manifest.json"), JSON.stringify(manifestB, null, 2));

    const visitedRoots: string[] = [];
    const mockEnsure = (root: string) => {
      visitedRoots.push(root);
      return true;
    };

    const result = await ensureDependencyClosure([pkgADir], {
      ensure: mockEnsure,
      customHome: fakeHome,
    });

    expect(visitedRoots).toContain(pkgADir);
    expect(visitedRoots).toContain(pkgBDir);
    expect(result.installed).toContain(pkgADir);
    expect(result.installed).toContain(pkgBDir);
    expect(result.warnings).toHaveLength(0);
  });

  it("prevents infinite recursion when circular dependencies exist between packages", async () => {
    // A uses B, and B uses A
    const manifestA = {
      schemaVersion: 1,
      actions: {
        "a-act": {
          entry: "actions/a-act.ts",
          uses: ["team.pkg-b/b-act"],
        },
      },
    };
    writeFileSync(join(pkgADir, "actiondock.manifest.json"), JSON.stringify(manifestA, null, 2));

    const manifestB = {
      schemaVersion: 1,
      actions: {
        "b-act": {
          entry: "actions/b-act.ts",
          uses: ["team.pkg-a/a-act"],
        },
      },
    };
    writeFileSync(join(pkgBDir, "actiondock.manifest.json"), JSON.stringify(manifestB, null, 2));

    const visitedRoots: string[] = [];
    const mockEnsure = (root: string) => {
      visitedRoots.push(root);
      return false;
    };

    const result = await ensureDependencyClosure([pkgADir], {
      ensure: mockEnsure,
      customHome: fakeHome,
    });

    expect(visitedRoots.filter((r) => r === pkgADir)).toHaveLength(1);
    expect(visitedRoots.filter((r) => r === pkgBDir)).toHaveLength(1);
    expect(result.warnings).toHaveLength(0);
  });

  it("records warnings for unresolvable package references in manifest uses", async () => {
    const manifestA = {
      schemaVersion: 1,
      actions: {
        "a-act": {
          entry: "actions/a-act.ts",
          uses: ["unregistered.external-pkg/query"],
        },
      },
    };
    writeFileSync(join(pkgADir, "actiondock.manifest.json"), JSON.stringify(manifestA, null, 2));

    const result = await ensureDependencyClosure([pkgADir], {
      ensure: () => false,
      customHome: fakeHome,
    });

    expect(result.warnings.length).toBeGreaterThanOrEqual(1);
    expect(result.warnings[0]).toContain("unregistered.external-pkg/query");
    expect(result.warnings[0]).toContain("未在注册表中解析到包");
  });
});
