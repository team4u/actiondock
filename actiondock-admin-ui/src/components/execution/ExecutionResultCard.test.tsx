import { Button } from "antd";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ExecutionResultCard } from "./ExecutionResultCard";
import type { ExecutionRecord } from "../../shared/types";

vi.mock("antd", async () => {
  const actual = await vi.importActual<typeof import("antd")>("antd");
  return {
    ...actual,
    Tabs: ({ items, defaultActiveKey }: { items?: Array<{ key: string; label: React.ReactNode; children: React.ReactNode }>; defaultActiveKey?: string }) => (
      <div data-testid="mock-tabs" data-active-key={defaultActiveKey}>
        {items?.map((item) => (
          <section key={item.key} data-tab-key={item.key}>
            <div>{item.label}</div>
            <div>{item.children}</div>
          </section>
        ))}
      </div>
    )
  };
});

vi.mock("../schema/SchemaObjectResultView", () => ({
  SchemaObjectResultView: ({ value, schemaName }: { value?: Record<string, unknown>; schemaName?: string }) => (
    <div
      data-testid="schema-object-result-view"
      data-schema-name={schemaName ?? "outputSchema"}
      data-value={JSON.stringify(value ?? {})}
    />
  )
}));

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

  it("prefers inputOverride for input preview", () => {
    const html = renderToStaticMarkup(
      <ExecutionResultCard
        execution={execution}
        inputOverride={{ name: "Bob" }}
      />
    );

    expect(html).toContain('data-schema-name="inputSchema"');
    expect(html).toContain('&quot;name&quot;:&quot;Bob&quot;');
  });

});
