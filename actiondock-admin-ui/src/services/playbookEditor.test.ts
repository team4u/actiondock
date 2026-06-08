import { describe, expect, it } from "vitest";
import { buildPlaybookSavePayload, type KnowledgeEditorState, type PlaybookFormValues } from "./playbookEditor";
import type { Playbook, ScriptDefinition } from "../shared/types";

const script: ScriptDefinition = {
  id: "query-log",
  name: "查询日志",
  type: "GROOVY",
  packaging: "TOOL",
  source: "return [:]",
  inputSchema: { type: "object", properties: {} },
  outputSchema: { type: "object", properties: {} },
  version: 1
};

const basePlaybook: Playbook = {
  id: "refund",
  name: "退款失败排查",
  description: "旧描述",
  tags: ["refund", "billing"],
  riskLevel: "MEDIUM",
  repositoryIds: ["billing-service"],
  knowledgeRefs: [
    { type: "NOTE", repositoryId: "billing-service", markdown: "先读入口。" },
    { type: "FILE", repositoryId: "billing-service", path: "docs/runbook.md" }
  ],
  scriptRefs: [{ scriptId: "query-log", purpose: "查日志" }],
  agentSkillRefs: [{ skillId: "openai-docs", purpose: "查官方文档", required: false }],
  relatedPlaybookRefs: [{ playbookId: "fallback", relation: "FALLBACK", purpose: "退回通用调查" }],
  guideMarkdown: "旧导览",
  stopConditions: ["缺少订单号"],
  enabled: true,
  managed: false
};

const knowledgeEditor: KnowledgeEditorState[] = [
  {
    repositoryId: "billing-service",
    notes: ["先读入口。"],
    files: ["docs/runbook.md"]
  }
];

describe("buildPlaybookSavePayload", () => {
  it("preserves existing detail fields when edit form values omit unmounted tab fields", () => {
    const payload = buildPlaybookSavePayload({
      values: {
        id: "refund",
        name: "退款失败排查 v2",
        description: "新描述"
      },
      knowledgeEditor,
      scripts: [script],
      editing: basePlaybook
    });

    expect(payload).toEqual(expect.objectContaining({
      id: "refund",
      name: "退款失败排查 v2",
      description: "新描述",
      tags: basePlaybook.tags,
      riskLevel: "MEDIUM",
      repositoryIds: basePlaybook.repositoryIds,
      scriptRefs: basePlaybook.scriptRefs,
      agentSkillRefs: basePlaybook.agentSkillRefs,
      relatedPlaybookRefs: basePlaybook.relatedPlaybookRefs,
      guideMarkdown: "旧导览",
      stopConditions: basePlaybook.stopConditions,
      enabled: true
    }));
    expect(payload.knowledgeRefs).toEqual(basePlaybook.knowledgeRefs);
  });

  it("keeps explicit empty lists as user intent", () => {
    const values: Partial<PlaybookFormValues> = {
      id: "refund",
      name: "退款失败排查",
      repositoryIds: [],
      scriptRefs: [],
      agentSkillRefs: [],
      relatedPlaybookRefs: [],
      stopConditionsText: ""
    };

    const payload = buildPlaybookSavePayload({
      values,
      knowledgeEditor,
      scripts: [script],
      editing: basePlaybook
    });

    expect(payload.repositoryIds).toEqual([]);
    expect(payload.knowledgeRefs).toEqual([]);
    expect(payload.scriptRefs).toEqual([]);
    expect(payload.agentSkillRefs).toEqual([]);
    expect(payload.relatedPlaybookRefs).toEqual([]);
    expect(payload.stopConditions).toEqual([]);
  });

  it("fills empty script purpose from the script name", () => {
    const payload = buildPlaybookSavePayload({
      values: {
        id: "refund",
        name: "退款失败排查",
        scriptRefs: [{ scriptId: "query-log", purpose: " " }]
      },
      knowledgeEditor,
      scripts: [script],
      editing: basePlaybook
    });

    expect(payload.scriptRefs).toEqual([{ scriptId: "query-log", purpose: "查询日志" }]);
  });

  it("only saves knowledge refs for the selected repositories", () => {
    const payload = buildPlaybookSavePayload({
      values: {
        id: "refund",
        name: "退款失败排查",
        repositoryIds: ["billing-service"]
      },
      knowledgeEditor: [
        ...knowledgeEditor,
        {
          repositoryId: "unused-service",
          notes: ["不应保存"],
          files: ["docs/unused.md"]
        }
      ],
      scripts: [script],
      editing: basePlaybook
    });

    expect(payload.knowledgeRefs).toEqual(basePlaybook.knowledgeRefs);
  });
});
