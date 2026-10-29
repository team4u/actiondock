import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  createActionDock,
  PACKAGE_ID_CONFLICT,
} from "../src/index";
import { initProject } from "../src/project/init";
import {
  getRegistryFilePath,
  linkPackage,
  listLinkedPackages,
  resolvePackageRoot,
  unlinkPackage,
} from "../src/registry";
import { PackageDiscovery } from "../src/catalog/discovery";
import { PackageGraphBuilder } from "../src/catalog/graph";
import { quotePathForCli } from "../src/registry/package-conflict";
import { runDoctorChecks } from "../src/doctor";

describe("Package ID Conflict Resolution & Identity Uniqueness Regressions", () => {
  let fakeHome: string;
  let testBaseDir: string;

  beforeEach(() => {
    fakeHome = mkdtempSync(join(tmpdir(), "ad-conflict-home-"));
    testBaseDir = mkdtempSync(join(tmpdir(), "ad-conflict-test-"));
  });

  afterEach(() => {
    rmSync(fakeHome, { recursive: true, force: true });
    rmSync(testBaseDir, { recursive: true, force: true });
  });

  function createPkg(dir: string, id: string, name?: string): void {
    initProject(dir, { id, name: name || id });
    const rootNodeModules = resolve(import.meta.dirname, "../../../node_modules");
    if (existsSync(rootNodeModules)) {
      try {
        symlinkSync(rootNodeModules, join(dir, "node_modules"), "junction");
      } catch {}
    }
  }

  it("single package: rejects conflicting link and leaves registry completely intact", async () => {
    const pkgADir = join(testBaseDir, "pkg-a");
    const pkgBDir = join(testBaseDir, "pkg-b");
    mkdirSync(pkgADir, { recursive: true });
    mkdirSync(pkgBDir, { recursive: true });

    createPkg(pkgADir, "shared.pkg", "Package A");
    createPkg(pkgBDir, "shared.pkg", "Package B");

    // First link succeeds
    const resA = await linkPackage(pkgADir, fakeHome);
    assert.strictEqual(resA.id, "shared.pkg");

    // Second link with same ID and different path must fail
    await assert.rejects(
      async () => {
        await linkPackage(pkgBDir, fakeHome);
      },
      (err: any) => {
        assert.strictEqual(err.code, PACKAGE_ID_CONFLICT);
        assert.ok(err.message.includes("PACKAGE_ID_CONFLICT"));
        assert.ok(err.hint.includes("ad unlink"));
        return true;
      }
    );

    // Registry must remain intact with only pkg-a
    const linked = listLinkedPackages(fakeHome);
    assert.strictEqual(linked.length, 1);
    assert.strictEqual(linked[0].path, pkgADir);
  });

  it("workspace: rejects cross-workspace conflict and leaves registry intact", async () => {
    const ws1Dir = join(testBaseDir, "ws1");
    const ws2Dir = join(testBaseDir, "ws2");
    const sub1 = join(ws1Dir, "tool-x");
    const sub2 = join(ws2Dir, "tool-x");
    mkdirSync(sub1, { recursive: true });
    mkdirSync(sub2, { recursive: true });

    createPkg(sub1, "common.tool", "Tool WS1");
    createPkg(sub2, "common.tool", "Tool WS2");

    // Link ws1
    await linkPackage(ws1Dir, fakeHome);

    // Link ws2 conflicting with ws1 subpackage
    await assert.rejects(
      async () => {
        await linkPackage(ws2Dir, fakeHome);
      },
      (err: any) => {
        assert.strictEqual(err.code, PACKAGE_ID_CONFLICT);
        assert.strictEqual(err.details.existingWorkspaceRoot, ws1Dir);
        assert.ok(err.hint.includes(`ad unlink '${ws1Dir}'`));
        assert.ok(err.hint.includes("连带解除"));
        return true;
      }
    );

    // Registry must only contain ws1
    const regRaw = JSON.parse(readFileSync(getRegistryFilePath(fakeHome), "utf-8"));
    assert.ok(regRaw.workspaces[ws1Dir]);
    assert.strictEqual(regRaw.workspaces[ws2Dir], undefined);
  });

  it("workspace: rejects duplicate package ID within same workspace during link", async () => {
    const wsDir = join(testBaseDir, "intra-ws");
    const child1 = join(wsDir, "dir1");
    const child2 = join(wsDir, "dir2");
    mkdirSync(child1, { recursive: true });
    mkdirSync(child2, { recursive: true });

    createPkg(child1, "dupe.id", "Dupe 1");
    createPkg(child2, "dupe.id", "Dupe 2");

    await assert.rejects(
      async () => {
        await linkPackage(wsDir, fakeHome);
      },
      (err: any) => {
        assert.strictEqual(err.code, PACKAGE_ID_CONFLICT);
        return true;
      }
    );

    if (existsSync(getRegistryFilePath(fakeHome))) {
      const regRaw = JSON.parse(readFileSync(getRegistryFilePath(fakeHome), "utf-8"));
      assert.strictEqual(Object.keys(regRaw.workspaces || {}).length, 0);
    }
  });

  it("deduplicates identical realpath and symlinks/junction aliases", async () => {
    const pkgDir = join(testBaseDir, "pkg-orig");
    const symlinkDir = join(testBaseDir, "pkg-symlink");
    mkdirSync(pkgDir, { recursive: true });
    createPkg(pkgDir, "alias.tool", "Alias Tool");

    symlinkSync(pkgDir, symlinkDir, "junction");

    // Link original
    await linkPackage(pkgDir, fakeHome);

    // Link via symlink to same directory must not throw and deduplicate
    const resSym = await linkPackage(symlinkDir, fakeHome);
    assert.strictEqual(resSym.id, "alias.tool");

    const linked = listLinkedPackages(fakeHome);
    assert.strictEqual(linked.length, 1);
  });

  it("concurrent conflicting links: at most one succeeds", async () => {
    const dirA = join(testBaseDir, "race-a");
    const dirB = join(testBaseDir, "race-b");
    mkdirSync(dirA, { recursive: true });
    mkdirSync(dirB, { recursive: true });

    createPkg(dirA, "race.pkg", "Race A");
    createPkg(dirB, "race.pkg", "Race B");

    const results = await Promise.allSettled([
      linkPackage(dirA, fakeHome),
      linkPackage(dirB, fakeHome),
    ]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");

    assert.strictEqual(fulfilled.length, 1);
    assert.strictEqual(rejected.length, 1);
    const err = (rejected[0] as PromiseRejectedResult).reason;
    assert.strictEqual(err.code, PACKAGE_ID_CONFLICT);
  });

  it("dynamically added subpackage into workspace causing conflict is detected", async () => {
    const wsDir = join(testBaseDir, "ws-dyn");
    const standaloneDir = join(testBaseDir, "pkg-dyn");
    mkdirSync(wsDir, { recursive: true });
    mkdirSync(standaloneDir, { recursive: true });

    createPkg(standaloneDir, "dyn.tool", "Standalone Tool");
    await linkPackage(standaloneDir, fakeHome);

    // Link empty workspace first
    const subInitial = join(wsDir, "sub-initial");
    mkdirSync(subInitial, { recursive: true });
    createPkg(subInitial, "initial.tool", "Initial Tool");
    await linkPackage(wsDir, fakeHome);

    // Now dynamically add conflicting subproject into workspace
    const subConflict = join(wsDir, "sub-conflict");
    mkdirSync(subConflict, { recursive: true });
    createPkg(subConflict, "dyn.tool", "Conflicting Tool in WS");

    // Dynamic scan via listLinkedPackages must throw PACKAGE_ID_CONFLICT
    assert.throws(
      () => listLinkedPackages(fakeHome),
      (err: any) => {
        assert.strictEqual(err.code, PACKAGE_ID_CONFLICT);
        assert.ok(
          (err.details.existingPath === subConflict && err.details.incomingPath === standaloneDir) ||
          (err.details.existingPath === standaloneDir && err.details.incomingPath === subConflict)
        );
        return true;
      }
    );
  });

  it("handcrafted historical conflict in registry blocks discovery, Host, and GraphBuilder", async () => {
    const ws1 = join(testBaseDir, "hist-ws1");
    const ws2 = join(testBaseDir, "hist-ws2");
    const child1 = join(ws1, "sub1");
    const child2 = join(ws2, "sub2");
    mkdirSync(child1, { recursive: true });
    mkdirSync(child2, { recursive: true });

    createPkg(child1, "hist.pkg", "Hist 1");
    createPkg(child2, "hist.pkg", "Hist 2");

    // Write handcrafted historical conflict with two workspaces containing same ID
    const regPath = getRegistryFilePath(fakeHome);
    mkdirSync(join(fakeHome, ".actiondock"), { recursive: true });
    const regData = {
      version: "2.0.0",
      packages: {},
      workspaces: {
        [ws1]: { path: ws1, linkedAt: new Date().toISOString() },
        [ws2]: { path: ws2, linkedAt: new Date().toISOString() },
      },
    };
    writeFileSync(regPath, JSON.stringify(regData, null, 2));

    // 1. PackageDiscovery discoverSync throws
    const disc = new PackageDiscovery({ customHome: fakeHome });
    assert.throws(() => disc.discoverSync(), (err: any) => err.code === PACKAGE_ID_CONFLICT);

    // 2. Host creation throws
    await assert.rejects(
      async () => {
        await createActionDock({
          type: "local",
          customHome: fakeHome,
        });
      },
      (err: any) => err.code === PACKAGE_ID_CONFLICT
    );

    // 3. PackageGraphBuilder throws
    assert.throws(
      () => new PackageGraphBuilder({ customHome: fakeHome, allowDevLinks: true }).buildSync(),
      (err: any) => err.code === PACKAGE_ID_CONFLICT
    );

    // 4. Unlinking one workspace in conflict state succeeds without error
    const unlinkRes = await unlinkPackage(ws2, fakeHome);
    assert.notStrictEqual(unlinkRes, null);

    // 5. Subsequent listing and discovery succeed
    const linkedAfter = listLinkedPackages(fakeHome);
    assert.strictEqual(linkedAfter.length, 1);
    assert.strictEqual(linkedAfter[0].path, child1);
  });

  it("scenario: registry links installed B, current project is unlinked dev A with same ID", async () => {
    const installedB = join(testBaseDir, "installed-b");
    const devA = join(testBaseDir, "dev-a");
    mkdirSync(installedB, { recursive: true });
    mkdirSync(devA, { recursive: true });

    createPkg(installedB, "app.core", "Installed B");
    createPkg(devA, "app.core", "Dev A");

    // Registry only links B (global registry itself has no duplicates!)
    await linkPackage(installedB, fakeHome);
    const globalLinked = listLinkedPackages(fakeHome);
    assert.strictEqual(globalLinked.length, 1);
    assert.strictEqual(globalLinked[0].path, installedB);

    // 1. resolvePackageRoot from devA with target 'app.core' must fail
    assert.throws(
      () => resolvePackageRoot("app.core", devA, fakeHome),
      (err: any) => {
        assert.strictEqual(err.code, PACKAGE_ID_CONFLICT);
        return true;
      }
    );

    // 2. PackageDiscovery from devA must fail
    const disc = new PackageDiscovery({ currentProjectRoot: devA, customHome: fakeHome });
    assert.throws(() => disc.discoverSync(), (err: any) => err.code === PACKAGE_ID_CONFLICT);

    // 3. PackageGraphBuilder in mode B with root devA must fail
    assert.throws(
      () => new PackageGraphBuilder({ root: devA, customHome: fakeHome, allowDevLinks: true }).buildSync(),
      (err: any) => err.code === PACKAGE_ID_CONFLICT
    );

    // 4. Host with devA and scanLinkedPackages:true must fail
    await assert.rejects(
      async () => {
        await createActionDock({
          type: "local",
          projectRoot: devA,
          customHome: fakeHome,
          scanLinkedPackages: true,
        });
      },
      (err: any) => err.code === PACKAGE_ID_CONFLICT
    );

    // 5. Host with devA and scanLinkedPackages:false must NOT fail
    const serviceNoScan = await createActionDock({
      type: "local",
      projectRoot: devA,
      customHome: fakeHome,
      scanLinkedPackages: false,
    });
    try {
      const pkgs = await serviceNoScan.discovery.listPackages();
      assert.strictEqual(pkgs.length, 1);
      assert.strictEqual(pkgs[0].packageRoot, devA);
    } finally {
      await serviceNoScan.close();
    }
  });

  it("doctor: reports registry.duplicates with status error and allows other checks to complete", async () => {
    const dir1 = join(testBaseDir, "doc-1");
    const ws2 = join(testBaseDir, "doc-ws2");
    const child2 = join(ws2, "sub2");
    mkdirSync(dir1, { recursive: true });
    mkdirSync(child2, { recursive: true });

    createPkg(dir1, "doc.tool", "Doc 1");
    createPkg(child2, "doc.tool", "Doc 2");

    const regPath = getRegistryFilePath(fakeHome);
    mkdirSync(join(fakeHome, ".actiondock"), { recursive: true });
    writeFileSync(
      regPath,
      JSON.stringify(
        {
          version: "2.0.0",
          packages: {
            "doc.tool": {
              id: "doc.tool",
              name: "Doc 1",
              version: "1.0.0",
              path: dir1,
              linkedAt: new Date().toISOString(),
            },
          },
          workspaces: {
            [ws2]: { path: ws2, linkedAt: new Date().toISOString() },
          },
        },
        null,
        2
      )
    );

    const report = await runDoctorChecks({ customHome: fakeHome, cwd: fakeHome });
    assert.strictEqual(report.ok, false);

    const dupeCheck = report.checks.find((c) => c.id === "registry.duplicates");
    assert.notStrictEqual(dupeCheck, undefined);
    assert.strictEqual(dupeCheck?.status, "error");
    assert.ok(dupeCheck?.message.includes("PACKAGE_ID_CONFLICT"));
    assert.ok(dupeCheck?.fix?.includes("ad unlink"));

    // Other checks like runtime.node must still run and be ok
    const nodeCheck = report.checks.find((c) => c.id === "runtime.node");
    assert.notStrictEqual(nodeCheck, undefined);
    assert.strictEqual(nodeCheck?.status, "ok");
  });

  it("doctor allowlist: does not leak unallowed package paths into report", async () => {
    const unallowed1 = join(testBaseDir, "unauth-1");
    const unallowedWs = join(testBaseDir, "unauth-ws");
    const unallowed2 = join(unallowedWs, "sub");
    const allowedDir = join(testBaseDir, "allowed-pkg");
    mkdirSync(unallowed1, { recursive: true });
    mkdirSync(unallowed2, { recursive: true });
    mkdirSync(allowedDir, { recursive: true });

    createPkg(unallowed1, "secret.tool", "Secret 1");
    createPkg(unallowed2, "secret.tool", "Secret 2");
    createPkg(allowedDir, "public.tool", "Public Tool");

    const regPath = getRegistryFilePath(fakeHome);
    mkdirSync(join(fakeHome, ".actiondock"), { recursive: true });
    writeFileSync(
      regPath,
      JSON.stringify(
        {
          version: "2.0.0",
          packages: {
            "public.tool": {
              id: "public.tool",
              name: "Public Tool",
              version: "1.0.0",
              path: allowedDir,
              linkedAt: new Date().toISOString(),
            },
            "secret.tool": {
              id: "secret.tool",
              name: "Secret 1",
              version: "1.0.0",
              path: unallowed1,
              linkedAt: new Date().toISOString(),
            },
          },
          workspaces: {
            [unallowedWs]: { path: unallowedWs, linkedAt: new Date().toISOString() },
          },
        },
        null,
        2
      )
    );

    // Run doctor with packageAllowlist restricted to 'public.tool'
    const report = await runDoctorChecks({
      customHome: fakeHome,
      cwd: allowedDir,
      packageAllowlist: ["public.tool"],
    });

    const dupeCheck = report.checks.find((c) => c.id === "registry.duplicates");
    assert.notStrictEqual(dupeCheck, undefined);
    assert.strictEqual(dupeCheck?.status, "ok");

    // Ensure neither unauth-1 nor unauth-2 physical path is leaked in report
    const reportJson = JSON.stringify(report);
    assert.ok(!reportJson.includes(unallowed1), "unauthorized path 1 must not appear in report");
    assert.ok(!reportJson.includes(unallowed2), "unauthorized path 2 must not appear in report");
  });

  it("doctor explicit packageIdOrPath + allowlist does not crash or leak unauthorized paths", async () => {
    const unallowedWs = join(testBaseDir, "secret-ws");
    const unallowedChild = join(unallowedWs, "sub");
    const allowedDir = join(testBaseDir, "explicit-allowed");
    mkdirSync(unallowedChild, { recursive: true });
    mkdirSync(allowedDir, { recursive: true });

    createPkg(unallowedChild, "secret.conflict", "Secret 1");
    createPkg(allowedDir, "public.tool", "Public Tool");

    const regPath = getRegistryFilePath(fakeHome);
    mkdirSync(join(fakeHome, ".actiondock"), { recursive: true });
    writeFileSync(
      regPath,
      JSON.stringify(
        {
          version: "2.0.0",
          packages: {
            "public.tool": {
              id: "public.tool",
              name: "Public Tool",
              version: "1.0.0",
              path: allowedDir,
              linkedAt: new Date().toISOString(),
            },
            "secret.conflict": {
              id: "secret.conflict",
              name: "Secret Dup",
              version: "1.0.0",
              path: join(testBaseDir, "secret-dup"),
              linkedAt: new Date().toISOString(),
            },
          },
          workspaces: {
            [unallowedWs]: { path: unallowedWs, linkedAt: new Date().toISOString() },
          },
        },
        null,
        2
      )
    );

    // Call runDoctorChecks with explicit packageIdOrPath: 'public.tool' and packageAllowlist
    const report = await runDoctorChecks({
      customHome: fakeHome,
      cwd: fakeHome,
      packageIdOrPath: "public.tool",
      packageAllowlist: ["public.tool"],
    });

    assert.strictEqual(report.hasProject, true);
    const dupeCheck = report.checks.find((c) => c.id === "registry.duplicates");
    assert.strictEqual(dupeCheck?.status, "ok");
    const reportJson = JSON.stringify(report);
    assert.ok(!reportJson.includes("secret-ws"));
    assert.ok(!reportJson.includes("secret-dup"));
  });

  it("doctor registry conflict failure does not mark dependencies or uses as ok", async () => {
    const dir1 = join(testBaseDir, "doc-fail-1");
    const ws2 = join(testBaseDir, "doc-fail-ws2");
    const child2 = join(ws2, "sub2");
    mkdirSync(dir1, { recursive: true });
    mkdirSync(child2, { recursive: true });

    createPkg(dir1, "fail.tool", "Doc 1");
    createPkg(child2, "fail.tool", "Doc 2");

    const regPath = getRegistryFilePath(fakeHome);
    mkdirSync(join(fakeHome, ".actiondock"), { recursive: true });
    writeFileSync(
      regPath,
      JSON.stringify(
        {
          version: "2.0.0",
          packages: {
            "fail.tool": {
              id: "fail.tool",
              name: "Doc 1",
              version: "1.0.0",
              path: dir1,
              linkedAt: new Date().toISOString(),
            },
          },
          workspaces: {
            [ws2]: { path: ws2, linkedAt: new Date().toISOString() },
          },
        },
        null,
        2
      )
    );

    const report = await runDoctorChecks({ customHome: fakeHome, cwd: fakeHome });
    assert.strictEqual(report.ok, false);

    const depCheck = report.checks.find((c) => c.id === "registry.dependencies");
    assert.notStrictEqual(depCheck, undefined);
    assert.strictEqual(depCheck?.status, "error");

    const usesCheck = report.checks.find((c) => c.id === "registry.uses_closure");
    assert.notStrictEqual(usesCheck, undefined);
    assert.strictEqual(usesCheck?.status, "error");
  });

  it("host ignores stale/missing linked paths without false package conflict", async () => {
    const activeDir = join(testBaseDir, "active-host-pkg");
    const missingDir = join(testBaseDir, "missing-old-pkg");
    mkdirSync(activeDir, { recursive: true });
    createPkg(activeDir, "stale.test", "Active");

    const regPath = getRegistryFilePath(fakeHome);
    mkdirSync(join(fakeHome, ".actiondock"), { recursive: true });
    writeFileSync(
      regPath,
      JSON.stringify(
        {
          version: "2.0.0",
          packages: {
            "stale.test": {
              id: "stale.test",
              name: "Old Stale",
              version: "1.0.0",
              path: missingDir,
              linkedAt: new Date().toISOString(),
            },
          },
          workspaces: {},
        },
        null,
        2
      )
    );

    // Starting host with activeDir must NOT falsely throw PACKAGE_ID_CONFLICT against missingDir
    const hostService = await createActionDock({
      type: "local",
      projectRoot: activeDir,
      customHome: fakeHome,
      scanLinkedPackages: true,
    });
    try {
      const pkgs = await hostService.discovery.listPackages();
      assert.strictEqual(pkgs.length, 1);
      assert.strictEqual(pkgs[0].packageRoot, activeDir);
    } finally {
      await hostService.close();
    }
  });

  it("workspace child package manifest rename does not trigger false conflict on old cached ID", async () => {
    const wsA = join(testBaseDir, "ws-a");
    const childA = join(wsA, "sub-a");
    mkdirSync(childA, { recursive: true });
    createPkg(childA, "review.original", "Original A");

    // Link workspace A
    await linkPackage(wsA, fakeHome);

    // Now rename child A manifest ID to 'review.renamed' (simulating git branch switch or rename)
    const cfgPathA = join(childA, "actiondock.json");
    const cfgA = JSON.parse(readFileSync(cfgPathA, "utf-8"));
    cfgA.id = "review.renamed";
    writeFileSync(cfgPathA, JSON.stringify(cfgA, null, 2) + "\n");

    // Workspace B contains 'review.original'
    const wsB = join(testBaseDir, "ws-b");
    const childB = join(wsB, "sub-b");
    mkdirSync(childB, { recursive: true });
    createPkg(childB, "review.original", "Original B");

    // Linking workspace B must succeed without false conflict!
    const linkBRes = await linkPackage(wsB, fakeHome);
    assert.strictEqual(linkBRes.id, "ws-b");

    // Dynamic list should contain both review.renamed and review.original cleanly
    const linked = listLinkedPackages(fakeHome);
    const ids = linked.map((p) => p.id).sort();
    assert.deepEqual(ids, ["review.original", "review.renamed"]);
  });

  it("quotes POSIX repair paths without expanding shell operators or variables", () => {
    const path = "/tmp/Agent tools/Bob's $cache;`tool";
    assert.strictEqual(
      quotePathForCli(path, "linux"),
      "'/tmp/Agent tools/Bob'\\''s $cache;`tool'"
    );
    assert.strictEqual(quotePathForCli("/tmp/a;b", "linux"), "'/tmp/a;b'");
  });

  it("quotes PowerShell repair paths while preserving backslashes and literal special characters", () => {
    const path = "D:\\Agent tools\\Bob's $cache\\`tool";
    assert.strictEqual(
      quotePathForCli(path, "win32"),
      "'D:\\Agent tools\\Bob''s $cache\\`tool'"
    );
  });

  it("discovery and graph retain workspaceRoot and format quoted path for spaces in conflict hint", async () => {
    const wsWithSpace = join(testBaseDir, "workspace with space");
    const child = join(wsWithSpace, "child pkg");
    const devDir = join(testBaseDir, "dev local");
    mkdirSync(child, { recursive: true });
    mkdirSync(devDir, { recursive: true });

    createPkg(child, "space.tool", "Child Tool");
    createPkg(devDir, "space.tool", "Dev Tool");

    await linkPackage(wsWithSpace, fakeHome);

    // 1. PackageDiscovery from devDir
    const disc = new PackageDiscovery({ currentProjectRoot: devDir, customHome: fakeHome });
    try {
      disc.discoverSync();
      assert.fail("should have thrown PACKAGE_ID_CONFLICT");
    } catch (err: any) {
      assert.strictEqual(err.code, PACKAGE_ID_CONFLICT);
      assert.strictEqual(err.details.incomingWorkspaceRoot, wsWithSpace);
      // Hint must have quoted path
      assert.ok(err.hint.includes(`ad unlink '${wsWithSpace}'`));
      assert.ok(err.message.includes(wsWithSpace));
      assert.ok(err.message.includes(child));
    }

    // 2. PackageGraphBuilder from devDir
    try {
      new PackageGraphBuilder({ root: devDir, customHome: fakeHome, allowDevLinks: true }).buildSync();
      assert.fail("should have thrown PACKAGE_ID_CONFLICT");
    } catch (err: any) {
      assert.strictEqual(err.code, PACKAGE_ID_CONFLICT);
      assert.strictEqual(err.details.incomingWorkspaceRoot, wsWithSpace);
      assert.ok(err.hint.includes(`ad unlink '${wsWithSpace}'`));
      assert.ok(err.message.includes(wsWithSpace));
    }
  });

  it("regression 1: stale entry does not block live candidate; conflicting link fails atomically and leaves registry file intact", async () => {
    const dirA = join(testBaseDir, "stale-live-a");
    const dirB = join(testBaseDir, "stale-live-b");
    const dirC = join(testBaseDir, "stale-live-c");
    mkdirSync(dirA, { recursive: true });
    mkdirSync(dirB, { recursive: true });
    mkdirSync(dirC, { recursive: true });

    createPkg(dirA, "app.x", "App X");
    createPkg(dirB, "app.y", "App Y");
    createPkg(dirC, "app.x", "App X Candidate");

    await linkPackage(dirA, fakeHome);
    await linkPackage(dirB, fakeHome);

    // 删除 dirA，将 dirB 的清单 ID 改为 app.x
    rmSync(dirA, { recursive: true, force: true });
    const cfgPathB = join(dirB, "actiondock.json");
    const cfgB = JSON.parse(readFileSync(cfgPathB, "utf-8"));
    cfgB.id = "app.x";
    writeFileSync(cfgPathB, JSON.stringify(cfgB, null, 2) + "\n");

    // listLinkedPackages 必须返回存活的 dirB，陈旧的 dirA 不得占住有效身份
    const effectiveList = listLinkedPackages(fakeHome);
    const matchedLive = effectiveList.find((p) => p.id === "app.x");
    assert.strictEqual(matchedLive?.path, dirB);

    // 尝试 link 冲突的 dirC 必须被拒绝且注册表文件完全保持原样不变（失败 link 文件不变）
    const regFilePath = getRegistryFilePath(fakeHome);
    const beforeContent = readFileSync(regFilePath, "utf-8");

    await assert.rejects(
      async () => {
        await linkPackage(dirC, fakeHome);
      },
      (err: any) => {
        assert.strictEqual(err.code, PACKAGE_ID_CONFLICT);
        return true;
      }
    );

    const afterContent = readFileSync(regFilePath, "utf-8");
    assert.strictEqual(afterContent, beforeContent);
  });

  it("regression 2: rename-preserves-source, unlink without revival, and unlink by path survives conflict", async () => {
    const dirA = join(testBaseDir, "rename-pkg-a");
    const dirB = join(testBaseDir, "rename-pkg-b");
    mkdirSync(dirA, { recursive: true });
    mkdirSync(dirB, { recursive: true });

    createPkg(dirA, "old.id", "Package A");
    await linkPackage(dirA, fakeHome);

    // 改名 A 为 new.id，并链接具有 old.id 的 B
    const cfgPathA = join(dirA, "actiondock.json");
    const cfgA = JSON.parse(readFileSync(cfgPathA, "utf-8"));
    cfgA.id = "new.id";
    writeFileSync(cfgPathA, JSON.stringify(cfgA, null, 2) + "\n");

    createPkg(dirB, "old.id", "Package B");
    await linkPackage(dirB, fakeHome);

    // 两个来源均必须保留，不能相互覆盖丢包
    const entries = listLinkedPackages(fakeHome);
    assert.strictEqual(entries.find((p) => p.id === "new.id")?.path, dirA);
    assert.strictEqual(entries.find((p) => p.id === "old.id")?.path, dirB);

    // unlink new.id 成功解除且彻底移除物理来源别名，删除后旧记录不复活
    const unlinkRes = await unlinkPackage("new.id", fakeHome);
    assert.ok(unlinkRes);
    const afterUnlink = listLinkedPackages(fakeHome);
    assert.ok(!afterUnlink.some((p) => p.path === dirA));
    assert.strictEqual(afterUnlink.length, 1);
    assert.strictEqual(afterUnlink[0].id, "old.id");

    // 冲突场景下仍可通过工作区路径强制解除链接
    const wsDir = join(testBaseDir, "conflict-ws");
    const wsChild = join(wsDir, "conflict-child");
    mkdirSync(wsChild, { recursive: true });
    createPkg(wsChild, "old.id", "Conflict Child");
    const regFilePath = getRegistryFilePath(fakeHome);
    const regData = JSON.parse(readFileSync(regFilePath, "utf-8"));
    regData.workspaces = regData.workspaces || {};
    regData.workspaces[wsDir] = { path: wsDir, linkedAt: new Date().toISOString() };
    writeFileSync(regFilePath, JSON.stringify(regData, null, 2));

    // 此时 listLinkedPackages 会因重复 old.id 冲突抛出 PACKAGE_ID_CONFLICT
    assert.throws(() => listLinkedPackages(fakeHome), (err: any) => err.code === PACKAGE_ID_CONFLICT);

    // 但 unlinkPackage(wsDir) 仍可按工作区根绝对路径成功解除
    const unlinkWsRes = await unlinkPackage(wsDir, fakeHome);
    assert.ok(unlinkWsRes);
    assert.strictEqual(listLinkedPackages(fakeHome).length, 1);
  });

  it("regression 3: exact ID match takes priority over slug match without false conflict", async () => {
    const dirCurrent = join(testBaseDir, "exact-slug-current");
    const dirLinked = join(testBaseDir, "exact-slug-linked");
    mkdirSync(dirCurrent, { recursive: true });
    mkdirSync(dirLinked, { recursive: true });

    createPkg(dirCurrent, "tools", "Current Tools");
    createPkg(dirLinked, "team.tools", "Team Tools");
    await linkPackage(dirLinked, fakeHome);

    // 当前工程完整 ID 为 tools，外部链接包短名亦为 tools；必须准确解析为当前工程，绝不能抛 PACKAGE_ID_CONFLICT
    const resolved = resolvePackageRoot("tools", dirCurrent, fakeHome);
    assert.strictEqual(resolved, dirCurrent);

    // 当两工程均仅命中短名时，当前所在工程优先
    const dirA = join(testBaseDir, "short-name-a");
    const dirB = join(testBaseDir, "short-name-b");
    mkdirSync(dirA, { recursive: true });
    mkdirSync(dirB, { recursive: true });
    createPkg(dirA, "team.a.tools", "Tools A");
    createPkg(dirB, "team.b.tools", "Tools B");
    await linkPackage(dirB, fakeHome);

    const resolvedShort = resolvePackageRoot("tools", dirA, fakeHome);
    assert.strictEqual(resolvedShort, dirA);
  });

  it("regression 4: deleted / missing linked directory does not trigger false conflict with live project", async () => {
    const dirLive = join(testBaseDir, "missing-live");
    const dirStale = join(testBaseDir, "missing-stale");
    mkdirSync(dirLive, { recursive: true });
    mkdirSync(dirStale, { recursive: true });

    createPkg(dirLive, "same.id", "Live Pkg");
    createPkg(dirStale, "same.id", "Stale Pkg");

    await linkPackage(dirStale, fakeHome);
    rmSync(dirStale, { recursive: true, force: true });

    // 外部已链接包已从磁盘删除，当前工程依然可按 ID 正常解析，陈旧来源不抛身份冲突
    const resolved = resolvePackageRoot("same.id", dirLive, fakeHome);
    assert.strictEqual(resolved, dirLive);
  });

  it("regression 5: corrupted workspace and standalone sources keep diagnostics, without faking valid identity or leaking unauthorized paths", async () => {
    const wsDir = join(testBaseDir, "corrupt-ws");
    const validChild = join(wsDir, "valid-child");
    const brokenChild = join(wsDir, "broken-child");
    mkdirSync(validChild, { recursive: true });
    mkdirSync(brokenChild, { recursive: true });

    createPkg(validChild, "valid.pkg", "Valid");
    createPkg(brokenChild, "broken.pkg", "Broken");
    await linkPackage(wsDir, fakeHome);

    // 将 brokenChild 写为损坏的 JSON
    writeFileSync(join(brokenChild, "actiondock.json"), "{ invalid manifest json");

    // 1. Host 启动时输出告警并保留失败记录
    const hostWarnings: string[] = [];
    const host = await createActionDock({
      type: "local",
      customHome: fakeHome,
      hostOptions: {
        autoLoadCurrentProject: false,
        scanLinkedPackages: true,
        logger: {
          debug() {},
          info() {},
          error() {},
          warn(msg: string) { hostWarnings.push(String(msg)); },
        },
      },
    });
    try {
      assert.ok(hostWarnings.some((w) => w.includes(brokenChild)));
    } finally {
      await host.close();
    }

    // 2. Doctor 报告实际扫描/清单错误，不能为 ok: true
    const reportFull = await runDoctorChecks({ cwd: fakeHome, customHome: fakeHome });
    assert.strictEqual(reportFull.ok, false);
    const regCheck = reportFull.checks.find((c) => c.category === "registry" && c.status === "error");
    assert.ok(regCheck);

    // 3. 受限白名单不泄露未授权路径（白名单仅含 valid.pkg 时，报告绝不包含 brokenChild 路径）
    const reportLimited = await runDoctorChecks({
      cwd: fakeHome,
      customHome: fakeHome,
      packageAllowlist: ["valid.pkg"],
    });
    assert.ok(!JSON.stringify(reportLimited).includes(brokenChild));

    // 4. 损坏的独立包不冒充有效身份触发与存活工程的 PACKAGE_ID_CONFLICT
    const standaloneBroken = join(testBaseDir, "standalone-broken");
    const currentLive = join(testBaseDir, "current-live");
    mkdirSync(standaloneBroken, { recursive: true });
    mkdirSync(currentLive, { recursive: true });
    createPkg(standaloneBroken, "shared.identity", "Broken Standalone");
    createPkg(currentLive, "shared.identity", "Current Live");

    await linkPackage(standaloneBroken, fakeHome);
    writeFileSync(join(standaloneBroken, "actiondock.json"), "{ corrupt json");

    const resolved = resolvePackageRoot("shared.identity", currentLive, fakeHome);
    assert.strictEqual(resolved, currentLive);
  });

  it("regression 6: doctor locateProject considers cwd under allowlist and detects conflict with registered package", async () => {
    const dirA = join(testBaseDir, "doctor-cwd-a");
    const dirB = join(testBaseDir, "doctor-cwd-b");
    mkdirSync(dirA, { recursive: true });
    mkdirSync(dirB, { recursive: true });

    createPkg(dirA, "app.a", "App A");
    createPkg(dirB, "app.a", "App B");

    // 只有 A，无链接 B：指定 packageIdOrPath='app.a' 且白名单限制为 ['app.a'] 时必须定位到 A
    const reportOwn = await runDoctorChecks({
      cwd: dirA,
      packageIdOrPath: "app.a",
      customHome: fakeHome,
      packageAllowlist: ["app.a"],
    });
    assert.strictEqual(reportOwn.projectRoot, dirA);
    assert.strictEqual(reportOwn.hasProject, true);

    // 链接 B 后，再次体检必须检测出当前工程 A 与已链接 B 的包冲突，且状态为 error
    await linkPackage(dirB, fakeHome);
    const reportConflict = await runDoctorChecks({
      cwd: dirA,
      packageIdOrPath: "app.a",
      customHome: fakeHome,
      packageAllowlist: ["app.a"],
    });
    assert.strictEqual(reportConflict.ok, false);
    const dupCheck = reportConflict.checks.find((c) => c.id === "registry.duplicates");
    assert.strictEqual(dupCheck?.status, "error");
  });

  it("regression 7: doctor uses closure verifies live cross-package dependency under allowlist without false missing warning or path leakage", async () => {
    const dirApp = join(testBaseDir, "closure-app");
    const dirDep = join(testBaseDir, "closure-dep");
    mkdirSync(dirApp, { recursive: true });
    mkdirSync(dirDep, { recursive: true });

    createPkg(dirApp, "app.main", "App Main");
    createPkg(dirDep, "dep.lib", "Dep Lib");

    // 在 app.main 中声明 uses: ['dep.lib/ping']
    const actDir = join(dirApp, "actions");
    mkdirSync(actDir, { recursive: true });
    writeFileSync(join(actDir, "call.ts"), "export default { run: () => ({}) };\n");
    const cfgPath = join(dirApp, "actiondock.json");
    const cfg = JSON.parse(readFileSync(cfgPath, "utf-8"));
    cfg.actions = {
      ping: {
        entry: "actions/call.ts",
        uses: ["dep.lib/ping"],
      },
    };
    writeFileSync(cfgPath, JSON.stringify(cfg, null, 2) + "\n");

    await linkPackage(dirDep, fakeHome);

    // 受限仅体检 app.main 时，已链接的 dep.lib 必须被正确判定为可用，不得误报缺失
    const report = await runDoctorChecks({
      cwd: dirApp,
      customHome: fakeHome,
      packageAllowlist: ["app.main"],
    });
    const usesCheck = report.checks.find((c) => c.id === "registry.uses_closure");
    assert.strictEqual(usesCheck?.status, "ok");
    assert.ok(!JSON.stringify(report).includes(dirDep));
  });

  it("sequential renaming preserves all sources across multiple packages without dropping records", async () => {
    const dirA = join(testBaseDir, "rename-a");
    const dirB = join(testBaseDir, "rename-b");
    const dirC = join(testBaseDir, "rename-c");
    mkdirSync(dirA, { recursive: true });
    mkdirSync(dirB, { recursive: true });
    mkdirSync(dirC, { recursive: true });

    createPkg(dirA, "old.id", "Pkg A");
    createPkg(dirB, "new.id", "Pkg B");
    createPkg(dirC, "extra.id", "Pkg C");

    await linkPackage(dirA, fakeHome);
    await linkPackage(dirB, fakeHome);

    // 修改 A -> new.id, B -> other.id
    const cfgPathA = join(dirA, "actiondock.json");
    const cfgA = JSON.parse(readFileSync(cfgPathA, "utf-8"));
    cfgA.id = "new.id";
    writeFileSync(cfgPathA, JSON.stringify(cfgA, null, 2) + "\n");

    const cfgPathB = join(dirB, "actiondock.json");
    const cfgB = JSON.parse(readFileSync(cfgPathB, "utf-8"));
    cfgB.id = "other.id";
    writeFileSync(cfgPathB, JSON.stringify(cfgB, null, 2) + "\n");

    // 链接无关 C
    await linkPackage(dirC, fakeHome);

    const list = listLinkedPackages(fakeHome);
    assert.strictEqual(list.length, 3);
    const itemNew = list.find((p) => p.id === "new.id");
    const itemOther = list.find((p) => p.id === "other.id");
    const itemExtra = list.find((p) => p.id === "extra.id");

    assert.ok(itemNew);
    assert.strictEqual(itemNew.path, dirA);
    assert.ok(itemOther);
    assert.strictEqual(itemOther.path, dirB);
    assert.ok(itemExtra);
    assert.strictEqual(itemExtra.path, dirC);
  });

  it("swapping package IDs preserves all sources without dropping entries", async () => {
    const dirA = join(testBaseDir, "swap-a");
    const dirB = join(testBaseDir, "swap-b");
    const dirC = join(testBaseDir, "swap-c");
    mkdirSync(dirA, { recursive: true });
    mkdirSync(dirB, { recursive: true });
    mkdirSync(dirC, { recursive: true });

    createPkg(dirA, "one.id", "Pkg A");
    createPkg(dirB, "two.id", "Pkg B");
    createPkg(dirC, "c.id", "Pkg C");

    await linkPackage(dirA, fakeHome);
    await linkPackage(dirB, fakeHome);

    // 交换清单 ID: A -> two.id, B -> one.id
    const cfgPathA = join(dirA, "actiondock.json");
    const cfgA = JSON.parse(readFileSync(cfgPathA, "utf-8"));
    cfgA.id = "two.id";
    writeFileSync(cfgPathA, JSON.stringify(cfgA, null, 2) + "\n");

    const cfgPathB = join(dirB, "actiondock.json");
    const cfgB = JSON.parse(readFileSync(cfgPathB, "utf-8"));
    cfgB.id = "one.id";
    writeFileSync(cfgPathB, JSON.stringify(cfgB, null, 2) + "\n");

    // 链接无关 C 触发锁内索引同步
    await linkPackage(dirC, fakeHome);

    const list = listLinkedPackages(fakeHome);
    assert.strictEqual(list.length, 3);
    const itemTwo = list.find((p) => p.id === "two.id");
    const itemOne = list.find((p) => p.id === "one.id");
    const itemC = list.find((p) => p.id === "c.id");

    assert.ok(itemTwo);
    assert.strictEqual(itemTwo.path, dirA);
    assert.ok(itemOne);
    assert.strictEqual(itemOne.path, dirB);
    assert.ok(itemC);
    assert.strictEqual(itemC.path, dirC);
  });

  it("unlink by live renamed ID targets valid source rather than stale raw key", async () => {
    const dirA = join(testBaseDir, "unlink-a");
    const dirB = join(testBaseDir, "unlink-b");
    mkdirSync(dirA, { recursive: true });
    mkdirSync(dirB, { recursive: true });

    createPkg(dirA, "old.id", "Pkg A");
    createPkg(dirB, "new.id", "Pkg B");

    await linkPackage(dirA, fakeHome);
    await linkPackage(dirB, fakeHome);

    // 修改 A -> new.id, B -> other.id（不重新 link）
    const cfgPathA = join(dirA, "actiondock.json");
    const cfgA = JSON.parse(readFileSync(cfgPathA, "utf-8"));
    cfgA.id = "new.id";
    writeFileSync(cfgPathA, JSON.stringify(cfgA, null, 2) + "\n");

    const cfgPathB = join(dirB, "actiondock.json");
    const cfgB = JSON.parse(readFileSync(cfgPathB, "utf-8"));
    cfgB.id = "other.id";
    writeFileSync(cfgPathB, JSON.stringify(cfgB, null, 2) + "\n");

    // 不做 relink，按 new.id 执行 unlink
    const removed = await unlinkPackage("new.id", fakeHome);
    assert.ok(removed);
    assert.strictEqual(removed.path, dirA);

    // B (other.id) 依然完好保留
    const list = listLinkedPackages(fakeHome);
    assert.ok(list.some((p) => p.path === dirB && p.id === "other.id"));
    assert.ok(!list.some((p) => p.path === dirA));
  });

  it("reverse insertion order of stale record and valid renamed source resolves correctly", async () => {
    const dirLive = join(testBaseDir, "rev-live");
    const dirStale = join(testBaseDir, "rev-stale");
    mkdirSync(dirLive, { recursive: true });
    mkdirSync(dirStale, { recursive: true });

    createPkg(dirLive, "y.id", "Live Pkg");
    createPkg(dirStale, "x.id", "Stale Pkg");

    // 先 link Live(y)，后 link Stale(x)
    await linkPackage(dirLive, fakeHome);
    await linkPackage(dirStale, fakeHome);

    // 删除 Stale 目录
    rmSync(dirStale, { recursive: true, force: true });

    // Live 改名为 x.id
    const cfgPath = join(dirLive, "actiondock.json");
    const cfg = JSON.parse(readFileSync(cfgPath, "utf-8"));
    cfg.id = "x.id";
    writeFileSync(cfgPath, JSON.stringify(cfg, null, 2) + "\n");

    const list = listLinkedPackages(fakeHome);
    const item = list.find((p) => p.id === "x.id");
    assert.ok(item);
    assert.strictEqual(item.path, dirLive);
  });

  it("resolving by slug throws PACKAGE_ID_CONFLICT when current project and linked package share identical full ID", async () => {
    const dirCurrent = join(testBaseDir, "slug-curr");
    const dirLinked = join(testBaseDir, "slug-link");
    mkdirSync(dirCurrent, { recursive: true });
    mkdirSync(dirLinked, { recursive: true });

    createPkg(dirCurrent, "team.tools", "Current Tools");
    createPkg(dirLinked, "team.tools", "Linked Tools");

    await linkPackage(dirLinked, fakeHome);

    assert.throws(
      () => {
        resolvePackageRoot("tools", dirCurrent, fakeHome);
      },
      (err: any) => {
        assert.strictEqual(err.code, PACKAGE_ID_CONFLICT);
        return true;
      }
    );
  });

  it("unrelated global conflicts do not break direct parameterless resolve or explicit path lookup", async () => {
    const wsDir = join(testBaseDir, "unrelated-ws");
    const child1 = join(wsDir, "child1");
    mkdirSync(child1, { recursive: true });
    createPkg(child1, "unrelated.id", "Child 1");

    await linkPackage(wsDir, fakeHome);

    // 在工作区内新增同 ID 子包引入动态扫描冲突
    const child2 = join(wsDir, "child2");
    mkdirSync(child2, { recursive: true });
    createPkg(child2, "unrelated.id", "Child 2");

    // 独立当前包
    const currentDir = join(testBaseDir, "independent-curr");
    mkdirSync(currentDir, { recursive: true });
    createPkg(currentDir, "local.id", "Local Current");

    // 1. 无参数 resolvePackageRoot(undefined, currentDir, fakeHome) 返回 currentDir
    const resolvedSelf = resolvePackageRoot(undefined, currentDir, fakeHome);
    assert.strictEqual(resolvedSelf, currentDir);

    // 2. 显式物理路径 resolvePackageRoot(currentDir, testBaseDir, fakeHome) 返回 currentDir
    const resolvedPath = resolvePackageRoot(currentDir, testBaseDir, fakeHome);
    assert.strictEqual(resolvedPath, currentDir);

    // 3. 全局扫描 listLinkedPackages 仍因全局冲突抛错
    assert.throws(
      () => {
        listLinkedPackages(fakeHome);
      },
      (err: any) => {
        assert.strictEqual(err.code, PACKAGE_ID_CONFLICT);
        return true;
      }
    );
  });

  it("restricted doctor confirms live dependency after rename without false missing alarm or physical path leakage", async () => {
    const dirApp = join(testBaseDir, "dep-rename-app");
    const dirDep = join(testBaseDir, "dep-rename-dep");
    mkdirSync(dirApp, { recursive: true });
    mkdirSync(dirDep, { recursive: true });

    createPkg(dirApp, "app.main", "App Main");
    createPkg(dirDep, "dep.before", "Dep Lib");

    // app.main 使用 dep.after/ping
    const actDir = join(dirApp, "actions");
    mkdirSync(actDir, { recursive: true });
    writeFileSync(join(actDir, "call.ts"), "export default { run: () => ({}) };\n");
    const cfgAppPath = join(dirApp, "actiondock.json");
    const cfgApp = JSON.parse(readFileSync(cfgAppPath, "utf-8"));
    cfgApp.actions = {
      ping: {
        entry: "actions/call.ts",
        uses: ["dep.after/ping"],
      },
    };
    writeFileSync(cfgAppPath, JSON.stringify(cfgApp, null, 2) + "\n");

    await linkPackage(dirDep, fakeHome);

    // 将 dep 清单 ID 改为 dep.after（不重新 link）
    const cfgDepPath = join(dirDep, "actiondock.json");
    const cfgDep = JSON.parse(readFileSync(cfgDepPath, "utf-8"));
    cfgDep.id = "dep.after";
    writeFileSync(cfgDepPath, JSON.stringify(cfgDep, null, 2) + "\n");

    // 受限体检 app.main，白名单限制为 ['app.main']
    const report = await runDoctorChecks({
      cwd: dirApp,
      customHome: fakeHome,
      packageAllowlist: ["app.main"],
    });

    const usesCheck = report.checks.find((c) => c.id === "registry.uses_closure");
    assert.strictEqual(usesCheck?.status, "ok");
    assert.ok(!JSON.stringify(report).includes(dirDep));
  });

  it("new corrupted workspace child without cache triggers global doctor error while allowlist prevents path leakage", async () => {
    const wsDir = join(testBaseDir, "uncached-broken-ws");
    const childKnown = join(wsDir, "child-known");
    mkdirSync(childKnown, { recursive: true });
    createPkg(childKnown, "known.id", "Known Child");

    // 先 link 只有 known.id 的 workspace
    await linkPackage(wsDir, fakeHome);

    // 随后在工作区新建损坏子包（无缓存记录）
    const childBroken = join(wsDir, "child-broken");
    mkdirSync(childBroken, { recursive: true });
    writeFileSync(join(childBroken, "actiondock.json"), "{ invalid manifest json");

    // 全局 doctor 必须 ok: false，且包含 registry 类别错误
    const reportGlobal = await runDoctorChecks({
      cwd: fakeHome,
      customHome: fakeHome,
    });
    assert.strictEqual(reportGlobal.ok, false);
    const errCheck = reportGlobal.checks.find((c) => c.category === "registry" && c.status === "error");
    assert.ok(errCheck);

    // 白名单仅含 known.id 时，诊断报告严禁泄露损坏子包路径
    const reportLimited = await runDoctorChecks({
      cwd: fakeHome,
      customHome: fakeHome,
      packageAllowlist: ["known.id"],
    });
    assert.ok(!JSON.stringify(reportLimited).includes(childBroken));
  });

  it("HTTP doctor route confirms live dependency without false missing warning or path leakage under restricted allowlist", async () => {
    const { handleDoctorRoute } = await import("../src/server/routes/doctor");

    const dirApp = join(testBaseDir, "http-app");
    const dirDep = join(testBaseDir, "http-dep");
    mkdirSync(dirApp, { recursive: true });
    mkdirSync(dirDep, { recursive: true });

    createPkg(dirApp, "app.a", "App A");
    createPkg(dirDep, "dep.b", "Dep B");

    // app.a 动作 ping 声明 uses: ['dep.b/ping']
    const actDir = join(dirApp, "actions");
    mkdirSync(actDir, { recursive: true });
    writeFileSync(join(actDir, "ping.ts"), "export default { run: () => ({}) };\n");
    const cfgPath = join(dirApp, "actiondock.json");
    const cfg = JSON.parse(readFileSync(cfgPath, "utf-8"));
    cfg.actions = {
      ping: {
        entry: "actions/ping.ts",
        uses: ["dep.b/ping"],
      },
    };
    writeFileSync(cfgPath, JSON.stringify(cfg, null, 2) + "\n");

    // 挂载已链接依赖 dep.b
    await linkPackage(dirDep, fakeHome);

    const url = new URL("http://localhost/api/v2/doctor?package=app.a");
    const response = await handleDoctorRoute({
      req: new Request(url),
      url,
      pathname: url.pathname,
      corsHeaders: {},
      projectRoot: dirApp,
      customHome: fakeHome,
      service: {
        discovery: {
          listPackages: async () => [
            { id: "app.a", packageRoot: dirApp },
            { id: "dep.b", packageRoot: dirDep },
          ],
        },
      },
      options: {},
      activePolicy: { packageAllowlist: ["app.a"] },
    } as any);

    assert.ok(response);
    assert.strictEqual(response.status, 200);
    const body = (await response.json()) as any;
    assert.ok(body.report);
    const usesCheck = body.report.checks.find((c: any) => c.id === "registry.uses_closure");
    assert.strictEqual(usesCheck?.status, "ok");
    assert.ok(!JSON.stringify(body.report).includes(dirDep));
  });

  it("workspace link relative '.' does not prune unrelated standalone packages with undefined workspaceRoot", async () => {
    const outsideDir = join(testBaseDir, "outside-pkg");
    mkdirSync(outsideDir, { recursive: true });
    createPkg(outsideDir, "unique.id", "Unique Outside Package");
    await linkPackage(outsideDir, fakeHome);

    const wsDir = join(testBaseDir, "rel-ws");
    const childDir = join(wsDir, "child-pkg");
    mkdirSync(childDir, { recursive: true });
    createPkg(childDir, "child.id", "Child Package");

    const savedCwd = process.cwd();
    process.chdir(wsDir);
    try {
      await linkPackage(".", fakeHome);
    } finally {
      process.chdir(savedCwd);
    }

    const linked = listLinkedPackages(fakeHome);
    const outsideEntry = linked.find((p) => p.id === "unique.id");
    const childEntry = linked.find((p) => p.id === "child.id");
    assert.ok(outsideEntry, "outside package must not be pruned");
    assert.strictEqual(outsideEntry.path, outsideDir);
    assert.ok(childEntry, "child package must be linked");
    assert.strictEqual(childEntry.path, childDir);
  });

  it("corrupted workspace child remains in restricted allowlist doctor checks after unrelated standalone link", async () => {
    const wsDir = join(testBaseDir, "ws-with-broken");
    const childDir = join(wsDir, "child-broken");
    mkdirSync(childDir, { recursive: true });
    createPkg(childDir, "broken.id", "Broken Child");

    // 先正常 link 该工作区
    await linkPackage(wsDir, fakeHome);

    // 破坏子包 actiondock.json
    writeFileSync(join(childDir, "actiondock.json"), "{ invalid json");

    // 白名单 broken.id 诊断必须为 ok: false，且包含损坏子包路径
    const report1 = await runDoctorChecks({
      cwd: fakeHome,
      customHome: fakeHome,
      packageAllowlist: ["broken.id"],
    });
    assert.strictEqual(report1.ok, false);
    assert.ok(JSON.stringify(report1).includes(childDir));

    // link 无关 standalone 包
    const unrelatedDir = join(testBaseDir, "standalone-unrelated");
    mkdirSync(unrelatedDir, { recursive: true });
    createPkg(unrelatedDir, "unrelated.id", "Unrelated Standalone");
    await linkPackage(unrelatedDir, fakeHome);

    // 再次以同白名单执行 doctor，仍应为 ok: false 且包含损坏子包路径
    const report2 = await runDoctorChecks({
      cwd: fakeHome,
      customHome: fakeHome,
      packageAllowlist: ["broken.id"],
    });
    assert.strictEqual(report2.ok, false);
    assert.ok(JSON.stringify(report2).includes(childDir));
  });
});
