import { describe, expect, it } from "vitest";
import { parseGeneratedScriptText } from "./generatedScript";
import {
  buildGeneratedScriptImportText,
  normalizeWorkbenchTask,
  workbenchResultCopyText
} from "./aiWorkbench";
import type { AiWorkbenchResult } from "./types";

describe("aiWorkbench helpers", () => {
  it("normalizes unknown task query values to generate", () => {
    expect(normalizeWorkbenchTask("diagnose")).toBe("diagnose");
    expect(normalizeWorkbenchTask("unknown")).toBe("generate");
    expect(normalizeWorkbenchTask(null)).toBe("generate");
  });

  it("builds generated script text compatible with parseGeneratedScriptText", () => {
    const text = buildGeneratedScriptImportText({
      id: "hello-ai",
      name: "Hello AI",
      source: "return [message: input.name]",
      inputSchema: { type: "object", properties: { name: { type: "string" } } },
      outputSchema: { type: "object", properties: { message: { type: "string" } } }
    });

    const parsed = parseGeneratedScriptText(text);

    expect(parsed.id).toBe("hello-ai");
    expect(parsed.name).toBe("Hello AI");
    expect(parsed.source).toContain("return [message");
    expect(parsed.inputSchemaText).toContain("\"name\"");
  });

  it("uses release notes text directly for copying", () => {
    const result: AiWorkbenchResult = {
      taskType: "GENERATE_RELEASE_NOTES",
      status: "SUCCESS",
      result: { notes: "Ship it" },
      agentRunId: "run-1",
      steps: [],
      rawOutput: {}
    };

    expect(workbenchResultCopyText("releaseNotes", result)).toBe("Ship it");
  });
});
