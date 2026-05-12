import { describe, expect, it } from "vitest";
import { autoMatchScriptDependency, extractScriptDependenciesFromSource, hasDynamicScriptDependencies, normalizeScriptDependencies } from "./scriptDependencies";
import type { RepositoryDefinition, RepositoryToolDescriptor } from "../shared/types";

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

function repositoryTool(overrides: Partial<RepositoryToolDescriptor>): RepositoryToolDescriptor {
  return {
    repositoryId: "repo",
    toolId: "child",
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
      { scriptId: " child ", repositoryId: " repo ", toolId: " tool ", versionRange: " >= 1.0.0 " },
      { scriptId: "missing", repositoryId: "", toolId: "tool" }
    ])).toEqual([
      { scriptId: "child", repositoryId: "repo", toolId: "tool", versionRange: ">= 1.0.0" }
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
      toolId: "child",
      versionRange: ">= 2.0.0"
    });
  });

  it("falls back to the first repository that contains the tool", () => {
    const repositories = [repository({ id: "a" }), repository({ id: "b" }), repository({ id: "c" })];
    const repositoryTools = [
      repositoryTool({ repositoryId: "c", version: "3.0.0" }),
      repositoryTool({ repositoryId: "b", toolId: "other", version: "2.0.0" })
    ];

    expect(autoMatchScriptDependency("child", repositories, repositoryTools, "a")).toEqual({
      scriptId: "child",
      repositoryId: "c",
      toolId: "child",
      versionRange: ">= 3.0.0"
    });
  });

  it("returns undefined when no repository contains the tool", () => {
    const repositories = [repository({ id: "a" })];
    const repositoryTools = [repositoryTool({ repositoryId: "a", toolId: "other" })];

    expect(autoMatchScriptDependency("child", repositories, repositoryTools, "a")).toBeUndefined();
  });
});
