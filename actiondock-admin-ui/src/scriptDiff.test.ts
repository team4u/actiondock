import { describe, expect, it } from "vitest";
import { buildScriptDiff, buildPublishScriptDiff, buildPublishDiffTarget, toDiffTarget } from "./scriptDiff";
import type { ScriptDefinition } from "./types";

function script(overrides: Partial<ScriptDefinition> = {}): ScriptDefinition {
  return {
    id: "user-query",
    name: "User Query",
    type: "GROOVY",
    packaging: "TOOL",
    source: "return [message: 'ok']",
    inputSchema: {
      type: "object",
      properties: {
        region: { type: "string" }
      }
    },
    outputSchema: {
      type: "object",
      properties: {
        message: { type: "string" }
      }
    },
    status: "PUBLISHED",
    version: 2,
    ...overrides
  };
}

describe("buildScriptDiff", () => {
  it("marks input optional to required as high risk", () => {
    const base = toDiffTarget(script());
    const target = toDiffTarget(
      script({
        inputSchema: {
          type: "object",
          required: ["region"],
          properties: {
            region: { type: "string" }
          }
        }
      })
    );

    const diff = buildScriptDiff(base, target, { context: "import" });

    expect(diff.riskLevel).toBe("HIGH");
    expect(diff.inputSchema.modifiedFields).toEqual([
      {
        name: "region",
        changes: [
          {
            property: "required",
            before: false,
            after: true,
            risk: "HIGH"
          }
        ]
      }
    ]);
  });

  it("marks source keyword changes as high risk", () => {
    const diff = buildScriptDiff(
      toDiffTarget(script()),
      toDiffTarget(
        script({
          source: "delete from user_table\nreturn [message: 'done']"
        })
      ),
      { context: "import" }
    );

    expect(diff.source.risk).toBe("HIGH");
    expect(diff.source.matchedHighRiskKeywords).toContain("delete");
  });

  it("detects import dependency changes", () => {
    const diff = buildScriptDiff(
      toDiffTarget(
        script({
          pluginDependencies: [
            {
              pluginId: "email-plugin",
              versionRange: ">= 1.0.0",
              requiredActions: ["send"]
            }
          ]
        })
      ),
      toDiffTarget(
        script({
          pluginDependencies: [
            {
              pluginId: "email-plugin",
              versionRange: ">= 2.0.0",
              requiredActions: ["send", "render"]
            },
            {
              pluginId: "user-plugin",
              versionRange: ">= 1.0.0",
              requiredActions: ["query"]
            }
          ]
        })
      ),
      { context: "import" }
    );

    expect(diff.dependencies.changed).toBe(true);
    expect(diff.dependencies.added).toEqual([
      {
        pluginId: "user-plugin",
        versionRange: ">= 1.0.0",
        requiredActions: ["query"],
        risk: "MEDIUM"
      }
    ]);
    expect(diff.dependencies.modified).toEqual([
      {
        pluginId: "email-plugin",
        changes: [
          {
            field: "versionRange",
            before: ">= 1.0.0",
            after: ">= 2.0.0",
            risk: "MEDIUM"
          },
          {
            field: "requiredActions",
            before: ["send"],
            after: ["render", "send"],
            risk: "LOW"
          }
        ]
      }
    ]);
  });

  it("warns when schema contains nested unsupported structure", () => {
    const diff = buildScriptDiff(
      toDiffTarget(script()),
      toDiffTarget(
        script({
          inputSchema: {
            type: "object",
            properties: {
              profile: {
                type: "object",
                properties: {
                  city: { type: "string" }
                }
              }
            }
          }
        })
      ),
      { context: "import" }
    );

    expect(diff.inputSchema.fallbackToRaw).toBe(true);
    expect(diff.inputSchema.warnings[0]).toContain("复杂字段");
  });
});

describe("buildPublishScriptDiff", () => {
  it("treats scripts without published snapshot as initial publish", () => {
    const current = script({ status: "DRAFT", publishedSnapshot: undefined });
    const diff = buildPublishScriptDiff(
      current,
      buildPublishDiffTarget({
        name: current.name,
        type: current.type,
        source: current.source,
        inputSchema: current.inputSchema,
        outputSchema: current.outputSchema
      })
    );

    expect(diff.comparisonMode).toBe("INITIAL");
    expect(diff.riskLevel).toBe("LOW");
    expect(diff.highlights[0]).toContain("首次发布");
  });
});
