import { describe, expect, it } from "vitest";
import {
  analyzePlaybookImport,
  buildPlaybookExportBundle,
  parsePlaybookImportBundle
} from "./playbookTransfer";
import type { Playbook, ScriptDefinition } from "../shared/types";

const basePlaybook: Playbook = {
  id: "generic-project-investigation",
  name: "通用项目调查",
  description: "fallback",
  tags: ["project-knowledge"],
  riskLevel: "LOW",
  repositoryIds: ["billing-service"],
  knowledgeRefs: [
    { type: "NOTE", repositoryId: "billing-service", markdown: "先读入口。" },
    { type: "FILE", repositoryId: "billing-service", path: "docs/runbook.md" }
  ],
  scriptRefs: [{ scriptId: "query-log", purpose: "查日志" }],
  agentSkillRefs: [{ skillId: "openai-docs", purpose: "查官方文档", required: false }],
  relatedPlaybookRefs: [{ playbookId: "fallback-investigation", relation: "FALLBACK", purpose: "专用手册不适用时使用" }],
  guideMarkdown: "先读取 ACTIONDOCK.md。",
  stopConditions: ["缺少目标项目"],
  enabled: true,
  managed: false
};

const script: ScriptDefinition = {
  id: "query-log",
  name: "Query Log",
  type: "GROOVY",
  packaging: "TOOL",
  source: "return [:]",
  inputSchema: { type: "object", properties: {} },
  outputSchema: { type: "object", properties: {} },
  version: 1
};

describe("parsePlaybookImportBundle", () => {
  it("parses playbook bundles and forces imported items to editable local assets", () => {
    const playbooks = parsePlaybookImportBundle(JSON.stringify({
      version: 1,
      exportedAt: "2026-05-31T00:00:00Z",
      playbooks: [{ ...basePlaybook, managed: true, createdAt: "2026-01-01T00:00:00Z" }]
    }));

    expect(playbooks).toEqual([
      expect.objectContaining({
        id: "generic-project-investigation",
        name: "通用项目调查",
        managed: false,
        knowledgeRefs: basePlaybook.knowledgeRefs,
        scriptRefs: basePlaybook.scriptRefs,
        agentSkillRefs: basePlaybook.agentSkillRefs,
        relatedPlaybookRefs: basePlaybook.relatedPlaybookRefs
      })
    ]);
    expect(playbooks[0].createdAt).toBeUndefined();
  });

  it("rejects duplicate playbook ids", () => {
    expect(() => parsePlaybookImportBundle(JSON.stringify({
      version: 1,
      exportedAt: "2026-05-31T00:00:00Z",
      playbooks: [basePlaybook, basePlaybook]
    }))).toThrow("重复任务手册 ID");
  });

  it("rejects invalid knowledge references", () => {
    expect(() => parsePlaybookImportBundle(JSON.stringify({
      version: 1,
      exportedAt: "2026-05-31T00:00:00Z",
      playbooks: [{
        ...basePlaybook,
        knowledgeRefs: [{ type: "FILE", repositoryId: "billing-service", path: "../secret.md" }]
      }]
    }))).toThrow("必须是仓库内相对路径");
  });

  it("rejects invalid risk levels", () => {
    expect(() => parsePlaybookImportBundle(JSON.stringify({
      version: 1,
      exportedAt: "2026-05-31T00:00:00Z",
      playbooks: [{ ...basePlaybook, riskLevel: "CRITICAL" }]
    }))).toThrow("riskLevel 仅支持");
  });

  it("rejects invalid related playbook relations", () => {
    expect(() => parsePlaybookImportBundle(JSON.stringify({
      version: 1,
      exportedAt: "2026-05-31T00:00:00Z",
      playbooks: [{ ...basePlaybook, relatedPlaybookRefs: [{ playbookId: "other", relation: "PARENT" }] }]
    }))).toThrow("relation 仅支持");
  });
});

describe("playbook import/export helpers", () => {
  it("builds sorted export bundles without managed metadata", () => {
    const bundle = buildPlaybookExportBundle([
      { ...basePlaybook, id: "z-playbook", managed: true },
      basePlaybook
    ]);

    expect(bundle.version).toBe(1);
    expect(bundle.playbooks.map((item) => item.id)).toEqual([
      "generic-project-investigation",
      "z-playbook"
    ]);
    expect(bundle.playbooks.every((item) => item.managed === false)).toBe(true);
  });

  it("analyzes creates, overwrites, managed conflicts, and missing script references", () => {
    const imported = [
      basePlaybook,
      { ...basePlaybook, id: "existing-local" },
      { ...basePlaybook, id: "existing-managed" },
      { ...basePlaybook, id: "missing-script", scriptRefs: [{ scriptId: "missing" }] }
    ];

    const analysis = analyzePlaybookImport(
      imported,
      [
        { ...basePlaybook, id: "existing-local", managed: false },
        { ...basePlaybook, id: "existing-managed", managed: true }
      ],
      [script]
    );

    expect(analysis.createIds).toEqual(["generic-project-investigation", "missing-script"]);
    expect(analysis.overwriteIds).toEqual(["existing-local"]);
    expect(analysis.managedConflictIds).toEqual(["existing-managed"]);
    expect(analysis.missingScriptRefs).toEqual([
      { playbookId: "missing-script", scriptIds: ["missing"] }
    ]);
  });
});
