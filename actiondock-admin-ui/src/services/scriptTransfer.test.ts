import { describe, expect, it } from "vitest";
import { parseScriptImportBundle } from "./scriptTransfer";

describe("parseScriptImportBundle", () => {
  it("preserves editable metadata and plugin dependencies from imported scripts", () => {
    const scripts = parseScriptImportBundle(
      JSON.stringify({
        version: 1,
        exportedAt: "2026-04-26T12:00:00Z",
        scripts: [
          {
            id: "hello-groovy",
            name: "Hello Groovy",
            type: "GROOVY",
            packaging: "FLOW",
            source: "return [message: 'hello']",
            inputSchema: { type: "object", properties: {} },
            outputSchema: { type: "object", properties: {} },
            version: 3,
            owner: "platform-team",
            description: "demo script",
            tags: ["demo", "ops"],
            scriptDependencies: [
              {
                scriptId: "child",
                repositoryId: "repo-a",
                repositoryScriptId: "child-tool",
                versionRange: ">= 1.0.0"
              }
            ],
            pluginDependencies: [
              {
                pluginId: "email-plugin",
                versionRange: ">= 1.0.0",
                requiredActions: ["send"]
              }
            ]
          }
        ]
      })
    );

    expect(scripts).toEqual([
      expect.objectContaining({
        id: "hello-groovy",
        packaging: "FLOW",
        owner: "platform-team",
        description: "demo script",
        tags: ["demo", "ops"],
        scriptDependencies: [
          {
            scriptId: "child",
            repositoryId: "repo-a",
            repositoryScriptId: "child-tool",
            versionRange: ">= 1.0.0"
          }
        ],
        pluginDependencies: [
          {
            pluginId: "email-plugin",
            versionRange: ">= 1.0.0",
            requiredActions: ["send"]
          }
        ]
      })
    ]);
  });
});
