import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { initProject } from "../src/project/init";
import {
  getRegistryStatus,
  linkPackage,
  listLinkedPackages,
  loadRegistry,
  pruneRegistry,
  resolveActionProject,
  resolvePlaybookProject,
  unlinkPackage,
} from "../src/registry";

describe("Registry and Linking Mechanism", () => {
  let fakeHome: string;
  let pkgADir: string;
  let pkgBDir: string;

  beforeEach(() => {
    fakeHome = mkdtempSync(join(tmpdir(), "actiondock-home-"));
    pkgADir = mkdtempSync(join(tmpdir(), "pkg-a-"));
    pkgBDir = mkdtempSync(join(tmpdir(), "pkg-b-"));

    const rootNodeModules = resolve(__dirname, "../../../node_modules");
    if (existsSync(rootNodeModules)) {
      symlinkSync(rootNodeModules, join(pkgADir, "node_modules"), "dir");
      symlinkSync(rootNodeModules, join(pkgBDir, "node_modules"), "dir");
    }

    // Init Package A with action 'common.action' and 'unique.a'
    initProject(pkgADir, {
      id: "team.pkg-a",
      name: "Package A",
    });

    const actionAContent = `
import { defineAction } from "@actiondock/sdk";
export default defineAction({
  id: "common.action",
  inputSchema: { type: "object" },
  async run() { return { pkg: "A" }; }
});
`;
    writeFileSync(join(pkgADir, "actions", "common.ts"), actionAContent);

    mkdirSync(join(pkgADir, "playbooks"), { recursive: true });
    writeFileSync(
      join(pkgADir, "playbooks", "common-sop.md"),
      "---\nid: common-sop\ndescription: Common SOP in A\nactions:\n  - common.action\n---\n# Common SOP A"
    );
    writeFileSync(
      join(pkgADir, "playbooks", "unique-a-sop.md"),
      "---\nid: unique-a-sop\ndescription: Unique SOP in A\nactions:\n  - common.action\n---\n# Unique SOP A"
    );

    // Init Package B with action 'common.action' and 'unique.b'
    initProject(pkgBDir, {
      id: "team.pkg-b",
      name: "Package B",
    });

    const actionBContent = `
import { defineAction } from "@actiondock/sdk";
export default defineAction({
  id: "common.action",
  inputSchema: { type: "object" },
  async run() { return { pkg: "B" }; }
});
`;
    writeFileSync(join(pkgBDir, "actions", "common.ts"), actionBContent);

    const actionUniqueBContent = `
import { defineAction } from "@actiondock/sdk";
export default defineAction({
  id: "unique.b",
  inputSchema: { type: "object" },
  async run() { return { pkg: "B-unique" }; }
});
`;
    writeFileSync(join(pkgBDir, "actions", "unique-b.ts"), actionUniqueBContent);

    mkdirSync(join(pkgBDir, "playbooks"), { recursive: true });
    writeFileSync(
      join(pkgBDir, "playbooks", "common-sop.md"),
      "---\nid: common-sop\ndescription: Common SOP in B\nactions:\n  - common.action\n---\n# Common SOP B"
    );
    writeFileSync(
      join(pkgBDir, "playbooks", "unique-b-sop.md"),
      "---\nid: unique-b-sop\ndescription: Unique SOP in B\nactions:\n  - unique.b\n---\n# Unique SOP B"
    );
  });

  afterEach(() => {
    rmSync(fakeHome, { recursive: true, force: true });
    rmSync(pkgADir, { recursive: true, force: true });
    rmSync(pkgBDir, { recursive: true, force: true });
  });

  it("links, lists, and unlinks packages in global registry", () => {
    // 1. Link pkg A
    const entryA = linkPackage(pkgADir, fakeHome);
    expect(entryA.id).toBe("team.pkg-a");
    expect(entryA.path).toBe(pkgADir);

    // 2. Link pkg B
    const entryB = linkPackage(pkgBDir, fakeHome);
    expect(entryB.id).toBe("team.pkg-b");

    // 3. List
    const list = listLinkedPackages(fakeHome);
    expect(list.length).toBe(2);
    expect(list.map((p) => p.id)).toContain("team.pkg-a");
    expect(list.map((p) => p.id)).toContain("team.pkg-b");

    // 4. Unlink
    const unlinked = unlinkPackage("team.pkg-a", fakeHome);
    expect(unlinked?.id).toBe("team.pkg-a");

    const afterList = listLinkedPackages(fakeHome);
    expect(afterList.length).toBe(1);
    expect(afterList[0].id).toBe("team.pkg-b");
  });

  it("resolves action from current project first", async () => {
    linkPackage(pkgBDir, fakeHome);

    // When running inside pkgADir, resolving common.action should resolve to pkg A
    const res = await resolveActionProject("common.action", pkgADir, fakeHome);
    expect(res.packageId).toBe("team.pkg-a");
    expect(res.projectRoot).toBe(pkgADir);
  });

  it("resolves unique action from linked packages when outside of project", async () => {
    linkPackage(pkgBDir, fakeHome);

    const outsideDir = fakeHome; // empty dir with no actiondock.json
    const res = await resolveActionProject("unique.b", outsideDir, fakeHome);
    expect(res.packageId).toBe("team.pkg-b");
    expect(res.projectRoot).toBe(pkgBDir);
  });

  it("detects conflict and allows scoped package resolution", async () => {
    linkPackage(pkgADir, fakeHome);
    linkPackage(pkgBDir, fakeHome);

    const outsideDir = fakeHome;

    // Unscoped common.action should throw error because both A and B provide it
    expect(
      resolveActionProject("common.action", outsideDir, fakeHome)
    ).rejects.toThrow("provided by multiple linked packages");

    // Scoped package specification should resolve cleanly
    const resA = await resolveActionProject("team.pkg-a/common.action", outsideDir, fakeHome);
    expect(resA.packageId).toBe("team.pkg-a");

    const resB = await resolveActionProject("pkg-b/common.action", outsideDir, fakeHome);
    expect(resB.packageId).toBe("team.pkg-b");
  });

  it("resolves playbook from current project and linked packages", () => {
    linkPackage(pkgADir, fakeHome);
    linkPackage(pkgBDir, fakeHome);

    // 1. Inside pkgADir
    const localRes = resolvePlaybookProject("common-sop", pkgADir, fakeHome);
    expect(localRes.packageId).toBe("team.pkg-a");
    expect(localRes.playbook.description).toBe("Common SOP in A");

    // 2. Outside project: unique playbook
    const outsideDir = fakeHome;
    const uniqueRes = resolvePlaybookProject("unique-b-sop", outsideDir, fakeHome);
    expect(uniqueRes.packageId).toBe("team.pkg-b");
    expect(uniqueRes.playbook.id).toBe("unique-b-sop");

    // 3. Outside project: conflicting playbook throws
    expect(() =>
      resolvePlaybookProject("common-sop", outsideDir, fakeHome)
    ).toThrow("provided by multiple linked packages");

    // 4. Outside project: scoped playbook resolves cleanly
    const scopedRes = resolvePlaybookProject("team.pkg-a/common-sop", outsideDir, fakeHome);
    expect(scopedRes.packageId).toBe("team.pkg-a");
    expect(scopedRes.playbook.id).toBe("common-sop");
  });

  it("links workspace directory and auto-discovers subprojects", () => {
    // Create a workspace root containing pkg-sub1 and pkg-sub2
    const wsDir = mkdtempSync(join(tmpdir(), "ws-root-"));
    const sub1 = join(wsDir, "packages", "sub1");
    const sub2 = join(wsDir, "packages", "sub2");

    initProject(sub1, { id: "team.sub-1", name: "Sub 1" });
    initProject(sub2, { id: "team.sub-2", name: "Sub 2" });

    // Link the workspace root (which does NOT have actiondock.json itself)
    const result = linkPackage(wsDir, fakeHome);
    expect(result.isWorkspace).toBe(true);
    expect(result.entries.length).toBe(2);
    expect(result.entries.map((e) => e.id)).toContain("team.sub-1");
    expect(result.entries.map((e) => e.id)).toContain("team.sub-2");

    // listLinkedPackages should list both
    const linked = listLinkedPackages(fakeHome);
    expect(linked.map((p) => p.id)).toContain("team.sub-1");
    expect(linked.map((p) => p.id)).toContain("team.sub-2");

    // Unlink workspace
    const unlinked = unlinkPackage(wsDir, fakeHome);
    expect(unlinked?.type).toBe("workspace");
    expect(unlinked?.packagesCount).toBe(2);

    const afterUnlink = listLinkedPackages(fakeHome);
    expect(afterUnlink.find((p) => p.id === "team.sub-1")).toBeUndefined();
    expect(afterUnlink.find((p) => p.id === "team.sub-2")).toBeUndefined();

    rmSync(wsDir, { recursive: true, force: true });
  });

  it("dynamically discovers newly added subprojects in linked workspace without re-linking", async () => {
    const rootNodeModules = resolve(__dirname, "../../../node_modules");

    // 1. Create workspace with initial sub1
    const wsDir = mkdtempSync(join(tmpdir(), "ws-dynamic-"));
    const sub1 = join(wsDir, "tools", "sub1");
    initProject(sub1, { id: "team.dyn-1", name: "Dynamic Sub 1" });
    if (existsSync(rootNodeModules)) {
      symlinkSync(rootNodeModules, join(sub1, "node_modules"), "dir");
    }

    const action1Content = `
import { defineAction } from "@actiondock/sdk";
export default defineAction({
  id: "dyn.action1",
  inputSchema: { type: "object" },
  async run() { return { ok: true }; }
});
`;
    writeFileSync(join(sub1, "actions", "dyn1.ts"), action1Content);

    // 2. Link workspace
    const res = linkPackage(wsDir, fakeHome);
    expect(res.isWorkspace).toBe(true);
    expect(res.entries.length).toBe(1);

    // 3. Add sub2 into workspace WITHOUT calling linkPackage again (simulating git pull / new package)
    const sub2 = join(wsDir, "tools", "sub2");
    initProject(sub2, { id: "team.dyn-2", name: "Dynamic Sub 2" });
    if (existsSync(rootNodeModules)) {
      symlinkSync(rootNodeModules, join(sub2, "node_modules"), "dir");
    }

    const action2Content = `
import { defineAction } from "@actiondock/sdk";
export default defineAction({
  id: "dyn.action2",
  inputSchema: { type: "object" },
  async run() { return { fromDyn2: true }; }
});
`;
    writeFileSync(join(sub2, "actions", "dyn2.ts"), action2Content);

    // 4. listLinkedPackages should automatically include newly added sub2!
    const allLinked = listLinkedPackages(fakeHome);
    expect(allLinked.map((p) => p.id)).toContain("team.dyn-1");
    expect(allLinked.map((p) => p.id)).toContain("team.dyn-2");

    // 5. resolveActionProject should seamlessly resolve action from newly added sub2!
    const resolved = await resolveActionProject("dyn.action2", fakeHome, fakeHome);
    expect(resolved.packageId).toBe("team.dyn-2");
    expect(resolved.projectRoot).toBe(sub2);
    expect(resolved.actionId).toBe("dyn.action2");

    rmSync(wsDir, { recursive: true, force: true });
  });

  it("reports registry status and prunes stale links", () => {
    // 1. Link a valid package A
    linkPackage(pkgADir, fakeHome);

    // 2. Link a temporary package that will be deleted
    const tempDir = mkdtempSync(join(tmpdir(), "temp-stale-"));
    initProject(tempDir, { id: "team.will-delete", name: "Will Delete" });
    linkPackage(tempDir, fakeHome);

    // Delete tempDir to simulate stale link
    rmSync(tempDir, { recursive: true, force: true });

    // 3. getRegistryStatus should detect 1 active and 1 stale
    const statusBefore = getRegistryStatus(fakeHome);
    expect(statusBefore.staleCount).toBe(1);
    expect(statusBefore.packages.some((p: any) => p.id === "team.pkg-a" && p.status === "active")).toBe(true);
    expect(statusBefore.packages.some((p: any) => p.id === "team.will-delete" && p.status === "stale")).toBe(true);

    // 4. pruneRegistry should remove the stale entry
    const pruneRes = pruneRegistry(fakeHome);
    expect(pruneRes.prunedPackages.length).toBe(1);
    expect(pruneRes.prunedPackages[0].id).toBe("team.will-delete");

    // 5. getRegistryStatus after prune should have 0 stale
    const statusAfter = getRegistryStatus(fakeHome);
    expect(statusAfter.staleCount).toBe(0);
    expect(statusAfter.packages.length).toBe(1);
    expect(statusAfter.packages[0].id).toBe("team.pkg-a");
  });
});

