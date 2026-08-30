import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { initProject } from "../src/project/init";
import {
  discoverActionFiles,
  loadActions,
  loadPlaybooks,
  loadProjectConfig,
  parsePlaybookContent,
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
  });
});
