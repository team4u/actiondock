import { describe, expect, it } from "vitest";
import { capabilityToScriptDefinition } from "./capabilities";

describe("capabilityToScriptDefinition", () => {
  it("treats published scripts without metadata noise as unchanged", () => {
    const script = capabilityToScriptDefinition({
      id: "hello-groovy",
      name: "Hello Groovy",
      runtime: "GROOVY",
      source: "return [message: 'draft']",
      version: 3,
      scope: "PERSONAL",
      hasUnpublishedChanges: false,
      draftBinding: {
        version: "3",
        name: "Hello Groovy",
        source: "return [message: 'draft']",
        runtime: "GROOVY",
        inputSchema: { type: "object" },
        outputSchema: { type: "object" },
        packaging: "TOOL",
        scriptDependencies: []
      },
      publishedBinding: {
        name: "Hello Groovy",
        source: "return [message: 'draft']",
        runtime: "GROOVY",
        inputSchema: { type: "object" },
        outputSchema: { type: "object" },
        packaging: "TOOL",
        scriptDependencies: []
      }
    } as any);

    expect(script.hasUnpublishedChanges).toBe(false);
  });

  it("uses published binding fields for published view", () => {
    const script = capabilityToScriptDefinition({
      id: "hello-groovy",
      name: "Draft Name",
      hasUnpublishedChanges: true,
      draftBinding: {
        name: "Draft Name",
        source: "return [message: 'draft']",
        runtime: "GROOVY",
        packaging: "TOOL",
        pythonRequirements: "requests==2.31.0",
        description: "draft desc",
        owner: "alice",
        tags: ["draft"],
        inputSchema: { type: "object" },
        outputSchema: { type: "object" },
        pluginDependencies: [{ pluginId: "email-plugin", requiredActions: ["send"] }],
        aiDependencies: [{ capability: "CHAT", required: true }]
      },
      publishedBinding: {
        name: "Published Name",
        source: "return [message: 'live']",
        runtime: "PYTHON",
        packaging: "FLOW",
        pythonRequirements: "requests==2.30.0",
        description: "published desc",
        owner: "platform",
        tags: ["stable"],
        inputSchema: { type: "object" },
        outputSchema: { type: "object" },
        pluginDependencies: [{ pluginId: "email-plugin", requiredActions: ["send"] }],
        aiDependencies: [{ capability: "CHAT", required: true }]
      }
    } as any, "published");

    expect(script.name).toBe("Published Name");
    expect(script.type).toBe("PYTHON");
    expect(script.packaging).toBe("FLOW");
    expect(script.pythonRequirements).toBe("requests==2.30.0");
    expect(script.publishedSnapshot?.description).toBe("published desc");
    expect(script.publishedSnapshot?.owner).toBe("platform");
    expect(script.publishedSnapshot?.tags).toEqual(["stable"]);
    expect(script.hasUnpublishedChanges).toBe(true);
  });
});
