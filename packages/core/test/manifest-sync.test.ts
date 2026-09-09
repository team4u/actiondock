import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { initProject } from "../src/project/init";
import { checkManifestSync, loadManifest, syncManifest } from "../src/project/manifest";

describe("Manifest Synchronization Module", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "actiondock-manifest-sync-"));
    const rootNodeModules = resolve(__dirname, "../../../node_modules");
    if (existsSync(rootNodeModules)) {
      symlinkSync(rootNodeModules, join(tempDir, "node_modules"), "dir");
    }
    initProject(tempDir, {
      id: "org.sync-test",
      name: "Sync Test Project",
    });
  });

  afterEach(() => {
    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("reports inSync: true for a newly initialized project", async () => {
    const checkRes = await checkManifestSync(tempDir);
    expect(checkRes.inSync).toBe(true);
    expect(checkRes.unchanged).toContain("sample.greet");
    expect(checkRes.added.length).toBe(0);
    expect(checkRes.updated.length).toBe(0);
    expect(checkRes.removed.length).toBe(0);
  });

  it("detects modifications in inputSchema and description and updates manifest", async () => {
    const updatedActionCode = `import { defineAction } from "@actiondock/sdk";

export default defineAction({
  id: "sample.greet",
  description: "Updated description for greeting action",
  inputSchema: {
    type: "object",
    properties: {
      name: { type: "string" },
      title: { type: "string" },
    },
    required: ["name"],
  },
  outputSchema: {
    type: "object",
    properties: {
      message: { type: "string" },
    },
    required: ["message"],
  },
  async run(input: any) {
    return { message: "Hello " + input.name };
  },
});
`;
    writeFileSync(join(tempDir, "actions", "greet.ts"), updatedActionCode);

    const checkRes = await checkManifestSync(tempDir);
    expect(checkRes.inSync).toBe(false);
    expect(checkRes.updated).toContain("sample.greet");
    const change = checkRes.changes.find((c) => c.actionId === "sample.greet");
    expect(change?.changedFields).toContain("description");
    expect(change?.changedFields).toContain("inputSchema");

    const manifestBefore = loadManifest(tempDir);
    expect(manifestBefore?.actions["sample.greet"].description).not.toBe("Updated description for greeting action");

    const syncRes = await syncManifest(tempDir);
    expect(syncRes.inSync).toBe(false);
    expect(syncRes.updated).toContain("sample.greet");

    const manifestAfter = loadManifest(tempDir);
    expect(manifestAfter?.actions["sample.greet"].description).toBe("Updated description for greeting action");
    const inSchema: any = manifestAfter?.actions["sample.greet"].inputSchema;
    expect(inSchema?.properties?.title).toBeDefined();

    const checkAgain = await checkManifestSync(tempDir);
    expect(checkAgain.inSync).toBe(true);
    expect(checkAgain.unchanged).toContain("sample.greet");
  });

  it("detects newly added action files and synchronizes them into manifest", async () => {
    const newActionCode = `import { defineAction } from "@actiondock/sdk";

export default defineAction({
  id: "math.add",
  description: "Add two numbers together",
  inputSchema: {
    type: "object",
    properties: {
      a: { type: "number" },
      b: { type: "number" },
    },
    required: ["a", "b"],
  },
  outputSchema: {
    type: "object",
    properties: {
      sum: { type: "number" },
    },
    required: ["sum"],
  },
  tags: ["math", "calculation"],
  async run(input: any) {
    return { sum: input.a + input.b };
  },
});
`;
    writeFileSync(join(tempDir, "actions", "add.ts"), newActionCode);

    const checkRes = await checkManifestSync(tempDir);
    expect(checkRes.inSync).toBe(false);
    expect(checkRes.added).toContain("math.add");

    const syncRes = await syncManifest(tempDir);
    expect(syncRes.added).toContain("math.add");

    const manifest = loadManifest(tempDir);
    expect(manifest?.actions["math.add"]).toBeDefined();
    expect(manifest?.actions["math.add"].description).toBe("Add two numbers together");
    expect(manifest?.actions["math.add"].tags).toEqual(["math", "calculation"]);
    expect(manifest?.actions["sample.greet"]).toBeDefined();
  });

  it("detects deleted action files and prunes them from manifest", async () => {
    unlinkSync(join(tempDir, "actions", "greet.ts"));

    const checkRes = await checkManifestSync(tempDir);
    expect(checkRes.inSync).toBe(false);
    expect(checkRes.removed).toContain("sample.greet");

    const noPruneRes = await syncManifest(tempDir, { prune: false });
    expect(noPruneRes.removed).toContain("sample.greet");
    expect(loadManifest(tempDir)?.actions["sample.greet"]).toBeDefined();

    const pruneRes = await syncManifest(tempDir);
    expect(pruneRes.removed).toContain("sample.greet");
    expect(loadManifest(tempDir)?.actions["sample.greet"]).toBeUndefined();
  });

  it("re-creates manifest from scratch if actiondock.manifest.json was deleted", async () => {
    unlinkSync(join(tempDir, "actiondock.manifest.json"));
    expect(loadManifest(tempDir)).toBeNull();

    const syncRes = await syncManifest(tempDir);
    expect(syncRes.added).toContain("sample.greet");

    const manifest = loadManifest(tempDir);
    expect(manifest).not.toBeNull();
    expect(manifest?.actions["sample.greet"]).toBeDefined();
    expect(manifest?.actions["sample.greet"].entry).toBe("actions/greet.ts");
  });

  it("loadManifest 在文件不存在时返回 null，在 JSON 损坏或 schemaVersion 不合法时抛出异常", () => {
    const nonExistentDir = join(tempDir, "non-existent-sub");
    expect(loadManifest(nonExistentDir)).toBeNull();

    // 损坏的 JSON
    writeFileSync(join(tempDir, "actiondock.manifest.json"), "{ invalid json: here");
    expect(() => loadManifest(tempDir)).toThrow(/Corrupted JSON/);

    // 非法 schemaVersion
    writeFileSync(
      join(tempDir, "actiondock.manifest.json"),
      JSON.stringify({ schemaVersion: 999, actions: {} })
    );
    expect(() => loadManifest(tempDir)).toThrow(/Unsupported manifest schemaVersion/);

    // 不是对象
    writeFileSync(join(tempDir, "actiondock.manifest.json"), JSON.stringify(["not", "an", "object"]));
    expect(() => loadManifest(tempDir)).toThrow(/Invalid manifest format/);
  });
});
