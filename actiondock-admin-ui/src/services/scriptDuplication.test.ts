import { describe, expect, it } from "vitest";
import { buildDuplicatedScriptDefinition, suggestDuplicateScriptId } from "./scriptDuplication";
import type { ScriptDefinition } from "../shared/types";

function buildScriptDefinition(): ScriptDefinition {
  return {
    id: "hello-groovy",
    name: "Hello Groovy",
    type: "GROOVY",
    packaging: "FLOW",
    source: "return [message: 'hello']",
    inputSchema: {
      type: "object",
      properties: {
        name: {
          type: "string"
        }
      }
    },
    outputSchema: {
      type: "object",
      properties: {
        message: {
          type: "string"
        }
      }
    },
    published: null,
    publication: {
      published: false,
      dirty: false
    },
    version: 7,
    createdAt: "2024-01-02T03:04:05",
    updatedAt: "2024-01-03T04:05:06"
  };
}

describe("script duplication helpers", () => {
  it("suggests a copy id and increments the suffix when needed", () => {
    expect(suggestDuplicateScriptId("hello-groovy", [])).toBe("hello-groovy-copy");
    expect(suggestDuplicateScriptId("hello-groovy", ["hello-groovy-copy"])).toBe("hello-groovy-copy-2");
    expect(
      suggestDuplicateScriptId("hello-groovy", [
        "hello-groovy-copy",
        "hello-groovy-copy-2"
      ])
    ).toBe("hello-groovy-copy-3");
  });

  it("builds a new draft definition without carrying published metadata", () => {
    const duplicated = buildDuplicatedScriptDefinition(buildScriptDefinition(), ["hello-groovy"]);

    expect(duplicated).toEqual({
      id: "hello-groovy-copy",
      name: "Hello Groovy 副本",
      type: "GROOVY",
      packaging: "FLOW",
      source: "return [message: 'hello']",
      inputSchema: {
        type: "object",
        properties: {
          name: {
            type: "string"
          }
        }
      },
      outputSchema: {
        type: "object",
        properties: {
          message: {
            type: "string"
          }
        }
      },
      publication: {
        published: false,
        dirty: false
      },
      version: 1
    });
    expect(duplicated).not.toHaveProperty("published");
    expect(duplicated).not.toHaveProperty("createdAt");
    expect(duplicated).not.toHaveProperty("updatedAt");
  });

  it("clones schemas so edits to the duplicate do not mutate the source", () => {
    const source = buildScriptDefinition();
    const duplicated = buildDuplicatedScriptDefinition(source, []);

    (duplicated.inputSchema.properties as Record<string, unknown>).name = { type: "integer" };

    expect(source.inputSchema).toEqual({
      type: "object",
      properties: {
        name: {
          type: "string"
        }
      }
    });
  });
});
