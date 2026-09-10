import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, mkdtempSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { initProject } from "../src/project/init";
import { loadManifest, saveManifest, validateManifest } from "../src/project/manifest";
import type { ActionDockManifest } from "../src/project/types";

describe("Manifest v2 (actiondock.json) Module", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "actiondock-manifest-test-"));
    const rootNodeModules = resolve(import.meta.dirname, "../../../node_modules");
    if (existsSync(rootNodeModules)) {
      symlinkSync(rootNodeModules, join(tempDir, "node_modules"), "dir");
    }
    initProject(tempDir, {
      id: "org.manifest-test",
      name: "Manifest Test Project",
    });
  });

  afterEach(() => {
    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("loads initialized project actiondock.json as valid Manifest v2", () => {
    const manifest = loadManifest(tempDir);
    expect(manifest).not.toBeNull();
    expect(manifest?.id).toBe("org.manifest-test");
    expect(manifest?.schemaVersion).toBe(2);
    expect(manifest?.actions?.["sample.greet"]).toBeDefined();
    expect(manifest?.actions?.["sample.greet"].entry).toBe("actions/greet.ts");
    expect(manifest?.playbooks?.["greet-user"]).toBeDefined();
    expect(manifest?.playbooks?.["greet-user"].entry).toBe("playbooks/greet-user.md");

    // 确保绝对不生成旧版 actiondock.manifest.json
    expect(existsSync(join(tempDir, "actiondock.manifest.json"))).toBe(false);

    const validation = validateManifest(manifest, { projectRoot: tempDir });
    expect(validation.valid).toBe(true);
    expect(validation.errors).toBeUndefined();
  });

  it("validates action entries, path security, and playbook entries", () => {
    // 越界路径检测 (..)
    const traversalManifest: ActionDockManifest = {
      id: "test.traversal",
      schemaVersion: 2,
      actions: {
        "bad.act": {
          entry: "../outside.ts",
        },
      },
    };
    const res1 = validateManifest(traversalManifest, { projectRoot: tempDir });
    expect(res1.valid).toBe(false);
    expect(res1.errors?.some((e) => e.includes("path traversal") || e.includes("escapes project root"))).toBe(true);

    // 绝对路径检测
    const absoluteManifest: ActionDockManifest = {
      id: "test.abs",
      schemaVersion: 2,
      actions: {
        "abs.act": {
          entry: "/etc/passwd",
        },
      },
    };
    const res2 = validateManifest(absoluteManifest, { projectRoot: tempDir });
    expect(res2.valid).toBe(false);
    expect(res2.errors?.some((e) => e.includes("cannot be an absolute path"))).toBe(true);

    // 非法 Action ID 检测
    const invalidIdManifest: ActionDockManifest = {
      id: "test.bad-id",
      schemaVersion: 2,
      actions: {
        "bad/action/id": {
          entry: "actions/bad.ts",
        },
      },
    };
    const res3 = validateManifest(invalidIdManifest, { projectRoot: tempDir });
    expect(res3.valid).toBe(false);
    expect(res3.errors?.some((e) => e.includes("Invalid action ID"))).toBe(true);

    // 非法 Playbook ID 检测
    const invalidPbManifest: ActionDockManifest = {
      id: "test.bad-pb",
      schemaVersion: 2,
      playbooks: {
        "bad/playbook": {
          entry: "playbooks/bad.md",
        },
      },
    };
    const res4 = validateManifest(invalidPbManifest, { projectRoot: tempDir });
    expect(res4.valid).toBe(false);
    expect(res4.errors?.some((e) => e.includes("Invalid playbook ID"))).toBe(true);
  });

  it("saves and reloads manifest to actiondock.json", () => {
    const original = loadManifest(tempDir)!;
    original.description = "Updated description";
    original.actions = {
      ...original.actions,
      "custom.action": {
        entry: "actions/custom.ts",
        description: "A custom action",
        tags: ["custom"],
      },
    };
    saveManifest(tempDir, original);

    const reloaded = loadManifest(tempDir);
    expect(reloaded?.description).toBe("Updated description");
    expect(reloaded?.actions?.["custom.action"]).toBeDefined();
    expect(reloaded?.actions?.["custom.action"].description).toBe("A custom action");
    expect(reloaded?.actions?.["custom.action"].tags).toEqual(["custom"]);
  });

  it("loadManifest 在文件不存在时返回 null，在 JSON 损坏或 schemaVersion 不合法时抛出异常", () => {
    const nonExistentDir = join(tempDir, "non-existent-sub");
    expect(loadManifest(nonExistentDir)).toBeNull();

    // 损坏的 JSON
    writeFileSync(join(tempDir, "actiondock.json"), "{ invalid json: here");
    expect(() => loadManifest(tempDir)).toThrow(/Corrupted JSON/);

    // 非法 schemaVersion
    writeFileSync(
      join(tempDir, "actiondock.json"),
      JSON.stringify({ schemaVersion: 999, id: "test", actions: {} })
    );
    expect(() => loadManifest(tempDir)).toThrow(/Unsupported manifest schemaVersion/);

    // 不是对象
    writeFileSync(join(tempDir, "actiondock.json"), JSON.stringify(["not", "an", "object"]));
    expect(() => loadManifest(tempDir)).toThrow(/Invalid manifest format/);
  });
});
