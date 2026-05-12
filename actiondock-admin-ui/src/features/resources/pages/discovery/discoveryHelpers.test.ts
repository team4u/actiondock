import { describe, expect, it } from "vitest";
import {
  filterRepositoryTools,
  isLockedLocal,
  isTrackedLocal,
  localAssetId
} from "./discoveryHelpers";
import type { RepositoryToolDescriptor } from "../../../../shared/types";

function createTool(overrides: Partial<RepositoryToolDescriptor> = {}): RepositoryToolDescriptor {
  return {
    repositoryId: "repo-a",
    toolId: "tool-a",
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

describe("discoveryHelpers", () => {
  it("filters repository tools by keyword and combined filters", () => {
    const tools = [
      createTool({
        repositoryId: "repo-a",
        toolId: "billing-sync",
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
        toolId: "etl",
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
    expect(result[0]?.toolId).toBe("billing-sync");
  });

  it("derives local asset mode and local asset id", () => {
    const tracked = createTool({
      toolId: "remote-id",
      localState: {
        mode: "TRACKED",
        localAssetId: "local-copy",
        updateAvailable: false
      }
    });
    const remoteOnly = createTool({ toolId: "remote-only", localState: undefined });

    expect(localAssetId(tracked)).toBe("local-copy");
    expect(isTrackedLocal(tracked)).toBe(true);
    expect(isLockedLocal(tracked)).toBe(false);
    expect(localAssetId(remoteOnly)).toBe("remote-only");
    expect(isTrackedLocal(remoteOnly)).toBe(false);
    expect(isLockedLocal(remoteOnly)).toBe(false);
  });
});
