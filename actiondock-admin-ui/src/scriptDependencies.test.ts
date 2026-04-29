import { describe, expect, it } from "vitest";
import { extractScriptDependenciesFromSource, hasDynamicScriptDependencies, normalizeScriptDependencies } from "./scriptDependencies";

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
