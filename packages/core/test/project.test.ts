import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { initProject } from "../src/project/init";
import { loadManifest } from "../src/project/manifest";
import {
  ALLOWED_INSTALLERS,
  discoverActionFiles,
  getInstallCommand,
  loadActions,
  loadPlaybooks,
  loadProjectConfig,
  parsePlaybookContent,
} from "../src/project/loader";
import { assertPathWithinRoot } from "../src/utils";

describe("Project Loader & Init", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "actiondock-test-"));
    // Link root node_modules so @actiondock/sdk is resolvable
    const rootNodeModules = resolve(import.meta.dirname, "../../../node_modules");
    if (existsSync(rootNodeModules)) {
      symlinkSync(rootNodeModules, join(tempDir, "node_modules"), "junction");
    }
  });

  afterEach(() => {
    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("initializes a complete project scaffold and loads it", async () => {
    initProject(tempDir, {
      id: "org.test-project",
      name: "Test Project",
      description: "Sample project for testing",
    });

    assert.strictEqual(existsSync(join(tempDir, "actiondock.json")), true);
    assert.strictEqual(existsSync(join(tempDir, "actiondock.manifest.json")), false);
    assert.strictEqual(existsSync(join(tempDir, "package.json")), true);
    assert.strictEqual(existsSync(join(tempDir, "actions", "greet.ts")), true);
    assert.strictEqual(existsSync(join(tempDir, "playbooks", "greet-user.md")), true);

    const config = loadProjectConfig(tempDir);
    assert.strictEqual(config.id, "org.test-project");
    assert.strictEqual(config.name, "Test Project");
    assert.strictEqual(config.schemaVersion, 2);
    assert.notStrictEqual(config.actions?.["sample.greet"], undefined);
    assert.notStrictEqual(config.playbooks?.["greet-user"], undefined);

    const actionFiles = discoverActionFiles(tempDir, config.actionsDir);
    assert.strictEqual(actionFiles.length, 1);

    const actions = await loadActions(tempDir, config.actionsDir);
    assert.strictEqual(actions.size, 1);
    assert.strictEqual(actions.has("sample.greet"), true);
    const greetAction = actions.get("sample.greet");
    assert.notStrictEqual(greetAction, undefined);
    assert.strictEqual(typeof greetAction?.run, "function");

    const greetSpec = config.actions?.["sample.greet"];
    assert.strictEqual(greetSpec?.description, "Greeting action demonstrating basic input, config, and state usage");
    assert.notStrictEqual(greetSpec?.inputSchema, undefined);

    const playbooks = loadPlaybooks(tempDir, config.playbooksDir);
    assert.strictEqual(playbooks.size, 1);
    assert.strictEqual(playbooks.has("greet-user"), true);
    assert.deepStrictEqual(playbooks.get("greet-user")?.actions, ["sample.greet"]);
    assert.ok((playbooks.get("greet-user")?.content).includes("# Greeting SOP"));
  });

  it("parses pure markdown playbook correctly without YAML frontmatter", () => {
    const raw = `# Deploy Service SOP

Follow these steps carefully.
`;
    const pb = parsePlaybookContent(raw, "/path/deploy-service.md", {
      description: "Deploy service to production",
      actions: ["k8s.apply", "health.check"],
    });
    assert.strictEqual(pb.id, "deploy-service");
    assert.strictEqual(pb.description, "Deploy service to production");
    assert.deepStrictEqual(pb.actions, ["k8s.apply", "health.check"]);
    assert.strictEqual(pb.content, "# Deploy Service SOP\n\nFollow these steps carefully.");

    // Windows backslash path fallback test
    const winPb = parsePlaybookContent("# Just content", "C:\\Users\\dev\\playbooks\\quick-start.md");
    assert.strictEqual(winPb.id, "quick-start");
    assert.strictEqual(winPb.content, "# Just content");
    assert.deepStrictEqual(winPb.actions, []);
  });

  it("loads playbook metadata strictly from actiondock.json as single source of truth without merging frontmatter", () => {
    writeFileSync(
      join(tempDir, "actiondock.json"),
      JSON.stringify({
        id: "test.pb-single-source",
        schemaVersion: 2,
        playbooks: {
          "run-audit": {
            entry: "playbooks/audit.md",
            description: "Audit task from manifest",
            actions: ["sec.scan"],
          },
        },
      })
    );
    mkdirSync(join(tempDir, "playbooks"), { recursive: true });
    // Markdown contains legacy frontmatter attempting to override id/description/actions
    writeFileSync(
      join(tempDir, "playbooks", "audit.md"),
      `---
id: malicious-override
description: Malicious description
actions:
  - other.action
---
# Security Audit SOP

Perform audit steps.
`
    );
    // An unmanifested playbook on disk
    writeFileSync(
      join(tempDir, "playbooks", "unmanifested.md"),
      "# Unmanifested SOP"
    );

    const playbooks = loadPlaybooks(tempDir);
    assert.strictEqual(playbooks.size, 1);
    assert.strictEqual(playbooks.has("run-audit"), true);
    assert.strictEqual(playbooks.has("malicious-override"), false);
    assert.strictEqual(playbooks.has("unmanifested"), false);

    const pb = playbooks.get("run-audit")!;
    assert.strictEqual(pb.id, "run-audit");
    assert.strictEqual(pb.description, "Audit task from manifest");
    assert.deepStrictEqual(pb.actions, ["sec.scan"]);
    assert.strictEqual(pb.content, "# Security Audit SOP\n\nPerform audit steps.");
  });

  it("loads action metadata strictly from actiondock.json as single source of truth", async () => {
    writeFileSync(
      join(tempDir, "actiondock.json"),
      JSON.stringify({
        id: "test.single-source",
        schemaVersion: 2,
        actions: {
          "calc.add": {
            entry: "actions/add.ts",
            description: "Add numbers (from actiondock.json)",
            inputSchema: { type: "object", properties: { a: { type: "number" } } },
            tags: ["math", "fast"],
            uses: ["other.pkg/act"],
          },
        },
      })
    );
    mkdirSync(join(tempDir, "actions"), { recursive: true });
    writeFileSync(
      join(tempDir, "actions", "add.ts"),
      `export default async function(input: any) { return { sum: input.a + 1 }; };`
    );

    const loadedActions = await loadActions(tempDir);
    assert.strictEqual(loadedActions.size, 1);
    const addAction = loadedActions.get("calc.add");
    assert.notStrictEqual(addAction, undefined);
    assert.strictEqual(typeof addAction?.run, "function");

    const manifest = loadManifest(tempDir);
    const addSpec = manifest?.actions?.["calc.add"];
    assert.strictEqual(addSpec?.description, "Add numbers (from actiondock.json)");
    assert.deepStrictEqual(addSpec?.tags, ["math", "fast"]);
    assert.deepStrictEqual(addSpec?.uses, ["other.pkg/act"]);
    assert.deepStrictEqual(addSpec?.inputSchema, { type: "object", properties: { a: { type: "number" } } });
  });

  it("converges allowed installers strictly to npm and bun", () => {
    assert.strictEqual(ALLOWED_INSTALLERS.has("npm"), true);
    assert.strictEqual(ALLOWED_INSTALLERS.has("bun"), true);
    assert.strictEqual(ALLOWED_INSTALLERS.has("pnpm"), false);
    assert.strictEqual(ALLOWED_INSTALLERS.has("yarn"), false);
  });

  it("resolves install commands respecting npm and bun priority and lockfiles", async () => {
    const pkgDir = mkdtempSync(join(tmpdir(), "installer-test-"));
    const origEnv = process.env.ACTIONDOCK_INSTALLER;
    try {
      // 1. Explicit ACTIONDOCK_INSTALLER
      process.env.ACTIONDOCK_INSTALLER = "bun";
      assert.deepStrictEqual(await getInstallCommand(pkgDir), ["bun", "install"]);

      process.env.ACTIONDOCK_INSTALLER = "npm";
      assert.deepStrictEqual(await getInstallCommand(pkgDir), ["npm", "install"]);

      // Disallowed installers should be ignored and fall back
      process.env.ACTIONDOCK_INSTALLER = "pnpm";
      const pnpmFallback = await getInstallCommand(pkgDir);
      assert.ok((["npm", "bun"]).includes(pnpmFallback[0]));

      delete process.env.ACTIONDOCK_INSTALLER;

      // 2. Lockfile matching
      // pnpm-lock.yaml and yarn.lock are ignored
      writeFileSync(join(pkgDir, "pnpm-lock.yaml"), "lockfileVersion: 5.4");
      const ignoredLock = await getInstallCommand(pkgDir);
      assert.notStrictEqual(ignoredLock[0], "pnpm");

      // bun.lock / bun.lockb matches bun
      writeFileSync(join(pkgDir, "bun.lockb"), "");
      assert.deepStrictEqual(await getInstallCommand(pkgDir), ["bun", "install"]);

      // package-lock.json matches npm
      rmSync(join(pkgDir, "bun.lockb"), { force: true });
      writeFileSync(join(pkgDir, "package-lock.json"), "{}");
      assert.deepStrictEqual(await getInstallCommand(pkgDir), ["npm", "install"]);
    } finally {
      if (origEnv === undefined) {
        delete process.env.ACTIONDOCK_INSTALLER;
      } else {
        process.env.ACTIONDOCK_INSTALLER = origEnv;
      }
      rmSync(pkgDir, { recursive: true, force: true });
    }
  });

  describe("Security & Path Boundaries", () => {
    it("rejects absolute paths and dot-dot traversal in actionsDir and playbooksDir", () => {
      // 绝对路径
      writeFileSync(
        join(tempDir, "actiondock.json"),
        JSON.stringify({ id: "safe-pkg", actionsDir: "/etc/passwd" })
      );
      assert.throws(() => loadProjectConfig(tempDir), /cannot be an absolute path/);

      // 相对路径越界 ..
      writeFileSync(
        join(tempDir, "actiondock.json"),
        JSON.stringify({ id: "safe-pkg", actionsDir: "../secret" })
      );
      assert.throws(() => loadProjectConfig(tempDir), /escapes boundary/);

      // playbooksDir 越界
      writeFileSync(
        join(tempDir, "actiondock.json"),
        JSON.stringify({ id: "safe-pkg", playbooksDir: "../../outside" })
      );
      assert.throws(() => loadProjectConfig(tempDir), /escapes boundary/);
    });

    it("rejects symlinks that resolve outside of project boundary", () => {
      const outsideDir = mkdtempSync(join(tmpdir(), "actiondock-outside-"));
      try {
        const symlinkActions = join(tempDir, "symlink-actions");
        symlinkSync(outsideDir, symlinkActions, "junction");

        writeFileSync(
          join(tempDir, "actiondock.json"),
          JSON.stringify({ id: "safe-pkg", actionsDir: "symlink-actions" })
        );
        assert.throws(() => loadProjectConfig(tempDir), /symlink resolves outside boundary/);
      } finally {
        rmSync(outsideDir, { recursive: true, force: true });
      }
    });

    it("rejects non-existent targets inside a symlink directory that resolves outside root", () => {
      const outsideDir = mkdtempSync(join(tmpdir(), "actiondock-outside-"));
      try {
        const symlinkDir = join(tempDir, "external-link");
        symlinkSync(outsideDir, symlinkDir, "junction");

        // The target file does not exist yet, but its parent directory is a symlink pointing outside
        const nonExistentTarget = join(symlinkDir, "sub", "deep", "nonexistent.ts");
        assert.throws(() =>
          assertPathWithinRoot(tempDir, nonExistentTarget, "testFile"), /symlink resolves outside boundary/);
      } finally {
        rmSync(outsideDir, { recursive: true, force: true });
      }
    });

    it("symmetrically allows non-existent targets when rootDir has a symlink ancestor and target is within boundary", () => {
      const externalBase = mkdtempSync(join(tmpdir(), "ad-external-base-"));
      try {
        const realTarget = join(externalBase, "real-app");
        mkdirSync(realTarget, { recursive: true });

        const symlinkDir = join(tempDir, "linked-app");
        symlinkSync(realTarget, symlinkDir, "junction");

        // rootDir has a symlink ancestor (linked-app) and subfolder does not exist yet
        const rootDir = join(symlinkDir, "data");
        const targetPath = join(rootDir, "pkg", "runtime.db");

        // Should not throw because canonical target is inside canonical root
        assert.doesNotThrow(() => assertPathWithinRoot(rootDir, targetPath, "storagePath"));

        // But escaping the canonical root should still throw
        const escapingTarget = join(rootDir, "..", "..", "outside.db");
        assert.throws(() => assertPathWithinRoot(rootDir, escapingTarget, "storagePath"));
      } finally {
        rmSync(externalBase, { recursive: true, force: true });
      }
    });
  });
});
