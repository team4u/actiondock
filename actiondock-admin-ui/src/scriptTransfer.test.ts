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
            source: "return [message: 'hello']",
            inputSchema: { type: "object", properties: {} },
            outputSchema: { type: "object", properties: {} },
            status: "PUBLISHED",
            version: 3,
            owner: "platform-team",
            description: "demo script",
            tags: ["demo", "ops"],
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
        owner: "platform-team",
        description: "demo script",
        tags: ["demo", "ops"],
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
