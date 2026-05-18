import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { AiTool } from "../../../shared/types";
import { AiToolPickerTable, ToolConfigWorkspace, buildAiToolsetPayload, filterAiToolsForPicker } from "./AiToolsetDetailPage";

const tools: AiTool[] = [
  {
    name: "agentscope.list_directory",
    displayName: "List Directory",
    sourceType: "SYSTEM",
    sourceId: "agentscope.list_directory",
    description: "AgentScope 内置工具：列出目录内容",
    inputSchema: { type: "object" },
    outputSchema: { type: "object" },
    permission: "READ_ONLY",
    configurable: true,
    configHelp: "配置基础目录后，仅允许在该目录下列出内容。",
    configExample: { baseDir: "/tmp" }
  },
  {
    name: "agentscope.execute_shell_command",
    displayName: "Run Shell",
    sourceType: "SYSTEM",
    sourceId: "agentscope.execute_shell_command",
    description: "AgentScope 内置工具：执行 Shell 命令",
    inputSchema: { type: "object" },
    outputSchema: { type: "object" },
    permission: "DANGEROUS_ACTION"
  }
];

describe("AiToolsetDetailPage tool picker", () => {
  it("renders tool descriptions in the picker table", () => {
    const html = renderToStaticMarkup(
      <AiToolPickerTable
        tools={tools}
        selectedNames={["agentscope.list_directory"]}
        toolOptionsByName={{ "agentscope.list_directory": { baseDir: "/tmp" } }}
        testingTool={null}
        testInputByTool={{}}
        testResultByTool={{}}
        onSelectionChange={() => undefined}
        onOpenConfig={() => undefined}
        onTestInputChange={() => undefined}
        onTest={() => undefined}
      />
    );

    expect(html).toContain("agentscope.list_directory");
    expect(html).toContain("AgentScope 内置工具：列出目录内容");
    expect(html).toContain("AgentScope 内置工具：执行 Shell 命令");
    expect(html).toContain("已配置");
    expect(html).toContain("查看");
  });

  it("renders tool workspace details in the config drawer body", () => {
    const html = renderToStaticMarkup(
      <ToolConfigWorkspace
        tool={tools[0]}
        selected={true}
        configStatus={{ label: "已配置", color: "green" }}
        draftText='{"baseDir":"/tmp"}'
        testInputText='{"path":"."}'
        testResult={{ success: true, output: { entries: [] } }}
        testing={false}
        onDraftChange={() => undefined}
        onApply={() => undefined}
        onClear={() => undefined}
        onTestInputChange={() => undefined}
        onTest={() => undefined}
      />
    );

    expect(html).toContain("输入 Schema");
    expect(html).toContain("输出 Schema");
    expect(html).toContain("测试输入");
    expect(html).toContain("工具配置 JSON");
    expect(html).toContain("示例配置");
    expect(html).toContain("AgentScope 内置工具：列出目录内容");
  });

  it("filters tools by description and permission", () => {
    expect(filterAiToolsForPicker(tools, "Shell")).toEqual([tools[1]]);
    expect(filterAiToolsForPicker(tools, "dangerous")).toEqual([tools[1]]);
    expect(filterAiToolsForPicker(tools, "system")).toEqual(tools);
  });

  it("builds save payload with selected tool names", () => {
    expect(buildAiToolsetPayload({
      id: " tools/default ",
      name: " 默认工具 ",
      description: "  ",
      maxPermission: "READ_ONLY",
      enabled: true
    }, ["agentscope.list_directory"], {
      "agentscope.list_directory": { baseDir: "/tmp" },
      "agentscope.execute_shell_command": { baseDir: "/tmp", allowedCommands: ["ls"] }
    })).toEqual({
      id: "tools/default",
      name: "默认工具",
      description: undefined,
      toolNames: ["agentscope.list_directory"],
      toolOptions: { "agentscope.list_directory": { baseDir: "/tmp" } },
      maxPermission: "READ_ONLY",
      enabled: true
    });
  });
});
