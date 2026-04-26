import { Button } from "antd";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ExecutionResultCard } from "./ExecutionResultCard";
import type { ExecutionRecord } from "../types";

const execution: ExecutionRecord = {
  id: "exec-1",
  scriptId: "script-1",
  status: "SUCCESS",
  submitMode: "SYNC",
  triggerSource: "MANUAL",
  input: { name: "Alice" },
  output: { message: "Hello, Alice" },
  logs: [],
  createdAt: "2026-01-02T03:04:05",
  finishedAt: "2026-01-02T03:04:06"
};

describe("ExecutionResultCard", () => {
  it("renders optional header actions when provided", () => {
    const html = renderToStaticMarkup(
      <ExecutionResultCard
        execution={execution}
        headerActions={<Button>回填本次输入</Button>}
      />
    );

    expect(html).toContain("回填本次输入");
  });

  it("keeps header actions hidden by default", () => {
    const html = renderToStaticMarkup(<ExecutionResultCard execution={execution} />);

    expect(html).not.toContain("回填本次输入");
  });
});
