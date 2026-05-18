import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ScriptExecutionTab } from "./ScriptExecutionTab";
import type { ExecutionRecord, ScriptDefinition } from "../../../../shared/types";

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
    ),
    Drawer: ({ open, children, title }: { open?: boolean; children?: React.ReactNode; title?: React.ReactNode }) => (
      <section data-testid="mock-drawer" data-open={String(Boolean(open))}>
        <div>{title}</div>
        <div>{children}</div>
      </section>
    ),
    Table: ({ dataSource, onRow }: { dataSource?: unknown[]; onRow?: (record: any) => { onClick?: () => void } }) => (
      <div data-testid="mock-table">
        {dataSource?.map((record: any) => (
          <button key={record.id} type="button" onClick={() => onRow?.(record).onClick?.()}>
            {record.id}
          </button>
        ))}
      </div>
    )
  };
});

vi.mock("../../../../components/schema/SchemaObjectEditor", () => ({
  SchemaObjectEditor: () => <div data-testid="schema-object-editor" />
}));

vi.mock("../../../../components/execution/ExecutionResultCard", () => ({
  ExecutionResultCard: ({ execution }: { execution: ExecutionRecord }) => (
    <div data-testid="execution-result-card">{execution.id}</div>
  )
}));

vi.mock("../../../../components/execution/BatchRunPanel", () => ({
  BatchRunPanel: () => <div data-testid="batch-run-panel" />
}));

vi.mock("../../../../components/common/ConfirmDangerAction", () => ({
  ConfirmDangerAction: ({ children }: { children: React.ReactNode }) => <>{children}</>
}));

const script: ScriptDefinition = {
  id: "script-1",
  name: "Script",
  type: "GROOVY",
  packaging: "TOOL",
  source: "return [message: 'hi']",
  inputSchema: {},
  outputSchema: {},
  published: null,
  publication: {
    published: false,
    dirty: false
  },
  version: 1
};

const execution: ExecutionRecord = {
  id: "exec-1",
  scriptId: "script-1",
  status: "SUCCESS",
  submitMode: "SYNC",
  triggerSource: "MANUAL",
  input: { name: "Alice" },
  output: { markdown: "# Hello\n\nA very long markdown body" },
  logs: [],
  createdAt: "2026-04-30T10:00:00",
  finishedAt: "2026-04-30T10:00:01"
};

describe("ScriptExecutionTab", () => {
  it("renders a right-side execution list and keeps full details inside the drawer", () => {
    const html = renderToStaticMarkup(
      <ScriptExecutionTab
        currentScript={script}
        executionForm={{} as any}
        executionMode="SYNC"
        onExecutionModeChange={() => undefined}
        executionInputMode="JSON"
        executionJsonInput="{}"
        onExecutionJsonInputChange={() => undefined}
        onExecutionInputModeChange={() => undefined}
        executionValidationError={null}
        supportedFields={[]}
        unsupportedFields={[]}
        supportedOutputFields={[]}
        executing={false}
        currentExecution={execution}
        executionHistory={[execution]}
        historyLoading={false}
        deletingExecutionId={null}
        clearingExecutionHistory={false}
        pollingExecutionId={null}
        hasActiveExecutionHistory={false}
        editorTheme="vs-light"
        onExecute={async () => undefined}
        onResetExecutionInput={() => undefined}
        onDeleteExecution={async () => undefined}
        onClearExecutionHistory={async () => undefined}
        onRefreshHistory={() => undefined}
        onExecutionHistoryRowClick={() => undefined}
        onRefillCurrentExecutionInput={() => undefined}
        executionDetailOpen={true}
        onOpenExecutionDetail={() => undefined}
        onCloseExecutionDetail={() => undefined}
        activeExecutionId={execution.id}
        messageApi={{} as any}
        submitBatchExecution={async () => execution as any}
        fetchBatchExecution={async () => execution}
        presetBar={null}
      />
    );

    expect(html).toContain("执行入参");
    expect(html).toContain("执行结果列表");
    expect(html).toContain("详情");
    expect(html).not.toContain("当前执行摘要");
    expect(html).toContain('data-testid="mock-drawer"');
    expect(html).toContain('data-open="true"');
    expect(html).toContain('data-testid="execution-result-card"');
  });
});
