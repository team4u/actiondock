import { describe, expect, it } from "vitest";
import { selectCurrentExecution } from "./useScriptExecution";
import type { ExecutionRecord } from "../../../../shared/types";

function executionRecord(id: string, createdAt: string): ExecutionRecord {
  return {
    id,
    scriptId: "script-1",
    status: "SUCCESS",
    submitMode: "SYNC",
    triggerSource: "MANUAL",
    input: {},
    output: {},
    logs: [],
    createdAt,
    finishedAt: createdAt
  };
}

describe("selectCurrentExecution", () => {
  it("picks the latest record when nothing is selected yet", () => {
    const records = [
      executionRecord("exec-new", "2026-04-30T10:00:00"),
      executionRecord("exec-old", "2026-04-29T10:00:00")
    ];

    expect(selectCurrentExecution(records, null)?.id).toBe("exec-new");
  });

  it("prefers the requested execution id when provided", () => {
    const records = [
      executionRecord("exec-new", "2026-04-30T10:00:00"),
      executionRecord("exec-old", "2026-04-29T10:00:00")
    ];

    expect(selectCurrentExecution(records, null, "exec-old")?.id).toBe("exec-old");
  });

  it("falls back to the latest record when the previous selection disappears", () => {
    const records = [executionRecord("exec-new", "2026-04-30T10:00:00")];
    const previous = executionRecord("exec-missing", "2026-04-28T10:00:00");

    expect(selectCurrentExecution(records, previous)?.id).toBe("exec-new");
  });
});
