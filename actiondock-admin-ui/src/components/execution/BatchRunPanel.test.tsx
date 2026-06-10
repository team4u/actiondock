import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { MessageInstance } from "antd/es/message/interface";
import { BatchRunPanel } from "./BatchRunPanel";

const messageApi = {
  success: vi.fn(),
  error: vi.fn(),
  warning: vi.fn(),
  info: vi.fn()
} as unknown as MessageInstance;

describe("BatchRunPanel", () => {
  it("renders workspace layout with submit and result areas", () => {
    const html = renderToStaticMarkup(
      <BatchRunPanel
        surface="editor"
        scriptId="repair-order"
        scriptName="repair-order"
        inputSchema={{ type: "object" }}
        outputSchema={{ type: "object" }}
        supportedFields={[
          {
            name: "orderId",
            label: "订单号",
            kind: "string",
            required: true
          }
        ]}
        supportedOutputFields={[]}
        unsupportedFields={[]}
        editorTheme="vs-light"
        messageApi={messageApi}
        submitExecution={vi.fn()}
        fetchExecution={vi.fn()}
      />
    );

    expect(html).toContain("JSON 数组");
    expect(html).toContain("JSONL");
    expect(html).toContain("CSV");
    expect(html).toContain("批量输入");
    expect(html).toContain("数据格式");
    expect(html).toContain("格式说明");
    expect(html).toContain("复制示例");
    expect(html).toContain("批量结果");
    expect(html).toContain("校验明细");
    expect(html).toContain("开始批量运行");
  });
});
