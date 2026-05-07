import { describe, expect, it } from "vitest";
import {
  deserializeSchema,
  resolveSchemaFields,
  serializeSchemaEditorState
} from "../services/schema";

describe("schema rich widgets", () => {
  it("normalizes json widgets to code while preserving markdown and code", () => {
    const schema = {
      type: "object",
      properties: {
        summary: {
          type: "string",
          title: "Summary",
          "x-ui": { widget: "markdown" }
        },
        payload: {
          type: "string",
          title: "Payload",
          "x-ui": { widget: "json", rows: 8 }
        },
        script: {
          type: "string",
          title: "Script",
          "x-ui": { widget: "code", language: "python", rows: 12 }
        }
      }
    };

    const state = deserializeSchema(schema);
    expect(state.mode).toBe("builder");

    if (state.mode !== "builder") {
      throw new Error("expected builder state");
    }

    expect(state.fields.map((field) => field.widget)).toEqual(["markdown", "code", "code"]);
    expect(state.fields.find((field) => field.name === "payload")?.language).toBe("json");
    expect(state.fields.find((field) => field.name === "script")?.language).toBe("python");

    const serialized = serializeSchemaEditorState(state, "输出结构");
    expect(serialized).toEqual({
      type: "object",
      properties: {
        summary: {
          type: "string",
          title: "Summary",
          "x-ui": { widget: "markdown" }
        },
        payload: {
          type: "string",
          title: "Payload",
          "x-ui": { widget: "code", rows: 8, language: "json" }
        },
        script: {
          type: "string",
          title: "Script",
          "x-ui": { widget: "code", rows: 12, language: "python" }
        }
      }
    });

    const resolved = resolveSchemaFields(serialized);
    expect(resolved.supportedFields.find((field) => field.name === "summary")?.widget).toBe("markdown");
    expect(resolved.supportedFields.find((field) => field.name === "payload")?.widget).toBe("code");
    expect(resolved.supportedFields.find((field) => field.name === "payload")?.language).toBe("json");
    expect(resolved.supportedFields.find((field) => field.name === "script")?.language).toBe("python");
  });
});
