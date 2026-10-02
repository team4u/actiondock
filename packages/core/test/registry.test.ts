import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { initProject } from "../src/project/init";
import {
  getRegistryStatus,
  linkPackage,
  listLinkedPackages,
  pruneRegistry,
  unlinkPackage,
  resolvePackageRoot,
} from "../src/registry";
import {
  DefaultActionCatalog,
  PackageGraphBuilder,
  resolveAction,
  resolvePlaybook,
} from "../src/catalog";
import { PackageDiscovery } from "../src/catalog/discovery";
import { getRegistryFilePath, loadRegistry } from "../src/registry/registry";

describe("Registry and Linking Mechanism", () => {
  let fakeHome: string;
  let pkgADir: string;
  let pkgBDir: string;

  beforeEach(() => {
    fakeHome = mkdtempSync(join(tmpdir(), "actiondock-home-"));
    pkgADir = mkdtempSync(join(tmpdir(), "pkg-a-"));
    pkgBDir = mkdtempSync(join(tmpdir(), "pkg-b-"));

    const rootNodeModules = resolve(import.meta.dirname, "../../../node_modules");
    if (existsSync(rootNodeModules)) {
      symlinkSync(rootNodeModules, join(pkgADir, "node_modules"), "junction");
      symlinkSync(rootNodeModules, join(pkgBDir, "node_modules"), "junction");
    }

    // Init Package A with action 'common.action' and 'unique.a'
    initProject(pkgADir, {
      id: "team.pkg-a",
      name: "Package A",
    });

    const actionAContent = `
import { defineAction } from "@actiondock/sdk";
export default defineAction(async () => ({ pkg: "A" }));
`;
    writeFileSync(join(pkgADir, "actions", "common.ts"), actionAContent);

    const cfgAPath = join(pkgADir, "actiondock.json");
    const cfgA = JSON.parse(readFileSync(cfgAPath, "utf-8"));
    cfgA.actions = {
      "common.action": {
        entry: "actions/common.ts",
      },
    };
    cfgA.playbooks = {
      "common-sop": {
        entry: "playbooks/common-sop.md",
        description: "Common SOP in A",
        actions: ["common.action"],
      },
      "unique-a-sop": {
        entry: "playbooks/unique-a-sop.md",
        description: "Unique SOP in A",
        actions: ["common.action"],
      },
    };
    writeFileSync(cfgAPath, JSON.stringify(cfgA, null, 2) + "\n");

    mkdirSync(join(pkgADir, "playbooks"), { recursive: true });
    writeFileSync(
      join(pkgADir, "playbooks", "common-sop.md"),
      "# Common SOP A"
    );
    writeFileSync(
      join(pkgADir, "playbooks", "unique-a-sop.md"),
      "# Unique SOP A"
    );

    // Init Package B with action 'common.action' and 'unique.b'
    initProject(pkgBDir, {
      id: "team.pkg-b",
      name: "Package B",
    });

    const actionBContent = `
import { defineAction } from "@actiondock/sdk";
export default defineAction(async () => ({ pkg: "B" }));
`;
    writeFileSync(join(pkgBDir, "actions", "common.ts"), actionBContent);

    const actionUniqueBContent = `
import { defineAction } from "@actiondock/sdk";
export default defineAction(async () => ({ pkg: "B-unique" }));
`;
    writeFileSync(join(pkgBDir, "actions", "unique-b.ts"), actionUniqueBContent);

    const cfgBPath = join(pkgBDir, "actiondock.json");
    const cfgB = JSON.parse(readFileSync(cfgBPath, "utf-8"));
    cfgB.actions = {
      "common.action": {
        entry: "actions/common.ts",
      },
      "unique.b": {
        entry: "actions/unique-b.ts",
      },
    };
    cfgB.playbooks = {
      "common-sop": {
        entry: "playbooks/common-sop.md",
        description: "Common SOP in B",
        actions: ["common.action"],
      },
      "unique-b-sop": {
        entry: "playbooks/unique-b-sop.md",
        description: "Unique SOP in B",
        actions: ["unique.b"],
      },
    };
    writeFileSync(cfgBPath, JSON.stringify(cfgB, null, 2) + "\n");

    mkdirSync(join(pkgBDir, "playbooks"), { recursive: true });
    writeFileSync(
      join(pkgBDir, "playbooks", "common-sop.md"),
      "# Common SOP B"
    );
    writeFileSync(
      join(pkgBDir, "playbooks", "unique-b-sop.md"),
      "# Unique SOP B"
    );
  });

  afterEach(() => {
    rmSync(fakeHome, { recursive: true, force: true });
    rmSync(pkgADir, { recursive: true, force: true });
    rmSync(pkgBDir, { recursive: true, force: true });
  });

  it("links, lists, and unlinks packages in global registry", async () => {
    // 1. Link pkg A
    const entryA = await linkPackage(pkgADir, fakeHome);
    assert.strictEqual(entryA.id, "team.pkg-a");
    assert.strictEqual(entryA.path, pkgADir);

    // 2. Link pkg B
    const entryB = await linkPackage(pkgBDir, fakeHome);
    assert.strictEqual(entryB.id, "team.pkg-b");

    // 3. List
    const list = listLinkedPackages(fakeHome);
    assert.strictEqual(list.length, 2);
    assert.ok((list.map((p) => p.id)).includes("team.pkg-a"));
    assert.ok((list.map((p) => p.id)).includes("team.pkg-b"));

    // 4. Unlink
    const unlinked = await unlinkPackage("team.pkg-a", fakeHome);
    assert.strictEqual(unlinked?.id, "team.pkg-a");

    const afterList = listLinkedPackages(fakeHome);
    assert.strictEqual(afterList.length, 1);
    assert.strictEqual(afterList[0].id, "team.pkg-b");
  });

  it("resolves action from current project first", async () => {
    await linkPackage(pkgBDir, fakeHome);

    const discovery = new PackageDiscovery({ currentProjectRoot: pkgADir, customHome: fakeHome });
    const graph = new PackageGraphBuilder({ packages: discovery.discoverSync(), root: pkgADir }).buildSync();
    const catalog = new DefaultActionCatalog(graph);

    // When running inside pkgADir, resolving common.action should resolve to pkg A
    const res = resolveAction("common.action", { graph, catalog, caller: "team.pkg-a" });
    assert.strictEqual(res.package.id, "team.pkg-a");
    assert.strictEqual(graph.packages.get(res.package.id)?.root, pkgADir);
  });

  it("resolves unique action from linked packages when outside of project", async () => {
    await linkPackage(pkgBDir, fakeHome);

    const discovery = new PackageDiscovery({ customHome: fakeHome });
    const graph = new PackageGraphBuilder({ packages: discovery.discoverSync() }).buildSync();
    const catalog = new DefaultActionCatalog(graph);

    const res = resolveAction("unique.b", { graph, catalog });
    assert.strictEqual(res.package.id, "team.pkg-b");
    assert.strictEqual(graph.packages.get(res.package.id)?.root, pkgBDir);
  });

  it("detects conflict and allows scoped package resolution", async () => {
    await linkPackage(pkgADir, fakeHome);
    await linkPackage(pkgBDir, fakeHome);

    const discovery = new PackageDiscovery({ customHome: fakeHome });
    const graph = new PackageGraphBuilder({ packages: discovery.discoverSync() }).buildSync();
    const catalog = new DefaultActionCatalog(graph);

    // Unscoped common.action should throw error because both A and B provide it
    assert.throws(() =>
      resolveAction("common.action", { graph, catalog }), /ambiguous/i);

    // Scoped package specification should resolve cleanly
    const resA = resolveAction("team.pkg-a/common.action", { graph, catalog });
    assert.strictEqual(resA.package.id, "team.pkg-a");

    const resB = resolveAction("team.pkg-b/common.action", { graph, catalog });
    assert.strictEqual(resB.package.id, "team.pkg-b");
  });

  it("resolves playbook from current project and linked packages", async () => {
    await linkPackage(pkgADir, fakeHome);
    await linkPackage(pkgBDir, fakeHome);

    const discovery = new PackageDiscovery({ currentProjectRoot: pkgADir, customHome: fakeHome });
    const graph = new PackageGraphBuilder({ packages: discovery.discoverSync(), root: pkgADir }).buildSync();

    // 1. Inside pkgADir
    const localRes = resolvePlaybook("common-sop", { graph, caller: "team.pkg-a" });
    assert.strictEqual(localRes.packageId, "team.pkg-a");
    assert.strictEqual(localRes.playbook.description, "Common SOP in A");

    // 2. Outside project: unique playbook
    const outsideDiscovery = new PackageDiscovery({ customHome: fakeHome });
    const outsideGraph = new PackageGraphBuilder({ packages: outsideDiscovery.discoverSync() }).buildSync();
    const uniqueRes = resolvePlaybook("unique-b-sop", { graph: outsideGraph });
    assert.strictEqual(uniqueRes.packageId, "team.pkg-b");
    assert.strictEqual(uniqueRes.playbook.id, "unique-b-sop");

    // 3. Outside project: conflicting playbook throws
    assert.throws(() =>
      resolvePlaybook("common-sop", { graph: outsideGraph }), /provided by multiple linked packages/);

    // 4. Outside project: scoped playbook resolves cleanly
    const scopedRes = resolvePlaybook("team.pkg-a/common-sop", { graph: outsideGraph });
    assert.strictEqual(scopedRes.packageId, "team.pkg-a");
    assert.strictEqual(scopedRes.playbook.id, "common-sop");
  });

  it("links workspace directory and auto-discovers subprojects", async () => {
    // Create a workspace root containing pkg-sub1 and pkg-sub2
    const wsDir = mkdtempSync(join(tmpdir(), "ws-root-"));
    const sub1 = join(wsDir, "packages", "sub1");
    const sub2 = join(wsDir, "packages", "sub2");

    initProject(sub1, { id: "team.sub-1", name: "Sub 1" });
    initProject(sub2, { id: "team.sub-2", name: "Sub 2" });

    // Link the workspace root (which does NOT have actiondock.json itself)
    const result = await linkPackage(wsDir, fakeHome);
    assert.strictEqual(result.isWorkspace, true);
    assert.strictEqual(result.entries.length, 2);
    assert.ok((result.entries.map((e) => e.id)).includes("team.sub-1"));
    assert.ok((result.entries.map((e) => e.id)).includes("team.sub-2"));

    // listLinkedPackages should list both
    const linked = listLinkedPackages(fakeHome);
    assert.ok((linked.map((p) => p.id)).includes("team.sub-1"));
    assert.ok((linked.map((p) => p.id)).includes("team.sub-2"));

    // Unlink workspace
    const unlinked = await unlinkPackage(wsDir, fakeHome);
    assert.strictEqual(unlinked?.type, "workspace");
    assert.strictEqual(unlinked?.packagesCount, 2);

    const afterUnlink = listLinkedPackages(fakeHome);
    assert.strictEqual(afterUnlink.find((p) => p.id === "team.sub-1"), undefined);
    assert.strictEqual(afterUnlink.find((p) => p.id === "team.sub-2"), undefined);

    rmSync(wsDir, { recursive: true, force: true });
  });

  it("dynamically discovers newly added subprojects in linked workspace without re-linking", async () => {
    const rootNodeModules = resolve(import.meta.dirname, "../../../node_modules");

    // 1. Create workspace with initial sub1
    const wsDir = mkdtempSync(join(tmpdir(), "ws-dynamic-"));
    const sub1 = join(wsDir, "tools", "sub1");
    initProject(sub1, { id: "team.dyn-1", name: "Dynamic Sub 1" });
    if (existsSync(rootNodeModules)) {
      symlinkSync(rootNodeModules, join(sub1, "node_modules"), "junction");
    }

    const action1Content = `
import { defineAction } from "@actiondock/sdk";
export default defineAction(async () => ({ ok: true }));
`;
    writeFileSync(join(sub1, "actions", "dyn1.ts"), action1Content);

    const cfg1Path = join(sub1, "actiondock.json");
    const cfg1 = JSON.parse(readFileSync(cfg1Path, "utf-8"));
    cfg1.actions = { "dyn.action1": { entry: "actions/dyn1.ts" } };
    writeFileSync(cfg1Path, JSON.stringify(cfg1, null, 2) + "\n");

    // 2. Link workspace
    const res = await linkPackage(wsDir, fakeHome);
    assert.strictEqual(res.isWorkspace, true);
    assert.strictEqual(res.entries.length, 1);

    // 3. Add sub2 into workspace WITHOUT calling linkPackage again (simulating git pull / new package)
    const sub2 = join(wsDir, "tools", "sub2");
    initProject(sub2, { id: "team.dyn-2", name: "Dynamic Sub 2" });
    if (existsSync(rootNodeModules)) {
      symlinkSync(rootNodeModules, join(sub2, "node_modules"), "junction");
    }

    const action2Content = `
import { defineAction } from "@actiondock/sdk";
export default defineAction(async () => ({ fromDyn2: true }));
`;
    writeFileSync(join(sub2, "actions", "dyn2.ts"), action2Content);

    const cfg2Path = join(sub2, "actiondock.json");
    const cfg2 = JSON.parse(readFileSync(cfg2Path, "utf-8"));
    cfg2.actions = { "dyn.action2": { entry: "actions/dyn2.ts" } };
    writeFileSync(cfg2Path, JSON.stringify(cfg2, null, 2) + "\n");

    // 4. listLinkedPackages should automatically include newly added sub2!
    const allLinked = listLinkedPackages(fakeHome);
    assert.ok((allLinked.map((p) => p.id)).includes("team.dyn-1"));
    assert.ok((allLinked.map((p) => p.id)).includes("team.dyn-2"));

    // 5. resolveAction should seamlessly resolve action from newly added sub2!
    const wsDiscovery = new PackageDiscovery({ customHome: fakeHome });
    const wsGraph = new PackageGraphBuilder({ packages: wsDiscovery.discoverSync() }).buildSync();
    const wsCatalog = new DefaultActionCatalog(wsGraph);
    const resolved = resolveAction("dyn.action2", { graph: wsGraph, catalog: wsCatalog });
    assert.strictEqual(resolved.package.id, "team.dyn-2");
    assert.strictEqual(wsGraph.packages.get(resolved.package.id)?.root, sub2);
    assert.strictEqual(resolved.ref.actionId, "dyn.action2");

    rmSync(wsDir, { recursive: true, force: true });
  });

  it("unlink workspace 时兄弟目录前缀的包记录不被误删", async () => {
    // 构造两个同前缀的 workspace 目录：ws-sibling-xxx 与 ws-sibling-xxx-extra（裸 startsWith 会误删后者）
    const wsDirA = mkdtempSync(join(tmpdir(), "ws-sibling-"));
    const wsDirB = wsDirA + "-extra";
    mkdirSync(wsDirB, { recursive: true });

    const subA = join(wsDirA, "packages", "sub-a");
    const subB = join(wsDirB, "packages", "sub-b");
    initProject(subA, { id: "team.sibling-a", name: "Sibling A" });
    initProject(subB, { id: "team.sibling-b", name: "Sibling B" });

    try {
      await linkPackage(wsDirA, fakeHome);
      await linkPackage(wsDirB, fakeHome);

      const beforeList = listLinkedPackages(fakeHome);
      assert.ok((beforeList.map((p) => p.id)).includes("team.sibling-a"));
      assert.ok((beforeList.map((p) => p.id)).includes("team.sibling-b"));

      // 仅解除 wsDirA：wsDirB 与其子包必须完整保留
      const unlinked = await unlinkPackage(wsDirA, fakeHome);
      assert.strictEqual(unlinked?.type, "workspace");
      assert.strictEqual(unlinked?.packagesCount, 1);

      const afterList = listLinkedPackages(fakeHome);
      assert.strictEqual(afterList.find((p) => p.id === "team.sibling-a"), undefined);
      assert.notStrictEqual(afterList.find((p) => p.id === "team.sibling-b"), undefined);

      // 通过目录别名解除时同样不得误删兄弟目录下的包记录
      await linkPackage(wsDirA, fakeHome);
      const aliasUnlinked = await unlinkPackage(basename(wsDirB), fakeHome);
      assert.strictEqual(aliasUnlinked?.type, "workspace");
      const finalList = listLinkedPackages(fakeHome);
      assert.notStrictEqual(finalList.find((p) => p.id === "team.sibling-a"), undefined);
      assert.strictEqual(finalList.find((p) => p.id === "team.sibling-b"), undefined);
    } finally {
      rmSync(wsDirA, { recursive: true, force: true });
      rmSync(wsDirB, { recursive: true, force: true });
    }
  });

  it("reports registry status and prunes stale links", async () => {
    // 1. Link a valid package A
    await linkPackage(pkgADir, fakeHome);

    // 2. Link a temporary package that will be deleted
    const tempDir = mkdtempSync(join(tmpdir(), "temp-stale-"));
    initProject(tempDir, { id: "team.will-delete", name: "Will Delete" });
    await linkPackage(tempDir, fakeHome);

    // Delete tempDir to simulate stale link
    rmSync(tempDir, { recursive: true, force: true });

    // 3. getRegistryStatus should detect 1 active and 1 stale
    const statusBefore = getRegistryStatus(fakeHome);
    assert.strictEqual(statusBefore.staleCount, 1);
    assert.strictEqual(statusBefore.packages.some((p: any) => p.id === "team.pkg-a" && p.status === "active"), true);
    assert.strictEqual(statusBefore.packages.some((p: any) => p.id === "team.will-delete" && p.status === "stale"), true);

    // 4. pruneRegistry should remove the stale entry
    const pruneRes = await pruneRegistry(fakeHome);
    assert.strictEqual(pruneRes.prunedPackages.length, 1);
    assert.strictEqual(pruneRes.prunedPackages[0].id, "team.will-delete");

    // 5. getRegistryStatus after prune should have 0 stale
    const statusAfter = getRegistryStatus(fakeHome);
    assert.strictEqual(statusAfter.staleCount, 0);
    assert.strictEqual(statusAfter.packages.length, 1);
    assert.strictEqual(statusAfter.packages[0].id, "team.pkg-a");
  });

  it("resolves scoped package IDs, package root, and playbooks (@scope/pkg)", async () => {
    const scopedDir = mkdtempSync(join(tmpdir(), "scoped-pkg-"));
    const rootNodeModules = resolve(import.meta.dirname, "../../../node_modules");
    if (existsSync(rootNodeModules)) {
      symlinkSync(rootNodeModules, join(scopedDir, "node_modules"), "junction");
    }
    try {
      initProject(scopedDir, { id: "@team/tools", name: "Scoped Tools" });
      const actionContent = `
import { defineAction } from "@actiondock/sdk";
export default defineAction({
  id: "greet",
  run() { return "hello"; }
});
`;
      writeFileSync(join(scopedDir, "actions", "greet.ts"), actionContent);
      const scopedCfgPath = join(scopedDir, "actiondock.json");
      const scopedCfg = JSON.parse(readFileSync(scopedCfgPath, "utf-8"));
      scopedCfg.actions = {
        greet: {
          entry: "actions/greet.ts",
          description: "Scoped Greet Action",
        },
      };
      scopedCfg.playbooks = {
        deploy: {
          entry: "playbooks/deploy.md",
          description: "Scoped Deploy Playbook",
          actions: ["greet"],
        },
      };
      writeFileSync(scopedCfgPath, JSON.stringify(scopedCfg, null, 2) + "\n");

      writeFileSync(
        join(scopedDir, "playbooks", "deploy.md"),
        `# Scoped Deploy Playbook\nRun greet\n`
      );

      await linkPackage(scopedDir, fakeHome);

      // 1. resolvePackageRoot should resolve @team/tools without being treated as an invalid explicit file path
      const root = resolvePackageRoot("@team/tools", fakeHome, fakeHome);
      assert.strictEqual(root, scopedDir);

      const scopedDiscovery = new PackageDiscovery({ customHome: fakeHome });
      const scopedGraph = new PackageGraphBuilder({ packages: scopedDiscovery.discoverSync() }).buildSync();
      const scopedCatalog = new DefaultActionCatalog(scopedGraph);

      // 2. resolvePlaybook should resolve @team/tools/deploy correctly using lastIndexOf
      const pbRes = resolvePlaybook("@team/tools/deploy", { graph: scopedGraph });
      assert.strictEqual(pbRes.packageId, "@team/tools");
      assert.strictEqual(pbRes.playbookId, "deploy");
      assert.strictEqual(pbRes.playbook.description, "Scoped Deploy Playbook");
      assert.strictEqual(pbRes.projectRoot, scopedDir);

      // 3. resolveAction should resolve @team/tools/greet
      const actRes = resolveAction("@team/tools/greet", { graph: scopedGraph, catalog: scopedCatalog });
      assert.strictEqual(actRes.package.id, "@team/tools");
      assert.strictEqual(actRes.ref.actionId, "greet");
      assert.strictEqual(scopedGraph.packages.get(actRes.package.id)?.root, scopedDir);
    } finally {
      rmSync(scopedDir, { recursive: true, force: true });
    }
  });

  it("prioritizes current project over global registry when target package ID matches current project", async () => {
    // Simulate an old linked copy in global registry
    const oldDir = mkdtempSync(join(tmpdir(), "old-pkg-"));
    const currentDir = mkdtempSync(join(tmpdir(), "current-pkg-"));
    const rootNodeModules = resolve(import.meta.dirname, "../../../node_modules");
    if (existsSync(rootNodeModules)) {
      symlinkSync(rootNodeModules, join(oldDir, "node_modules"), "junction");
      symlinkSync(rootNodeModules, join(currentDir, "node_modules"), "junction");
    }
    try {
      initProject(oldDir, { id: "team.shared", name: "Old Copy" });
      initProject(currentDir, { id: "team.shared", name: "Current Working Copy" });

      const oldCfgPath = join(oldDir, "actiondock.json");
      const oldCfg = JSON.parse(readFileSync(oldCfgPath, "utf-8"));
      oldCfg.actions = {
        echo: {
          entry: "actions/echo.ts",
          description: "Old Echo Action",
        },
      };
      oldCfg.playbooks = {
        sop: {
          entry: "playbooks/sop.md",
          description: "Old SOP",
        },
      };
      writeFileSync(oldCfgPath, JSON.stringify(oldCfg, null, 2) + "\n");

      const curCfgPath = join(currentDir, "actiondock.json");
      const curCfg = JSON.parse(readFileSync(curCfgPath, "utf-8"));
      curCfg.actions = {
        echo: {
          entry: "actions/echo.ts",
          description: "Current Echo Action",
        },
      };
      curCfg.playbooks = {
        sop: {
          entry: "playbooks/sop.md",
          description: "Current SOP",
        },
      };
      writeFileSync(curCfgPath, JSON.stringify(curCfg, null, 2) + "\n");

      writeFileSync(
        join(oldDir, "actions", "echo.ts"),
        `import { defineAction } from "@actiondock/sdk"; export default defineAction({ id: "echo", run: () => "old" });`
      );
      writeFileSync(
        join(currentDir, "actions", "echo.ts"),
        `import { defineAction } from "@actiondock/sdk"; export default defineAction({ id: "echo", run: () => "current" });`
      );
      writeFileSync(
        join(oldDir, "playbooks", "sop.md"),
        `# Old SOP\n`
      );
      writeFileSync(
        join(currentDir, "playbooks", "sop.md"),
        `# Current SOP\n`
      );

      // Link the old directory in registry
      await linkPackage(oldDir, fakeHome);

      // When executing inside currentDir:
      // 1. resolvePackageRoot should return currentDir, NOT oldDir
      assert.strictEqual(resolvePackageRoot("team.shared", currentDir, fakeHome), currentDir);

      const prioDiscovery = new PackageDiscovery({ currentProjectRoot: currentDir, customHome: fakeHome });
      const prioGraph = new PackageGraphBuilder({ packages: prioDiscovery.discoverSync(), root: currentDir }).buildSync();
      const prioCatalog = new DefaultActionCatalog(prioGraph);

      // 2. resolveAction should resolve from currentDir
      const syncAct = resolveAction("team.shared/echo", { graph: prioGraph, catalog: prioCatalog });
      assert.strictEqual(prioGraph.packages.get(syncAct.package.id)?.root, currentDir);

      // 3. resolvePlaybook should resolve from currentDir
      const pbRes = resolvePlaybook("team.shared/sop", { graph: prioGraph });
      assert.strictEqual(pbRes.projectRoot, currentDir);
      assert.strictEqual(pbRes.playbook.description, "Current SOP");
    } finally {
      rmSync(oldDir, { recursive: true, force: true });
      rmSync(currentDir, { recursive: true, force: true });
    }
  });

  it("manages links and migrates legacy schemaVersion 1 formats seamlessly", async () => {
    // 1. Link packages using standard link
    await linkPackage(pkgADir, fakeHome);
    await linkPackage(pkgBDir, fakeHome);

    // 2. List packages
    const list = listLinkedPackages(fakeHome);
    assert.strictEqual(list.length, 2);
    assert.strictEqual(list.some((l) => l.path === pkgADir), true);
    assert.strictEqual(list.some((l) => l.path === pkgBDir), true);

    // 3. Unlink package
    await unlinkPackage("team.pkg-a", fakeHome);
    const updatedList = listLinkedPackages(fakeHome);
    assert.strictEqual(updatedList.length, 1);
    assert.strictEqual(updatedList[0].path, pkgBDir);

    // 4. Test raw migration when registry file contains ONLY schemaVersion 1 links
    const filePath = getRegistryFilePath(fakeHome);
    writeFileSync(
      filePath,
      JSON.stringify({
        schemaVersion: 1,
        links: [{ type: "package", path: pkgADir, linkedAt: new Date().toISOString() }],
      }),
      "utf-8"
    );

    const migrated = loadRegistry(fakeHome);
    assert.notStrictEqual(migrated.packages["team.pkg-a"], undefined);
    assert.strictEqual(migrated.packages["team.pkg-a"].path, pkgADir);
  });
});

