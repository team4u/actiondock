import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  filterRepositoryTools,
  isLockedLocal,
  isTrackedLocal,
  localAssetId,
  renderPluginDependencies,
  renderScriptDependencies
} from "./discoveryHelpers";
import type { RepositoryPluginDescriptor, RepositoryScriptDescriptor } from "../../../../shared/types";

function createTool(overrides: Partial<RepositoryScriptDescriptor> = {}): RepositoryScriptDescriptor {
  return {
    repositoryId: "repo-a",
    scriptId: "tool-a",
    displayName: "Alpha Tool",
    version: "1.0.0",
    tags: [],
    type: "GROOVY",
    packaging: "TOOL",
    sourcePath: "tools/tool-a/main.groovy",
    scriptDependencies: [],
    pluginDependencies: [],
    trusted: true,
    ...overrides
  };
}

function createPlugin(overrides: Partial<RepositoryPluginDescriptor> = {}): RepositoryPluginDescriptor {
  return {
    repositoryId: "repo-a",
    pluginId: "plugin-a",
    displayName: "Alpha Plugin",
    version: "1.0.0",
    tags: [],
    artifact: {
      uri: "file:///plugins/plugin-a.zip"
    },
    installed: false,
    updateAvailable: false,
    trusted: true,
    dependentToolCount: 0,
    ...overrides
  };
}

describe("discoveryHelpers", () => {
  it("filters repository tools by keyword and combined filters", () => {
    const tools = [
      createTool({
        repositoryId: "repo-a",
        scriptId: "billing-sync",
        displayName: "Billing Sync",
        owner: "ops",
        localState: {
          mode: "LOCKED",
          localAssetId: "billing-sync",
          version: "1.0.0",
          latestVersion: "1.1.0",
          updateAvailable: true
        }
      }),
      createTool({
        repositoryId: "repo-b",
        scriptId: "etl",
        displayName: "Data ETL",
        type: "PYTHON",
        trusted: false
      })
    ];

    const result = filterRepositoryTools(tools, {
      searchText: "billing ops",
      repositoryFilter: "repo-a",
      typeFilter: "GROOVY",
      installFilter: "INSTALLED",
      trustFilter: "TRUSTED"
    });

    expect(result).toHaveLength(1);
    expect(result[0]?.scriptId).toBe("billing-sync");
  });

  it("derives local asset mode and local asset id", () => {
    const tracked = createTool({
      scriptId: "remote-id",
      localState: {
        mode: "TRACKED",
        localAssetId: "local-copy",
        updateAvailable: false
      }
    });
    const remoteOnly = createTool({ scriptId: "remote-only", localState: undefined });

    expect(localAssetId(tracked)).toBe("local-copy");
    expect(isTrackedLocal(tracked)).toBe(true);
    expect(isLockedLocal(tracked)).toBe(false);
    expect(localAssetId(remoteOnly)).toBe("remote-only");
    expect(isTrackedLocal(remoteOnly)).toBe(false);
    expect(isLockedLocal(remoteOnly)).toBe(false);
  });

  it("renders script dependencies with resolved names and fallback ids", () => {
    const html = renderToStaticMarkup(
      renderScriptDependencies([
        { scriptId: "billing-sync", repositoryId: "repo-a", repositoryScriptId: "billing-sync", versionRange: ">= 1.2.0" },
        { scriptId: "orphan-task", repositoryId: "repo-b", repositoryScriptId: "orphan-task" }
      ], {
        currentRepositoryId: "repo-a",
        availableTools: [
          createTool({
            repositoryId: "repo-a",
            scriptId: "billing-sync",
            displayName: "Billing Sync"
          })
        ]
      })
    );

    expect(html).toContain("Billing Sync");
    expect(html).toContain("billing-sync");
    expect(html).toContain("repo-a/billing-sync");
    expect(html).toContain("&gt;= 1.2.0");
    expect(html).toContain("orphan-task");
    expect(html).toContain("repo-b/orphan-task");
  });

  it("renders plugin dependencies with resolved names and fallback ids", () => {
    const html = renderToStaticMarkup(
      renderPluginDependencies([
        { pluginId: "plugin-a", versionRange: ">= 2.0.0", requiredActions: ["run"] },
        { pluginId: "missing-plugin", requiredActions: [] }
      ], {
        currentRepositoryId: "repo-a",
        availablePlugins: [
          createPlugin({
            repositoryId: "repo-a",
            pluginId: "plugin-a",
            displayName: "Alpha Plugin"
          })
        ]
      })
    );

    expect(html).toContain("Alpha Plugin");
    expect(html).toContain("plugin-a");
    expect(html).toContain("&gt;= 2.0.0");
    expect(html).toContain("run");
    expect(html).toContain("missing-plugin");
    expect(html).toContain("未声明");
  });
});
