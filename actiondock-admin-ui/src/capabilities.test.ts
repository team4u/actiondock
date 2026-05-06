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
      draftBinding: {
        version: "3",
        source: "return [message: 'draft']",
        runtime: "GROOVY",
        inputSchema: { type: "object" },
        outputSchema: { type: "object" },
        packaging: "TOOL",
        dependencies: []
      },
      publishedBinding: {
        version: "3",
        source: "return [message: 'draft']",
        runtime: "GROOVY",
        inputSchema: { type: "object" },
        outputSchema: { type: "object" },
        packaging: "TOOL",
        dependencies: []
      }
    } as any);

    expect(script.hasUnpublishedChanges).toBe(false);
  });
});
