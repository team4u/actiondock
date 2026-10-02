import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
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
      symlinkSync(rootNodeModules, join(tempDir, "node_modules"), "junction");
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
    assert.notStrictEqual(manifest, null);
    assert.strictEqual(manifest?.id, "org.manifest-test");
    assert.strictEqual(manifest?.schemaVersion, 2);
    assert.notStrictEqual(manifest?.actions?.["sample.greet"], undefined);
    assert.strictEqual(manifest?.actions?.["sample.greet"].entry, "actions/greet.ts");
    assert.notStrictEqual(manifest?.playbooks?.["greet-user"], undefined);
    assert.strictEqual(manifest?.playbooks?.["greet-user"].entry, "playbooks/greet-user.md");

    // 确保绝对不生成旧版 actiondock.manifest.json
    assert.strictEqual(existsSync(join(tempDir, "actiondock.manifest.json")), false);

    const validation = validateManifest(manifest, { projectRoot: tempDir });
    assert.strictEqual(validation.valid, true);
    assert.strictEqual(validation.errors, undefined);
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
    assert.strictEqual(res1.valid, false);
    assert.strictEqual(res1.errors?.some((e) => e.includes("path traversal") || e.includes("escapes project root")), true);

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
    assert.strictEqual(res2.valid, false);
    assert.strictEqual(res2.errors?.some((e) => e.includes("cannot be an absolute path")), true);

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
    assert.strictEqual(res3.valid, false);
    assert.strictEqual(res3.errors?.some((e) => e.includes("Invalid action ID")), true);

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
    assert.strictEqual(res4.valid, false);
    assert.strictEqual(res4.errors?.some((e) => e.includes("Invalid playbook ID")), true);
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
    assert.strictEqual(reloaded?.description, "Updated description");
    assert.notStrictEqual(reloaded?.actions?.["custom.action"], undefined);
    assert.strictEqual(reloaded?.actions?.["custom.action"].description, "A custom action");
    assert.deepStrictEqual(reloaded?.actions?.["custom.action"].tags, ["custom"]);
  });

  it("loadManifest 在文件不存在时返回 null，在 JSON 损坏或 schemaVersion 不合法时抛出异常", () => {
    const nonExistentDir = join(tempDir, "non-existent-sub");
    assert.strictEqual(loadManifest(nonExistentDir), null);

    // 损坏的 JSON
    writeFileSync(join(tempDir, "actiondock.json"), "{ invalid json: here");
    assert.throws(() => loadManifest(tempDir), /Corrupted JSON/);

    // 非法 schemaVersion
    writeFileSync(
      join(tempDir, "actiondock.json"),
      JSON.stringify({ schemaVersion: 999, id: "test", actions: {} })
    );
    assert.throws(() => loadManifest(tempDir), /Unsupported manifest schemaVersion/);

    // 不是对象
    writeFileSync(join(tempDir, "actiondock.json"), JSON.stringify(["not", "an", "object"]));
    assert.throws(() => loadManifest(tempDir), /Invalid manifest format/);
  });

  it("allows paths in directories prefixed with double dots like ..cache without false boundary escape", () => {
    const cacheDir = join(tempDir, "..cache");
    mkdirSync(cacheDir, { recursive: true });
    writeFileSync(join(cacheDir, "action.ts"), "export default {};");
    writeFileSync(join(cacheDir, "playbook.md"), "# Playbook");
    writeFileSync(join(cacheDir, "asset.json"), "{}");

    const dotManifest: ActionDockManifest = {
      id: "test.dotcache",
      schemaVersion: 2,
      actions: {
        "cache.act": {
          entry: "..cache/action.ts",
        },
      },
      playbooks: {
        "cache.pb": {
          entry: "..cache/playbook.md",
        },
      },
      assets: ["..cache/asset.json"],
    };

    const res = validateManifest(dotManifest, { projectRoot: tempDir });
    assert.strictEqual(res.valid, true);
    assert.strictEqual(res.errors, undefined);
  });
});
