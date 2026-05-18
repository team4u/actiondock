import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  buildScriptDiff,
  buildPublishScriptDiff,
  buildPublishDiffTarget,
  toDiffTarget
} from "./scriptDiff";
import { MetadataDiffViewer } from "../components/diff/MetadataDiffViewer";
import type { ScriptDefinition } from "../shared/types";

function script(overrides: Partial<ScriptDefinition> = {}): ScriptDefinition {
  return {
    id: "user-query",
    name: "User Query",
    type: "GROOVY",
    packaging: "TOOL",
    source: "return [message: 'ok']",
    pythonRequirements: "requests==2.31.0",
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
    published: {
      scriptId: "user-query",
      revisionId: "rev-1",
      version: 2,
      publishedAt: "2026-04-30T10:00:00",
      name: "User Query",
      type: "GROOVY",
      packaging: "TOOL",
      source: "return [message: 'ok']",
      pythonRequirements: "requests==2.31.0",
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
      scriptDependencies: []
    },
    publication: {
      published: true,
      dirty: false,
      publishedVersion: 2,
      publishedAt: "2026-04-30T10:00:00"
    },
    version: 2,
    scriptDependencies: [],
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
        dependencyType: "PLUGIN",
        dependencyId: "user-plugin",
        versionRange: ">= 1.0.0",
        requiredActions: ["query"],
        risk: "MEDIUM"
      }
    ]);
    expect(diff.dependencies.modified).toEqual([
      {
        dependencyType: "PLUGIN",
        dependencyId: "email-plugin",
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

  it("detects publish metadata and dependency changes", () => {
    const diff = buildScriptDiff(
      toDiffTarget(
        script({
          packaging: "TOOL",
          pluginDependencies: [
            {
              pluginId: "email-plugin",
              versionRange: ">= 1.0.0",
              requiredActions: ["send"]
            }
          ]
        })
      ),
      buildPublishDiffTarget({
        name: "User Query",
        type: "GROOVY",
        packaging: "FLOW",
        source: "return [message: 'ok']",
        inputSchema: script().inputSchema,
        outputSchema: script().outputSchema,
        description: "Updated docs",
        owner: "platform",
        tags: ["demo"],
        scriptDependencies: [],
        pluginDependencies: [
          {
            pluginId: "email-plugin",
            versionRange: ">= 2.0.0",
            requiredActions: ["send", "render"]
          }
        ]
      }),
      { context: "publish" }
    );

    expect(diff.metadata.changed).toBe(true);
    expect(diff.metadata.changes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: "packaging" }),
        expect.objectContaining({ field: "owner" }),
        expect.objectContaining({ field: "tags" })
      ])
    );
    expect(diff.dependencies.changed).toBe(true);
    expect(diff.dependencies.available).toBe(true);
  });

  it("treats empty python requirements values as equivalent for groovy import diff", () => {
    const diff = buildScriptDiff(
      toDiffTarget(script({ pythonRequirements: undefined })),
      toDiffTarget(script({ pythonRequirements: "   " })),
      { context: "import" }
    );

    expect(diff.metadata.changed).toBe(false);
    expect(diff.metadata.changes).toEqual([]);
  });

  it("keeps python requirements visible when script type changes to python", () => {
    const diff = buildScriptDiff(
      toDiffTarget(script({ type: "GROOVY", pythonRequirements: undefined })),
      toDiffTarget(
        script({
          type: "PYTHON",
          source: "return {'message': 'ok'}",
          pythonRequirements: "requests==2.32.3"
        })
      ),
      { context: "import" }
    );

    expect(diff.metadata.changes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: "type" }),
        expect.objectContaining({
          field: "pythonRequirements",
          before: undefined,
          after: "requests==2.32.3"
        })
      ])
    );
  });

  it("treats script dependency ids with different installed prefixes as the same target", () => {
    const diff = buildScriptDiff(
      toDiffTarget(
        script({
          scriptDependencies: [
            {
              scriptId: "child",
              repositoryId: "repo-a",
              repositoryScriptId: "child-tool",
              versionRange: ">= 1.0.0"
            }
          ]
        })
      ),
      buildPublishDiffTarget({
        name: "User Query",
        type: "GROOVY",
        packaging: "TOOL",
        source: "return [message: 'ok']",
        inputSchema: script().inputSchema,
        outputSchema: script().outputSchema,
        scriptDependencies: [
          {
            scriptId: "repo-a.child-tool",
            repositoryId: "repo-a",
            repositoryScriptId: "child-tool",
            versionRange: ">= 1.0.0"
          }
        ]
      }),
      { context: "publish" }
    );

    expect(diff.dependencies.changed).toBe(false);
    expect(diff.dependencies.unchanged).toEqual([
      {
        dependencyType: "SCRIPT",
        dependencyId: "repo-a.child-tool",
        target: "repo-a/child-tool",
        versionRange: ">= 1.0.0",
        requiredActions: [],
        risk: "LOW"
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
    const current = script({ published: null, publication: { published: false, dirty: false } });
    const diff = buildPublishScriptDiff(
      current,
      buildPublishDiffTarget({
        name: current.name,
        type: current.type,
        packaging: current.packaging,
        source: current.source,
        inputSchema: current.inputSchema,
        outputSchema: current.outputSchema
      })
    );

    expect(diff.comparisonMode).toBe("INITIAL");
    expect(diff.riskLevel).toBe("LOW");
    expect(diff.highlights[0]).toContain("首次发布");
  });

  it("reports no changes when publish target matches the published snapshot", () => {
    const current = script({
      description: "draft desc",
      owner: "draft-owner",
      tags: ["draft"],
      pluginDependencies: [
        {
          pluginId: "draft-plugin",
          versionRange: ">= 9.9.9",
          requiredActions: ["draft"]
        }
      ],
      published: {
        scriptId: "user-query",
        revisionId: "rev-1",
        version: 2,
        publishedAt: "2026-04-30T10:00:00",
        name: "User Query",
        type: "GROOVY",
        packaging: "TOOL",
        source: "return [message: 'ok']",
        pythonRequirements: "requests==2.31.0",
        description: "published desc",
        owner: "platform",
        tags: ["demo"],
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
        scriptDependencies: [],
        pluginDependencies: [
          {
            pluginId: "email-plugin",
            versionRange: ">= 1.0.0",
            requiredActions: ["send"]
          }
        ],
        aiDependencies: [
          {
            capability: "CHAT",
            required: true
          }
        ]
      },
      publication: {
        published: true,
        dirty: false,
        publishedVersion: 2,
        publishedAt: "2026-04-30T10:00:00"
      }
    });

    const diff = buildPublishScriptDiff(
      current,
      buildPublishDiffTarget({
        name: current.name,
        type: current.type,
        packaging: current.packaging,
        source: current.source,
        pythonRequirements: current.pythonRequirements,
        inputSchema: current.inputSchema,
        outputSchema: current.outputSchema,
        description: current.published?.description,
        owner: current.published?.owner,
        tags: current.published?.tags,
        scriptDependencies: current.scriptDependencies,
        pluginDependencies: current.published?.pluginDependencies,
        aiDependencies: ["CHAT:::required"]
      })
    );

    expect(diff.hasChanges).toBe(false);
    expect(diff.comparisonMode).toBe("COMPARE");
    expect(diff.metadata.changed).toBe(false);
  });

  it("treats empty metadata text values as equivalent when publishing", () => {
    const current = script({
      description: "draft desc",
      owner: "draft-owner",
      tags: ["draft"],
      published: {
        scriptId: "user-query",
        revisionId: "rev-1",
        version: 2,
        publishedAt: "2026-04-30T10:00:00",
        name: "User Query",
        type: "GROOVY",
        packaging: "TOOL",
        source: "return [message: 'ok']",
        pythonRequirements: null as unknown as string,
        description: null as unknown as string,
        owner: "   " as unknown as string,
        tags: [],
        inputSchema: script().inputSchema,
        outputSchema: script().outputSchema
      },
      publication: {
        published: true,
        dirty: false,
        publishedVersion: 2,
        publishedAt: "2026-04-30T10:00:00"
      }
    });

    const diff = buildPublishScriptDiff(
      current,
      buildPublishDiffTarget({
        name: current.name,
        type: current.type,
        packaging: current.packaging,
        source: current.source,
        pythonRequirements: "   ",
        inputSchema: current.inputSchema,
        outputSchema: current.outputSchema,
        description: "",
        owner: undefined,
        tags: []
      })
    );

    expect(diff.metadata.changed).toBe(false);
    expect(diff.metadata.changes).toEqual([]);
  });

  it("detects python requirements and ai dependency publish changes", () => {
    const current = script({
      type: "PYTHON",
      source: "return {'message': 'ok'}",
      published: {
        scriptId: "user-query",
        revisionId: "rev-1",
        version: 2,
        publishedAt: "2026-04-30T10:00:00",
        name: "User Query",
        type: "PYTHON",
        packaging: "TOOL",
        source: "return {'message': 'ok'}",
        pythonRequirements: "requests==2.30.0",
        inputSchema: script().inputSchema,
        outputSchema: script().outputSchema,
        aiDependencies: [{ capability: "CHAT", profile: "", agentProfile: "", required: true }]
      },
      publication: {
        published: true,
        dirty: false,
        publishedVersion: 2,
        publishedAt: "2026-04-30T10:00:00"
      }
    });

    const diff = buildPublishScriptDiff(
      current,
      buildPublishDiffTarget({
        name: current.name,
        type: current.type,
        packaging: current.packaging,
        source: current.source,
        pythonRequirements: "requests==2.31.0",
        inputSchema: current.inputSchema,
        outputSchema: current.outputSchema,
        aiDependencies: ["AGENT_RUN:::required"]
      })
    );

    expect(diff.metadata.changed).toBe(true);
    expect(diff.metadata.changes).toEqual(
      expect.arrayContaining([expect.objectContaining({ field: "pythonRequirements" })])
    );
    expect(diff.dependencies.changed).toBe(true);
    expect(diff.dependencies.added).toEqual(
      expect.arrayContaining([expect.objectContaining({ dependencyId: "AI:AGENT_RUN:::required" })])
    );
    expect(diff.dependencies.removed).toEqual(
      expect.arrayContaining([expect.objectContaining({ dependencyId: "AI:CHAT:::required" })])
    );
  });
});

describe("MetadataDiffViewer", () => {
  it("renders null metadata values as empty placeholders", () => {
    const html = renderToStaticMarkup(
      createElement(MetadataDiffViewer, {
        diff: {
          available: true,
          changed: true,
          risk: "LOW",
          changes: [
            {
              field: "description",
              label: "说明",
              before: null,
              after: undefined,
              risk: "LOW"
            }
          ]
        }
      })
    );

    expect(html).not.toContain(">null<");
    expect(html).toContain(">-<");
  });
});
