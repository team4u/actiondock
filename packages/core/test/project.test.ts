import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { initProject } from "../src/project/init";
import {
  computeDependencyFingerprint,
  discoverActionFiles,
  ensureProjectDependencies,
  loadActions,
  loadPlaybooks,
  loadProjectConfig,
  parsePlaybookContent,
  readStoredDependencyFingerprint,
  saveDependencyFingerprint,
} from "../src/project/loader";

describe("Project Loader & Init", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "actiondock-test-"));
    // Link root node_modules so @actiondock/sdk is resolvable
    const rootNodeModules = resolve(__dirname, "../../../node_modules");
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
    expect(existsSync(join(tempDir, "package.json"))).toBe(true);
    expect(existsSync(join(tempDir, "actions", "greet.ts"))).toBe(true);
    expect(existsSync(join(tempDir, "playbooks", "greet-user.md"))).toBe(true);

    const config = loadProjectConfig(tempDir);
    expect(config.id).toBe("org.test-project");
    expect(config.name).toBe("Test Project");

    const actionFiles = discoverActionFiles(tempDir, config.actionsDir);
    expect(actionFiles.length).toBe(1);

    const actions = await loadActions(tempDir, config.actionsDir);
    expect(actions.size).toBe(1);
    expect(actions.has("sample.greet")).toBe(true);

    const playbooks = loadPlaybooks(tempDir, config.playbooksDir);
    expect(playbooks.size).toBe(1);
    expect(playbooks.has("greet-user")).toBe(true);
    expect(playbooks.get("greet-user")?.actions).toEqual(["sample.greet"]);
  });

  it("parses playbook markdown frontmatter correctly", () => {
    const raw = `---
id: deploy-service
description: Deploy service to production
actions:
  - k8s.apply
  - health.check
---

# Deploy Service SOP

Follow these steps carefully.
`;
    const pb = parsePlaybookContent(raw, "/path/deploy-service.md");
    expect(pb.id).toBe("deploy-service");
    expect(pb.description).toBe("Deploy service to production");
    expect(pb.actions).toEqual(["k8s.apply", "health.check"]);
    expect(pb.content).toContain("# Deploy Service SOP");

    // Windows backslash path fallback test
    const winPb = parsePlaybookContent("# Just content", "C:\\Users\\dev\\playbooks\\quick-start.md");
    expect(winPb.id).toBe("quick-start");
  });

  it("handles ensureProjectDependencies correctly", () => {
    // If no package.json, returns false
    const emptyDir = mkdtempSync(join(tmpdir(), "empty-pkg-"));
    try {
      expect(ensureProjectDependencies(emptyDir)).toBe(false);

      // If package.json exists but node_modules exists, returns false (fast path)
      writeFileSync(
        join(tempDir, "package.json"),
        JSON.stringify({ name: "test", dependencies: { yaml: "^2.7.0" } })
      );
      // node_modules already symlinked in beforeEach, so returns false
      expect(ensureProjectDependencies(tempDir)).toBe(false);
    } finally {
      rmSync(emptyDir, { recursive: true, force: true });
    }
  });

  it("computes dependency fingerprint and detects version changes", () => {
    const emptyDir = mkdtempSync(join(tmpdir(), "empty-fingerprint-"));
    try {
      expect(computeDependencyFingerprint(emptyDir)).toBeNull();

      const pkgPath = join(emptyDir, "package.json");
      writeFileSync(
        pkgPath,
        JSON.stringify({
          name: "demo",
          version: "1.0.0",
          dependencies: { yaml: "^2.7.0" },
        })
      );
      const fp1 = computeDependencyFingerprint(emptyDir);
      expect(fp1).toBeTruthy();

      // Irrelevant field changes do not alter dependency fingerprint
      writeFileSync(
        pkgPath,
        JSON.stringify({
          name: "demo-renamed",
          version: "1.0.1",
          description: "different description",
          dependencies: { yaml: "^2.7.0" },
        })
      );
      const fp1Same = computeDependencyFingerprint(emptyDir);
      expect(fp1Same).toBe(fp1);

      // Reordering dependency keys does not alter fingerprint (deterministic key sorting)
      writeFileSync(
        pkgPath,
        JSON.stringify({
          name: "demo",
          dependencies: { yaml: "^2.7.0", axios: "^1.0.0" },
        })
      );
      const fpOrder1 = computeDependencyFingerprint(emptyDir);

      writeFileSync(
        pkgPath,
        JSON.stringify({
          name: "demo",
          dependencies: { axios: "^1.0.0", yaml: "^2.7.0" },
        })
      );
      const fpOrder2 = computeDependencyFingerprint(emptyDir);
      expect(fpOrder2).toBe(fpOrder1);

      // Upgraded dependency version alters fingerprint
      writeFileSync(
        pkgPath,
        JSON.stringify({
          name: "demo-renamed",
          dependencies: { yaml: "^2.8.0" },
        })
      );
      const fp2 = computeDependencyFingerprint(emptyDir);
      expect(fp2).not.toBe(fp1);

      // Lockfile changes alter fingerprint
      writeFileSync(join(emptyDir, "package-lock.json"), JSON.stringify({ lockfileVersion: 3 }));
      const fp3 = computeDependencyFingerprint(emptyDir);
      expect(fp3).not.toBe(fp2);
    } finally {
      rmSync(emptyDir, { recursive: true, force: true });
    }
  });

  it("reads and saves dependency fingerprint in cache", () => {
    saveDependencyFingerprint(tempDir, "sample-fingerprint-hash");
    expect(readStoredDependencyFingerprint(tempDir)).toBe("sample-fingerprint-hash");
  });

  it("detects dependency changes and records fingerprint during ensureProjectDependencies", () => {
    writeFileSync(
      join(tempDir, "package.json"),
      JSON.stringify({ name: "test-pkg", dependencies: { yaml: "^2.7.0" } })
    );

    // First call saves fingerprint and returns false (existing node_modules trusted)
    expect(ensureProjectDependencies(tempDir)).toBe(false);
    const initialFp = readStoredDependencyFingerprint(tempDir);
    expect(initialFp).toBe(computeDependencyFingerprint(tempDir));

    // Second call with same dependencies returns false immediately
    expect(ensureProjectDependencies(tempDir)).toBe(false);

    // When ACTIONDOCK_AUTO_INSTALL is false, returns false even if fingerprint changes
    const oldEnv = process.env.ACTIONDOCK_AUTO_INSTALL;
    try {
      process.env.ACTIONDOCK_AUTO_INSTALL = "false";
      saveDependencyFingerprint(tempDir, "stale-outdated-hash");
      expect(ensureProjectDependencies(tempDir)).toBe(false);
    } finally {
      if (oldEnv === undefined) {
        delete process.env.ACTIONDOCK_AUTO_INSTALL;
      } else {
        process.env.ACTIONDOCK_AUTO_INSTALL = oldEnv;
      }
    }
  });
});
