import { describe, expect, it } from "vitest";
import { extractPluginDependenciesFromSource } from "./pluginDependencies";

describe("extractPluginDependenciesFromSource", () => {
  it("extracts literal plugin invoke calls with versions and actions", () => {
    const dependencies = extractPluginDependenciesFromSource(
      `
      plugins.invoke("plugin-a", "echo", [message: "hi"])
      plugins.invoke('plugin-a', 'summarize')
      plugins.invoke(input.pluginId, "dynamic")
      plugins.invoke("plugin-b", "run")
      `,
      [
        { pluginId: "plugin-a", version: "1.2.3", name: "Plugin A", description: "", started: true, state: "STARTED", configurable: false, actions: [] },
        { pluginId: "plugin-b", version: "0.4.0", name: "Plugin B", description: "", started: true, state: "STARTED", configurable: false, actions: [] }
      ]
    );

    expect(dependencies).toEqual([
      { pluginId: "plugin-a", versionRange: ">= 1.2.3", requiredActions: ["echo", "summarize"] },
      { pluginId: "plugin-b", versionRange: ">= 0.4.0", requiredActions: ["run"] }
    ]);
  });
});
