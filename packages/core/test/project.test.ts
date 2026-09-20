import { afterEach, beforeEach, describe, expect, it } from "bun:test";
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
      symlinkSync(rootNodeModules, join(tempDir, "node_modules"), "dir");
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

    expect(existsSync(join(tempDir, "actiondock.json"))).toBe(true);
    expect(existsSync(join(tempDir, "actiondock.manifest.json"))).toBe(false);
    expect(existsSync(join(tempDir, "package.json"))).toBe(true);
    expect(existsSync(join(tempDir, "actions", "greet.ts"))).toBe(true);
    expect(existsSync(join(tempDir, "playbooks", "greet-user.md"))).toBe(true);

    const config = loadProjectConfig(tempDir);
    expect(config.id).toBe("org.test-project");
    expect(config.name).toBe("Test Project");
    expect(config.schemaVersion).toBe(2);
    expect(config.actions?.["sample.greet"]).toBeDefined();
    expect(config.playbooks?.["greet-user"]).toBeDefined();

    const actionFiles = discoverActionFiles(tempDir, config.actionsDir);
    expect(actionFiles.length).toBe(1);

    const actions = await loadActions(tempDir, config.actionsDir);
    expect(actions.size).toBe(1);
    expect(actions.has("sample.greet")).toBe(true);
    const greetAction = actions.get("sample.greet");
    expect(greetAction).toBeDefined();
    expect(typeof greetAction?.run).toBe("function");

    const greetSpec = config.actions?.["sample.greet"];
    expect(greetSpec?.description).toBe("Greeting action demonstrating basic input, config, and state usage");
    expect(greetSpec?.inputSchema).toBeDefined();

    const playbooks = loadPlaybooks(tempDir, config.playbooksDir);
    expect(playbooks.size).toBe(1);
    expect(playbooks.has("greet-user")).toBe(true);
    expect(playbooks.get("greet-user")?.actions).toEqual(["sample.greet"]);
    expect(playbooks.get("greet-user")?.content).toContain("# Greeting SOP");
  });

  it("parses pure markdown playbook correctly without YAML frontmatter", () => {
    const raw = `# Deploy Service SOP

Follow these steps carefully.
`;
    const pb = parsePlaybookContent(raw, "/path/deploy-service.md", {
      description: "Deploy service to production",
      actions: ["k8s.apply", "health.check"],
    });
    expect(pb.id).toBe("deploy-service");
    expect(pb.description).toBe("Deploy service to production");
    expect(pb.actions).toEqual(["k8s.apply", "health.check"]);
    expect(pb.content).toBe("# Deploy Service SOP\n\nFollow these steps carefully.");

    // Windows backslash path fallback test
    const winPb = parsePlaybookContent("# Just content", "C:\\Users\\dev\\playbooks\\quick-start.md");
    expect(winPb.id).toBe("quick-start");
    expect(winPb.content).toBe("# Just content");
    expect(winPb.actions).toEqual([]);
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
    expect(playbooks.size).toBe(1);
    expect(playbooks.has("run-audit")).toBe(true);
    expect(playbooks.has("malicious-override")).toBe(false);
    expect(playbooks.has("unmanifested")).toBe(false);

    const pb = playbooks.get("run-audit")!;
    expect(pb.id).toBe("run-audit");
    expect(pb.description).toBe("Audit task from manifest");
    expect(pb.actions).toEqual(["sec.scan"]);
    expect(pb.content).toBe("# Security Audit SOP\n\nPerform audit steps.");
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
    expect(loadedActions.size).toBe(1);
    const addAction = loadedActions.get("calc.add");
    expect(addAction).toBeDefined();
    expect(typeof addAction?.run).toBe("function");

    const manifest = loadManifest(tempDir);
    const addSpec = manifest?.actions?.["calc.add"];
    expect(addSpec?.description).toBe("Add numbers (from actiondock.json)");
    expect(addSpec?.tags).toEqual(["math", "fast"]);
    expect(addSpec?.uses).toEqual(["other.pkg/act"]);
    expect(addSpec?.inputSchema).toEqual({ type: "object", properties: { a: { type: "number" } } });
  });

  it("converges allowed installers strictly to npm and bun", () => {
    expect(ALLOWED_INSTALLERS.has("npm")).toBe(true);
    expect(ALLOWED_INSTALLERS.has("bun")).toBe(true);
    expect(ALLOWED_INSTALLERS.has("pnpm")).toBe(false);
    expect(ALLOWED_INSTALLERS.has("yarn")).toBe(false);
  });

  it("resolves install commands respecting npm and bun priority and lockfiles", () => {
    const pkgDir = mkdtempSync(join(tmpdir(), "installer-test-"));
    const origEnv = process.env.ACTIONDOCK_INSTALLER;
    try {
      // 1. Explicit ACTIONDOCK_INSTALLER
      process.env.ACTIONDOCK_INSTALLER = "bun";
      expect(getInstallCommand(pkgDir)).toEqual(["bun", "install"]);

      process.env.ACTIONDOCK_INSTALLER = "npm";
      expect(getInstallCommand(pkgDir)).toEqual(["npm", "install"]);

      // Disallowed installers should be ignored and fall back
      process.env.ACTIONDOCK_INSTALLER = "pnpm";
      const pnpmFallback = getInstallCommand(pkgDir);
      expect(["npm", "bun"]).toContain(pnpmFallback[0]);

      delete process.env.ACTIONDOCK_INSTALLER;

      // 2. Lockfile matching
      // pnpm-lock.yaml and yarn.lock are ignored
      writeFileSync(join(pkgDir, "pnpm-lock.yaml"), "lockfileVersion: 5.4");
      const ignoredLock = getInstallCommand(pkgDir);
      expect(ignoredLock[0]).not.toBe("pnpm");

      // bun.lock / bun.lockb matches bun
      writeFileSync(join(pkgDir, "bun.lockb"), "");
      expect(getInstallCommand(pkgDir)).toEqual(["bun", "install"]);

      // package-lock.json matches npm
      rmSync(join(pkgDir, "bun.lockb"), { force: true });
      writeFileSync(join(pkgDir, "package-lock.json"), "{}");
      expect(getInstallCommand(pkgDir)).toEqual(["npm", "install"]);
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
      expect(() => loadProjectConfig(tempDir)).toThrow(/cannot be an absolute path/);

      // 相对路径越界 ..
      writeFileSync(
        join(tempDir, "actiondock.json"),
        JSON.stringify({ id: "safe-pkg", actionsDir: "../secret" })
      );
      expect(() => loadProjectConfig(tempDir)).toThrow(/escapes boundary/);

      // playbooksDir 越界
      writeFileSync(
        join(tempDir, "actiondock.json"),
        JSON.stringify({ id: "safe-pkg", playbooksDir: "../../outside" })
      );
      expect(() => loadProjectConfig(tempDir)).toThrow(/escapes boundary/);
    });

    it("rejects symlinks that resolve outside of project boundary", () => {
      const outsideDir = mkdtempSync(join(tmpdir(), "actiondock-outside-"));
      try {
        const symlinkActions = join(tempDir, "symlink-actions");
        symlinkSync(outsideDir, symlinkActions, "dir");

        writeFileSync(
          join(tempDir, "actiondock.json"),
          JSON.stringify({ id: "safe-pkg", actionsDir: "symlink-actions" })
        );
        expect(() => loadProjectConfig(tempDir)).toThrow(/symlink resolves outside boundary/);
      } finally {
        rmSync(outsideDir, { recursive: true, force: true });
      }
    });

    it("rejects non-existent targets inside a symlink directory that resolves outside root", () => {
      const outsideDir = mkdtempSync(join(tmpdir(), "actiondock-outside-"));
      try {
        const symlinkDir = join(tempDir, "external-link");
        symlinkSync(outsideDir, symlinkDir, "dir");

        // The target file does not exist yet, but its parent directory is a symlink pointing outside
        const nonExistentTarget = join(symlinkDir, "sub", "deep", "nonexistent.ts");
        expect(() =>
          assertPathWithinRoot(tempDir, nonExistentTarget, "testFile")
        ).toThrow(/symlink resolves outside boundary/);
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
        symlinkSync(realTarget, symlinkDir, "dir");

        // rootDir has a symlink ancestor (linked-app) and subfolder does not exist yet
        const rootDir = join(symlinkDir, "data");
        const targetPath = join(rootDir, "pkg", "runtime.db");

        // Should not throw because canonical target is inside canonical root
        expect(() => assertPathWithinRoot(rootDir, targetPath, "storagePath")).not.toThrow();

        // But escaping the canonical root should still throw
        const escapingTarget = join(rootDir, "..", "..", "outside.db");
        expect(() => assertPathWithinRoot(rootDir, escapingTarget, "storagePath")).toThrow();
      } finally {
        rmSync(externalBase, { recursive: true, force: true });
      }
    });
  });
});
