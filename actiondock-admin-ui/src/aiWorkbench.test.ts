import { describe, expect, it } from "vitest";
import { parseGeneratedScriptText } from "./generatedScript";
import {
  buildWorkbenchExecutionPrefill,
  buildGeneratedScriptImportText,
  buildWorkbenchReleaseNotesDraft,
  buildWorkbenchSchemaPatchApplication,
  buildWorkbenchScriptPatchApplication,
  normalizeWorkbenchTask,
  workbenchResultCopyText
} from "./aiWorkbench";
import type { AiWorkbenchResult } from "./types";
import { applyJsonMergePatch } from "./workbenchSession";

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

  it("builds script patch application payload from structured result", () => {
    const payload = buildWorkbenchScriptPatchApplication({
      taskType: "IMPROVE_SCRIPT",
      status: "SUCCESS",
      result: {
        scriptId: "script-1",
        patch: "@@",
        updatedSource: "return [patched: true]"
      },
      agentRunId: "run-1",
      steps: [],
      rawOutput: {}
    });

    expect(payload).toEqual({
      scriptId: "script-1",
      patch: "@@",
      updatedSource: "return [patched: true]",
      rationale: undefined
    });
  });

  it("builds schema patch application payload and merges it with JSON merge patch semantics", () => {
    const payload = buildWorkbenchSchemaPatchApplication("script-1", {
      taskType: "IMPROVE_SCHEMA",
      status: "SUCCESS",
      result: {
        inputSchemaPatch: {
          properties: {
            name: { type: "string", description: "User name" }
          },
          required: ["name"]
        }
      },
      agentRunId: "run-1",
      steps: [],
      rawOutput: {}
    });

    expect(payload?.scriptId).toBe("script-1");
    expect(applyJsonMergePatch(
      { type: "object", properties: {}, required: [] },
      payload?.inputSchemaPatch
    )).toEqual({
      type: "object",
      properties: {
        name: { type: "string", description: "User name" }
      },
      required: ["name"]
    });
  });

  it("builds release notes and execution prefill payloads", () => {
    expect(buildWorkbenchReleaseNotesDraft("script-1", {
      taskType: "GENERATE_RELEASE_NOTES",
      status: "SUCCESS",
      result: { notes: "## Changes" },
      agentRunId: "run-1",
      steps: [],
      rawOutput: {}
    })).toEqual({
      scriptId: "script-1",
      notes: "## Changes"
    });

    expect(buildWorkbenchExecutionPrefill("script-1", { name: "Alice" }, "失败执行")).toEqual({
      scriptId: "script-1",
      input: { name: "Alice" },
      sourceLabel: "失败执行"
    });
  });
});
