import { describe, expect, it } from "vitest";
import { extractPluginDependenciesFromSource, resolveEffectivePluginDependencies } from "./pluginDependencies";
import type { PluginDependency, PluginView, RepositoryToolDescriptor, ScriptDefinition } from "../shared/types";

function plugin(pluginId: string, version: string): PluginView {
  return {
    pluginId,
    version,
    name: pluginId,
    description: "",
    started: true,
    state: "STARTED",
    configurable: false,
    actions: []
  };
}

function script(overrides: Partial<ScriptDefinition> = {}): ScriptDefinition {
  return {
    id: "local-tool",
    name: "Local Tool",
    type: "GROOVY",
    packaging: "TOOL",
    source: "",
    inputSchema: {},
    outputSchema: {},
    published: null,
    publication: {
      published: false,
      dirty: false
    },
    version: 1,
    ...overrides
  };
}

function descriptor(pluginDependencies: PluginDependency[]): RepositoryToolDescriptor {
  return {
    repositoryId: "repo",
    scriptId: "tool",
    displayName: "Repository Tool",
    version: "1.0.0",
    tags: [],
    type: "GROOVY",
    packaging: "TOOL",
    sourcePath: "tools/tool/source.groovy",
    scriptDependencies: [],
    pluginDependencies,
    localState: {
      mode: "LOCKED",
      localAssetId: "repo.tool",
      updateAvailable: false
    },
    trusted: true
  };
}

describe("extractPluginDependenciesFromSource", () => {
  it("extracts literal plugin invoke calls with versions and actions", () => {
    const dependencies = extractPluginDependenciesFromSource(
      `
      plugins.invoke("plugin-a", "echo", [message: "hi"])
      plugins.invoke('plugin-a', 'summarize')
      plugins.invoke(input.pluginId, "dynamic")
      plugins.invoke("plugin-b", "run")
      `,
      [plugin("plugin-a", "1.2.3"), plugin("plugin-b", "0.4.0")]
    );

    expect(dependencies).toEqual([
      { pluginId: "plugin-a", versionRange: ">= 1.2.3", requiredActions: ["echo", "summarize"] },
      { pluginId: "plugin-b", versionRange: ">= 0.4.0", requiredActions: ["run"] }
    ]);
  });
});

describe("resolveEffectivePluginDependencies", () => {
  it("prefers repository descriptor dependencies", () => {
    const dependencies = resolveEffectivePluginDependencies(
      script({
        pluginDependencies: [
          { pluginId: "script-plugin", versionRange: ">= 1.0.0", requiredActions: ["run"] }
        ]
      }),
      descriptor([
        { pluginId: "repo-plugin", versionRange: ">= 2.0.0", requiredActions: ["sync"] }
      ]),
      [plugin("source-plugin", "3.0.0")]
    );

    expect(dependencies).toEqual([
      { pluginId: "repo-plugin", versionRange: ">= 2.0.0", requiredActions: ["sync"] }
    ]);
  });

  it("uses saved local script dependencies when no descriptor dependency exists", () => {
    const dependencies = resolveEffectivePluginDependencies(
      script({
        pluginDependencies: [
          { pluginId: "local-plugin", versionRange: ">= 1.0.0", requiredActions: ["run"] }
        ]
      }),
      undefined,
      []
    );

    expect(dependencies).toEqual([
      { pluginId: "local-plugin", versionRange: ">= 1.0.0", requiredActions: ["run"] }
    ]);
  });

  it("falls back to Groovy source detection for unsaved dependencies", () => {
    const dependencies = resolveEffectivePluginDependencies(
      script({ source: 'return plugins.invoke("source-plugin", "run")' }),
      undefined,
      [plugin("source-plugin", "3.0.0")]
    );

    expect(dependencies).toEqual([
      { pluginId: "source-plugin", versionRange: ">= 3.0.0", requiredActions: ["run"] }
    ]);
  });

  it("detects dependencies from Python source too", () => {
    const dependencies = resolveEffectivePluginDependencies(
      script({ type: "PYTHON", source: 'plugins.invoke("source-plugin", "run")' }),
      undefined,
      [plugin("source-plugin", "3.0.0")]
    );

    expect(dependencies).toEqual([
      { pluginId: "source-plugin", versionRange: ">= 3.0.0", requiredActions: ["run"] }
    ]);
  });
});
