import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { initProject } from "../src/project/init";
import {
  linkPackage,
  listLinkedPackages,
  loadRegistry,
  resolveActionProject,
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
});
