import { describe, expect, it } from "vitest";
import { buildToolOptionsPayload, cloneToolConfigMap, resolveAgentToolSelection } from "./aiAgentTools";
import type { AiTool, AiToolset } from "../shared/types";

const tools: AiTool[] = [
  {
    name: "agentscope.list_directory",
    displayName: "List Directory",
    sourceType: "SYSTEM",
    sourceId: "agentscope.list_directory",
    description: "AgentScope 内置工具：列出目录内容",
    inputSchema: { type: "object" },
    outputSchema: { type: "object" },
    permission: "READ_ONLY"
  },
  {
    name: "script.published-script",
    displayName: "Published Script",
    sourceType: "SCRIPT",
    sourceId: "published-script",
    description: "调用已发布脚本",
    inputSchema: { type: "object" },
    outputSchema: { type: "object" },
    permission: "CONTROLLED_ACTION"
  }
];

const toolsets: AiToolset[] = [
  {
    id: "shared-tools",
    name: "Shared Tools",
    toolNames: ["agentscope.list_directory"],
    toolOptions: { "agentscope.list_directory": { baseDir: "/tmp" } },
    maxPermission: "READ_ONLY",
    enabled: true
  }
];

describe("aiAgentTools", () => {
  it("clones and filters non-empty tool configs", () => {
    expect(cloneToolConfigMap({
      "agentscope.list_directory": { baseDir: "/tmp" },
      "script.published-script": {}
    })).toEqual({
      "agentscope.list_directory": { baseDir: "/tmp" }
    });

    expect(buildToolOptionsPayload(["agentscope.list_directory"], {
      "agentscope.list_directory": { baseDir: "/tmp" },
      "script.published-script": { enabled: true }
    })).toEqual({
      "agentscope.list_directory": { baseDir: "/tmp" }
    });
  });

  it("merges matching direct tool config with toolset tool", () => {
    const resolution = resolveAgentToolSelection({
      toolsetIds: ["shared-tools"],
      directToolNames: ["agentscope.list_directory"],
      directToolOptions: { "agentscope.list_directory": { baseDir: "/tmp" } }
    }, toolsets, tools);

    expect(resolution.conflicts).toEqual([]);
    expect(resolution.mergedToolCount).toBe(1);
    expect(resolution.effectiveTools).toHaveLength(1);
    expect(resolution.effectiveTools[0].sources.map((item) => item.label)).toEqual(["toolset:shared-tools", "direct"]);
  });

  it("flags conflicting direct tool config", () => {
    const resolution = resolveAgentToolSelection({
      toolsetIds: ["shared-tools"],
      directToolNames: ["agentscope.list_directory"],
      directToolOptions: { "agentscope.list_directory": { baseDir: "/srv" } }
    }, toolsets, tools);

    expect(resolution.effectiveTools).toEqual([]);
    expect(resolution.conflicts).toHaveLength(1);
    expect(resolution.conflicts[0]).toMatchObject({
      toolName: "agentscope.list_directory",
      reason: "CONFIG_MISMATCH"
    });
  });
});
