import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseActionRef } from "../src/catalog/resolve-action";
import { ActionDockError, INVALID_ACTION_REF } from "../src/errors";
import {
  DefaultActionCatalog,
  PackageGraphBuilder,
  resolveAction,
  resolvePlaybook,
} from "../src/catalog";
import { PackageDiscovery } from "../src/catalog/discovery";
import { DefaultPackageGraph } from "../src/catalog/graph";
import { linkPackage } from "../src/registry/registry";

describe("PackageDiscovery, PackageGraph, ActionCatalog, and resolveAction", () => {
  let tempHome: string;
  let pkgADir: string;
  let pkgBDir: string;
  let pkgCDir: string;

  beforeEach(() => {
    tempHome = mkdtempSync(join(tmpdir(), "ad-home-"));
    pkgADir = mkdtempSync(join(tmpdir(), "ad-pkg-a-"));
    pkgBDir = mkdtempSync(join(tmpdir(), "ad-pkg-b-"));
    pkgCDir = mkdtempSync(join(tmpdir(), "ad-pkg-c-"));

    // Package A (root) depends on Package B
    writeFileSync(
      join(pkgADir, "actiondock.json"),
      JSON.stringify(
        {
          id: "pkg-a",
          name: "Package A",
          version: "1.0.0",
          dependencies: {
            "pkg-b": "^1.0.0",
          },
          actions: {
            "greet": {
              description: "Greet from A",
              entry: "actions/greet.ts",
            },
            "shared": {
              description: "Shared action in A",
              entry: "actions/shared.ts",
            },
          },
          playbooks: {
            "flow-a": {
              entry: "playbooks/flow-a.md",
              description: "Flow in A",
              actions: ["greet"],
            },
          },
        },
        null,
        2
      )
    );
    mkdirSync(join(pkgADir, "playbooks"), { recursive: true });
    writeFileSync(join(pkgADir, "playbooks", "flow-a.md"), "# Flow A");

    // Package B depends on Package C
    writeFileSync(
      join(pkgBDir, "actiondock.json"),
      JSON.stringify(
        {
          id: "pkg-b",
          name: "Package B",
          version: "1.0.0",
          dependencies: {
            "pkg-c": "^1.0.0",
          },
          actions: {
            "helper": {
              description: "Helper in B",
              entry: "actions/helper.ts",
            },
            "shared": {
              description: "Shared action in B",
              entry: "actions/shared.ts",
            },
          },
          playbooks: {
            "flow-b": {
              entry: "playbooks/flow-b.md",
              description: "Flow in B",
              actions: ["helper"],
            },
          },
        },
        null,
        2
      )
    );
    mkdirSync(join(pkgBDir, "playbooks"), { recursive: true });
    writeFileSync(join(pkgBDir, "playbooks", "flow-b.md"), "# Flow B");

    // Package C (leaf)
    writeFileSync(
      join(pkgCDir, "actiondock.json"),
      JSON.stringify(
        {
          id: "pkg-c",
          name: "Package C",
          version: "1.0.0",
          actions: {
            "leaf": {
              description: "Leaf action in C",
              entry: "actions/leaf.ts",
            },
          },
        },
        null,
        2
      )
    );
  });

  afterEach(() => {
    rmSync(tempHome, { recursive: true, force: true });
    rmSync(pkgADir, { recursive: true, force: true });
    rmSync(pkgBDir, { recursive: true, force: true });
    rmSync(pkgCDir, { recursive: true, force: true });
  });

  describe("PackageDiscovery", () => {
    it("discovers current project and registered packages", async () => {
      await linkPackage(pkgBDir, tempHome);
      await linkPackage(pkgCDir, tempHome);

      const discovery = new PackageDiscovery({
        currentProjectRoot: pkgADir,
        customHome: tempHome,
      });

      const discovered = discovery.discoverSync();
      assert.strictEqual(discovered.length, 3);

      const rootPkg = discovered.find((p) => p.id === "pkg-a");
      assert.notStrictEqual(rootPkg, undefined);
      assert.strictEqual(rootPkg?.isCurrentProject, true);

      const bPkg = discovered.find((p) => p.id === "pkg-b");
      assert.notStrictEqual(bPkg, undefined);
      assert.strictEqual(bPkg?.isLinked, true);
    });

    it("detects PACKAGE_ID_CONFLICT when two distinct directories declare the same id", () => {
      const duplicateDir = mkdtempSync(join(tmpdir(), "ad-dup-"));
      try {
        writeFileSync(
          join(duplicateDir, "actiondock.json"),
          JSON.stringify({ id: "pkg-a", version: "2.0.0" })
        );

        const discovery = new PackageDiscovery({
          currentProjectRoot: pkgADir,
          packageRoots: [duplicateDir],
        });

        assert.throws(() => discovery.discoverSync(), /PACKAGE_ID_CONFLICT/);
      } finally {
        rmSync(duplicateDir, { recursive: true, force: true });
      }
    });
  });

  describe("PackageGraph & PackageGraphBuilder", () => {
    it("builds topology graph with direct and transitive dependencies", () => {
      const discovery = new PackageDiscovery({
        currentProjectRoot: pkgADir,
        packageRoots: [pkgBDir, pkgCDir],
      });
      const discovered = discovery.discoverSync();

      const builder = new PackageGraphBuilder({
        packages: discovered,
        root: pkgADir,
      });
      const graph = builder.buildSync();

      assert.strictEqual(graph.root?.id, "pkg-a");
      assert.strictEqual(graph.hasPackage("pkg-a"), true);
      assert.strictEqual(graph.hasPackage("pkg-b"), true);
      assert.strictEqual(graph.hasPackage("pkg-c"), true);

      const nodeA = graph.getPackage("pkg-a")!;
      assert.strictEqual(nodeA.directDependencies.has("pkg-b"), true);
      assert.strictEqual(nodeA.directDependencies.has("pkg-c"), false);
      assert.strictEqual(nodeA.transitiveDependencies.has("pkg-b"), true);
      assert.strictEqual(nodeA.transitiveDependencies.has("pkg-c"), true);

      const nodeB = graph.getPackage("pkg-b")!;
      assert.strictEqual(nodeB.directDependencies.has("pkg-c"), true);
      assert.strictEqual(nodeB.transitiveDependencies.has("pkg-c"), true);

      const nodeC = graph.getPackage("pkg-c")!;
      assert.strictEqual(nodeC.directDependencies.size, 0);
      assert.strictEqual(nodeC.transitiveDependencies.size, 0);
    });
  });

  describe("ActionCatalog", () => {
    it("indexes manifest actions and dynamically registered actions", () => {
      const discovery = new PackageDiscovery({
        currentProjectRoot: pkgADir,
        packageRoots: [pkgBDir, pkgCDir],
      });
      const graph = new PackageGraphBuilder({ packages: discovery.discoverSync() }).buildSync();

      const dynMap = new Map([["dynamicAction", { contract: { id: "dynamicAction" } }]]);
      const catalog = new DefaultActionCatalog(graph, (pkgId) =>
        pkgId === "pkg-a" ? (dynMap as any) : undefined
      );

      const greetCand = catalog.get("pkg-a", "greet");
      assert.notStrictEqual(greetCand, undefined);
      assert.strictEqual(greetCand?.actionId, "greet");

      const dynCand = catalog.get("pkg-a", "dynamicAction");
      assert.notStrictEqual(dynCand, undefined);
      assert.strictEqual(dynCand?.actionId, "dynamicAction");

      const listA = catalog.list("pkg-a");
      assert.ok((listA.map((c) => c.actionId)).includes("greet"));
      assert.ok((listA.map((c) => c.actionId)).includes("shared"));
      assert.ok((listA.map((c) => c.actionId)).includes("dynamicAction"));
    });

    it("does not index undeclared actions in disk actions directory", () => {
      const actionsDir = join(pkgADir, "actions");
      mkdirSync(actionsDir, { recursive: true });
      writeFileSync(join(actionsDir, "undeclared.ts"), "export default {};");

      const discovery = new PackageDiscovery({
        currentProjectRoot: pkgADir,
        packageRoots: [pkgBDir, pkgCDir],
      });
      const graph = new PackageGraphBuilder({ packages: discovery.discoverSync() }).buildSync();
      const catalog = new DefaultActionCatalog(graph);

      assert.strictEqual(catalog.get("pkg-a", "undeclared"), undefined);
      const listA = catalog.list("pkg-a");
      assert.strictEqual(listA.some((c) => c.actionId === "undeclared"), false);
    });
  });

  describe("resolveAction", () => {
    let graph: any;
    let catalog: any;

    beforeEach(() => {
      const discovery = new PackageDiscovery({
        currentProjectRoot: pkgADir,
        packageRoots: [pkgBDir, pkgCDir],
      });
      graph = new PackageGraphBuilder({ packages: discovery.discoverSync(), root: pkgADir }).buildSync();
      catalog = new DefaultActionCatalog(graph);
    });

    it("resolves scoped action reference directly", () => {
      const resolved = resolveAction("pkg-b/helper", { graph, catalog });
      assert.strictEqual(resolved.package.id, "pkg-b");
      assert.strictEqual(resolved.ref.actionId, "helper");
      assert.strictEqual(resolved.entry, "actions/helper.ts");
    });

    it("resolves short reference prioritizing caller package", () => {
      const resolved = resolveAction("shared", { graph, catalog, caller: "pkg-a" });
      assert.strictEqual(resolved.package.id, "pkg-a");
      assert.strictEqual(resolved.ref.actionId, "shared");

      const resolvedFromB = resolveAction("shared", { graph, catalog, caller: "pkg-b" });
      assert.strictEqual(resolvedFromB.package.id, "pkg-b");
    });

    it("resolves unique global short reference without caller", () => {
      const resolved = resolveAction("leaf", { graph, catalog });
      assert.strictEqual(resolved.package.id, "pkg-c");
      assert.strictEqual(resolved.ref.actionId, "leaf");
    });

    it("throws AMBIGUOUS_ACTION_REF when short reference matches multiple packages", () => {
      assert.throws(() => resolveAction("shared", { graph, catalog }), 
        /is ambiguous and provided by multiple packages/
      );
    });

    it("throws ACTION_NOT_FOUND when action does not exist", () => {
      assert.throws(() => resolveAction("nonexistent", { graph, catalog }), 
        /not found/
      );
    });

    it("throws PACKAGE_NOT_FOUND when package does not exist", () => {
      assert.throws(() => resolveAction("missing-pkg/action", { graph, catalog }), 
        /Package 'missing-pkg' not found/
      );
    });
  });

  describe("resolvePlaybook", () => {
    it("resolves scoped and unscoped playbooks across packages", () => {
      const discovery = new PackageDiscovery({
        currentProjectRoot: pkgADir,
        packageRoots: [pkgBDir],
      });
      const graph = new PackageGraphBuilder({ packages: discovery.discoverSync() }).buildSync();

      const pbA = resolvePlaybook("pkg-a/flow-a", { graph });
      assert.strictEqual(pbA.packageId, "pkg-a");
      assert.strictEqual(pbA.playbook.description, "Flow in A");

      const pbB = resolvePlaybook("flow-b", { graph });
      assert.strictEqual(pbB.packageId, "pkg-b");
      assert.strictEqual(pbB.playbook.description, "Flow in B");
    });
  });

  describe("parseActionRef", () => {
    it("parses valid action references correctly", () => {
      assert.deepStrictEqual(parseActionRef("greet"), { actionId: "greet" });
      assert.deepStrictEqual(parseActionRef("pkg-a/greet"), { packageId: "pkg-a", actionId: "greet" });
      assert.deepStrictEqual(parseActionRef({ actionId: "greet" }), { actionId: "greet" });
      assert.deepStrictEqual(parseActionRef({ packageId: "pkg-a", actionId: "greet" }), {
        packageId: "pkg-a",
        actionId: "greet",
      });
    });

    it("throws ActionDockError(INVALID_ACTION_REF) on invalid action references", () => {
      // Empty string
      try {
        parseActionRef("");
        assert.fail("不应到达此分支");
      } catch (err: any) {
        assert.ok(err instanceof ActionDockError);
        assert.strictEqual(err.code, INVALID_ACTION_REF);
      }

      // Missing actionId in object
      try {
        parseActionRef({ actionId: "" } as any);
        assert.fail("不应到达此分支");
      } catch (err: any) {
        assert.ok(err instanceof ActionDockError);
        assert.strictEqual(err.code, INVALID_ACTION_REF);
      }

      // Colon in reference
      try {
        parseActionRef("invalid:colon");
        assert.fail("不应到达此分支");
      } catch (err: any) {
        assert.ok(err instanceof ActionDockError);
        assert.strictEqual(err.code, INVALID_ACTION_REF);
      }

      // Invalid trailing slash
      try {
        parseActionRef("pkg/");
        assert.fail("不应到达此分支");
      } catch (err: any) {
        assert.ok(err instanceof ActionDockError);
        assert.strictEqual(err.code, INVALID_ACTION_REF);
      }

      // Invalid path traversal in actionId
      try {
        parseActionRef("pkg/..");
        assert.fail("不应到达此分支");
      } catch (err: any) {
        assert.ok(err instanceof ActionDockError);
        assert.strictEqual(err.code, INVALID_ACTION_REF);
      }
    });
  });
});
