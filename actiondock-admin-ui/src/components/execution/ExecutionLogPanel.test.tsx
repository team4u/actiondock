import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ExecutionLogPanel } from "./ExecutionLogPanel";

describe("ExecutionLogPanel", () => {
  it("renders execution logs", () => {
    const html = renderToStaticMarkup(
      <ExecutionLogPanel
        logs={[
          {
            level: "INFO",
            message: "started",
            createdAt: "2026-01-02T03:04:05"
          },
          {
            level: "ERROR",
            message: "failed",
            createdAt: "2026-01-02T03:04:06"
          }
        ]}
      />
    );

    expect(html).toContain("执行日志");
    expect(html).toContain("INFO");
    expect(html).toContain("started");
    expect(html).toContain("ERROR");
    expect(html).toContain("failed");
  });

  it("renders empty state when logs are missing", () => {
    const html = renderToStaticMarkup(<ExecutionLogPanel logs={[]} />);

    expect(html).toContain("暂无日志");
  });
});
