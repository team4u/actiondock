import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseActionRef } from "../src/catalog/resolve-action";
import {
  DefaultActionCatalog,
  PackageDiscovery,
  PackageGraphBuilder,
  resolveAction,
  resolvePlaybook,
} from "../src";
import { DefaultPackageGraph } from "../src/catalog/graph";
import { DefaultRegistryStore } from "../src/registry/store";

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
      const store = new DefaultRegistryStore(tempHome);
      await store.link(pkgBDir);
      await store.link(pkgCDir);

      const discovery = new PackageDiscovery({
        currentProjectRoot: pkgADir,
        customHome: tempHome,
      });

      const discovered = discovery.discoverSync();
      expect(discovered.length).toBe(3);

      const rootPkg = discovered.find((p) => p.id === "pkg-a");
      expect(rootPkg).toBeDefined();
      expect(rootPkg?.isCurrentProject).toBe(true);

      const bPkg = discovered.find((p) => p.id === "pkg-b");
      expect(bPkg).toBeDefined();
      expect(bPkg?.isLinked).toBe(true);
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

        expect(() => discovery.discoverSync()).toThrow(/PACKAGE_ID_CONFLICT/);
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

      expect(graph.root?.id).toBe("pkg-a");
      expect(graph.hasPackage("pkg-a")).toBe(true);
      expect(graph.hasPackage("pkg-b")).toBe(true);
      expect(graph.hasPackage("pkg-c")).toBe(true);

      const nodeA = graph.getPackage("pkg-a")!;
      expect(nodeA.directDependencies.has("pkg-b")).toBe(true);
      expect(nodeA.directDependencies.has("pkg-c")).toBe(false);
      expect(nodeA.transitiveDependencies.has("pkg-b")).toBe(true);
      expect(nodeA.transitiveDependencies.has("pkg-c")).toBe(true);

      const nodeB = graph.getPackage("pkg-b")!;
      expect(nodeB.directDependencies.has("pkg-c")).toBe(true);
      expect(nodeB.transitiveDependencies.has("pkg-c")).toBe(true);

      const nodeC = graph.getPackage("pkg-c")!;
      expect(nodeC.directDependencies.size).toBe(0);
      expect(nodeC.transitiveDependencies.size).toBe(0);
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
      expect(greetCand).toBeDefined();
      expect(greetCand?.actionId).toBe("greet");

      const dynCand = catalog.get("pkg-a", "dynamicAction");
      expect(dynCand).toBeDefined();
      expect(dynCand?.actionId).toBe("dynamicAction");

      const listA = catalog.list("pkg-a");
      expect(listA.map((c) => c.actionId)).toContain("greet");
      expect(listA.map((c) => c.actionId)).toContain("shared");
      expect(listA.map((c) => c.actionId)).toContain("dynamicAction");
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
      expect(resolved.package.id).toBe("pkg-b");
      expect(resolved.ref.actionId).toBe("helper");
      expect(resolved.entry).toBe("actions/helper.ts");
    });

    it("resolves short reference prioritizing caller package", () => {
      const resolved = resolveAction("shared", { graph, catalog, caller: "pkg-a" });
      expect(resolved.package.id).toBe("pkg-a");
      expect(resolved.ref.actionId).toBe("shared");

      const resolvedFromB = resolveAction("shared", { graph, catalog, caller: "pkg-b" });
      expect(resolvedFromB.package.id).toBe("pkg-b");
    });

    it("resolves unique global short reference without caller", () => {
      const resolved = resolveAction("leaf", { graph, catalog });
      expect(resolved.package.id).toBe("pkg-c");
      expect(resolved.ref.actionId).toBe("leaf");
    });

    it("throws AMBIGUOUS_ACTION_REF when short reference matches multiple packages", () => {
      expect(() => resolveAction("shared", { graph, catalog })).toThrow(
        /is ambiguous and provided by multiple packages/
      );
    });

    it("throws ACTION_NOT_FOUND when action does not exist", () => {
      expect(() => resolveAction("nonexistent", { graph, catalog })).toThrow(
        /not found/
      );
    });

    it("throws PACKAGE_NOT_FOUND when package does not exist", () => {
      expect(() => resolveAction("missing-pkg/action", { graph, catalog })).toThrow(
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
      expect(pbA.packageId).toBe("pkg-a");
      expect(pbA.playbook.description).toBe("Flow in A");

      const pbB = resolvePlaybook("flow-b", { graph });
      expect(pbB.packageId).toBe("pkg-b");
      expect(pbB.playbook.description).toBe("Flow in B");
    });
  });
});
