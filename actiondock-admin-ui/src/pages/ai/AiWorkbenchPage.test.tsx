import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { AiWorkbenchResultPanel } from "./AiWorkbenchPage";
import type { AiWorkbenchResult } from "../../types";

vi.mock("../../components/CodeEditor", () => ({
  CodeEditor: ({ value }: { value: string }) => <pre>{value}</pre>
}));

function result(taskType: AiWorkbenchResult["taskType"], payload: Record<string, unknown>): AiWorkbenchResult {
  return {
    taskType,
    status: "SUCCESS",
    result: payload,
    agentRunId: "run-1",
    steps: [],
    rawOutput: {}
  };
}

describe("AiWorkbenchResultPanel", () => {
  it("renders script drafts with source and schema sections", () => {
    const html = renderToStaticMarkup(
      <AiWorkbenchResultPanel
        taskKey="generate"
        result={result("GENERATE_SCRIPT", {
          id: "hello-ai",
          name: "Hello AI",
          source: "return [ok: true]",
          inputSchema: { type: "object" },
          outputSchema: { type: "object" }
        })}
        editorTheme="vs-light"
        onImportGenerated={() => undefined}
      />
    );

    expect(html).toContain("Hello AI");
    expect(html).toContain("return [ok: true]");
    expect(html).toContain("inputSchema");
    expect(html).toContain("outputSchema");
  });

  it("renders diagnosis root cause and next steps", () => {
    const html = renderToStaticMarkup(
      <AiWorkbenchResultPanel
        taskKey="diagnose"
        result={result("DIAGNOSE_EXECUTION", {
          rootCause: "Null input",
          suggestedFix: "Validate name",
          evidence: ["stack trace"],
          nextSteps: ["patch script"]
        })}
        editorTheme="vs-light"
        onImportGenerated={() => undefined}
      />
    );

    expect(html).toContain("Null input");
    expect(html).toContain("Validate name");
    expect(html).toContain("patch script");
  });

  it("renders script patch results with updated source", () => {
    const html = renderToStaticMarkup(
      <AiWorkbenchResultPanel
        taskKey="improve"
        result={result("IMPROVE_SCRIPT", {
          patch: "@@ -1 +1 @@",
          updatedSource: "return [patched: true]",
          rationale: "Handle null input"
        })}
        editorTheme="vs-light"
        onImportGenerated={() => undefined}
      />
    );

    expect(html).toContain("return [patched: true]");
    expect(html).toContain("Handle null input");
  });
});
