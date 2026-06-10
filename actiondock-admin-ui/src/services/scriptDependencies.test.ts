import { describe, expect, it } from "vitest";
import { autoMatchScriptDependency, extractScriptDependenciesFromSource, hasDynamicScriptDependencies, normalizeScriptDependencies, resolveAutoScriptDependency } from "./scriptDependencies";
import type { RepositoryDefinition, RepositoryScriptDescriptor } from "../shared/types";

function repository(overrides: Partial<RepositoryDefinition>): RepositoryDefinition {
  return {
    id: "repo",
    name: "Repo",
    type: "GIT",
    url: "https://example.com/repo.git",
    enabled: true,
    trustLevel: "TRUSTED",
    ...overrides
  };
}

function repositoryTool(overrides: Partial<RepositoryScriptDescriptor>): RepositoryScriptDescriptor {
  return {
    repositoryId: "repo",
    scriptId: "child",
    displayName: "Child",
    version: "1.0.0",
    tags: [],
    type: "GROOVY",
    packaging: "TOOL",
    sourcePath: "tools/child/source.groovy",
    scriptDependencies: [],
    pluginDependencies: [],
    trusted: true,
    ...overrides
  };
}

describe("extractScriptDependenciesFromSource", () => {
  it("extracts literal script invoke calls", () => {
    expect(
      extractScriptDependenciesFromSource(`
        return scripts.invoke("child", [name: input.name])
        def other = scripts.invoke('child-two')
        scripts.invoke(scriptId, [dynamic: true])
      `)
    ).toEqual([
      { scriptId: "child" },
      { scriptId: "child-two" }
    ]);
  });
});

describe("hasDynamicScriptDependencies", () => {
  it("detects non-literal script invocations", () => {
    expect(hasDynamicScriptDependencies('return scripts.invoke(scriptId, [name: "x"])')).toBe(true);
    expect(hasDynamicScriptDependencies('return scripts.invoke("child", [name: "x"])')).toBe(false);
  });
});

describe("normalizeScriptDependencies", () => {
  it("trims and removes incomplete items", () => {
    expect(normalizeScriptDependencies([
      { scriptId: " child ", repositoryId: " repo ", repositoryScriptId: " tool ", versionRange: " >= 1.0.0 " },
      { scriptId: "missing", repositoryId: "", repositoryScriptId: "tool" }
    ])).toEqual([
      { scriptId: "child", repositoryId: "repo", repositoryScriptId: "tool", versionRange: ">= 1.0.0" }
    ]);
  });
});

describe("autoMatchScriptDependency", () => {
  it("prefers the selected repository when the tool exists there", () => {
    const repositories = [repository({ id: "a" }), repository({ id: "b" })];
    const repositoryTools = [
      repositoryTool({ repositoryId: "a", version: "1.0.0" }),
      repositoryTool({ repositoryId: "b", version: "2.0.0" })
    ];

    expect(autoMatchScriptDependency("child", repositories, repositoryTools, "b")).toEqual({
      scriptId: "child",
      repositoryId: "b",
      repositoryScriptId: "child",
      versionRange: ">= 2.0.0"
    });
  });

  it("falls back to the first repository that contains the tool", () => {
    const repositories = [repository({ id: "a" }), repository({ id: "b" }), repository({ id: "c" })];
    const repositoryTools = [
      repositoryTool({ repositoryId: "c", version: "3.0.0" }),
      repositoryTool({ repositoryId: "b", scriptId: "other", version: "2.0.0" })
    ];

    expect(autoMatchScriptDependency("child", repositories, repositoryTools, "a")).toEqual({
      scriptId: "child",
      repositoryId: "c",
      repositoryScriptId: "child",
      versionRange: ">= 3.0.0"
    });
  });

  it("returns undefined when no repository contains the tool", () => {
    const repositories = [repository({ id: "a" })];
    const repositoryTools = [repositoryTool({ repositoryId: "a", scriptId: "other" })];

    expect(autoMatchScriptDependency("child", repositories, repositoryTools, "a")).toBeUndefined();
  });
});

describe("resolveAutoScriptDependency", () => {
  it("prefers the target repository over a declared dependency from another repository", () => {
    const repositories = [repository({ id: "target" }), repository({ id: "publisher" })];
    const repositoryTools = [
      repositoryTool({ repositoryId: "target", scriptId: "child", version: "3.0.0" }),
      repositoryTool({ repositoryId: "publisher", scriptId: "child", version: "1.0.0" })
    ];

    expect(resolveAutoScriptDependency({
      scriptId: "child",
      repositories,
      repositoryTools,
      preferredRepositoryId: "target",
      declaredDependency: {
        repositoryId: "publisher",
        repositoryScriptId: "child",
        versionRange: ">= 1.0.0"
      }
    })).toEqual({
      scriptId: "child",
      repositoryId: "target",
      repositoryScriptId: "child",
      versionRange: ">= 3.0.0"
    });
  });

  it("falls back to the declared dependency when the target repository does not contain the tool", () => {
    const repositories = [repository({ id: "target" }), repository({ id: "publisher" })];
    const repositoryTools = [
      repositoryTool({ repositoryId: "publisher", scriptId: "child", version: "1.0.0" })
    ];

    expect(resolveAutoScriptDependency({
      scriptId: "child",
      repositories,
      repositoryTools,
      preferredRepositoryId: "target",
      declaredDependency: {
        repositoryId: "publisher",
        repositoryScriptId: "child",
        versionRange: ">= 1.0.0"
      }
    })).toEqual({
      scriptId: "child",
      repositoryId: "publisher",
      repositoryScriptId: "child",
      versionRange: ">= 1.0.0"
    });
  });

  it("falls back to the local published script source when there is no declared dependency", () => {
    const repositories = [repository({ id: "target" }), repository({ id: "publisher" })];
    const repositoryTools = [
      repositoryTool({ repositoryId: "publisher", scriptId: "child", version: "2.0.0" })
    ];

    expect(resolveAutoScriptDependency({
      scriptId: "child",
      repositories,
      repositoryTools,
      preferredRepositoryId: "target",
      localScriptSource: {
        repositoryId: "publisher",
        repositoryScriptId: "child",
        repositoryVersion: "2.0.0"
      }
    })).toEqual({
      scriptId: "child",
      repositoryId: "publisher",
      repositoryScriptId: "child",
      versionRange: ">= 2.0.0"
    });
  });
});
