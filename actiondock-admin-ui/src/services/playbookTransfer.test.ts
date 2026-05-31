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

  it("analyzes creates, overwrites, managed conflicts, missing script and playbook references, topological sorting and circular dependency", () => {
    const imported = [
      { ...basePlaybook, id: "generic-project-investigation", relatedPlaybookRefs: [] },
      { ...basePlaybook, id: "existing-local", relatedPlaybookRefs: [] },
      { ...basePlaybook, id: "existing-managed", relatedPlaybookRefs: [] },
      { ...basePlaybook, id: "missing-script", scriptRefs: [{ scriptId: "missing" }], relatedPlaybookRefs: [] },
      { ...basePlaybook, id: "missing-playbook", relatedPlaybookRefs: [{ playbookId: "non-existent", relation: "RELATED" as const }] },
      // Dependency chain for topological sorting: p3 depends on p2, p2 depends on p1
      { ...basePlaybook, id: "p3", relatedPlaybookRefs: [{ playbookId: "p2", relation: "RELATED" as const }] },
      { ...basePlaybook, id: "p2", relatedPlaybookRefs: [{ playbookId: "p1", relation: "RELATED" as const }] },
      { ...basePlaybook, id: "p1", relatedPlaybookRefs: [] }
    ];

    const analysis = analyzePlaybookImport(
      imported,
      [
        { ...basePlaybook, id: "existing-local", managed: false },
        { ...basePlaybook, id: "existing-managed", managed: true }
      ],
      [script]
    );

    expect(analysis.createIds).toEqual([
      "generic-project-investigation",
      "missing-script",
      "missing-playbook",
      "p3",
      "p2",
      "p1"
    ]);
    expect(analysis.overwriteIds).toEqual(["existing-local"]);
    expect(analysis.managedConflictIds).toEqual(["existing-managed"]);
    expect(analysis.missingScriptRefs).toEqual([
      { playbookId: "missing-script", scriptIds: ["missing"] }
    ]);
    expect(analysis.missingRelatedPlaybookRefs).toEqual([
      { playbookId: "missing-playbook", missingPlaybookIds: ["non-existent"] }
    ]);

    // p1 should be created first, then p2, then p3 due to topological dependency ordering
    const sortedCreateIds = analysis.playbooks
      .map((p) => p.id)
      .filter((id) => analysis.createIds.includes(id));
    expect(sortedCreateIds.indexOf("p1")).toBeLessThan(sortedCreateIds.indexOf("p2"));
    expect(sortedCreateIds.indexOf("p2")).toBeLessThan(sortedCreateIds.indexOf("p3"));
    expect(analysis.circularIds).toEqual([]);

    // Now test circular dependency detection
    const circularImported = [
      { ...basePlaybook, id: "cycle-a", relatedPlaybookRefs: [{ playbookId: "cycle-b", relation: "RELATED" as const }] },
      { ...basePlaybook, id: "cycle-b", relatedPlaybookRefs: [{ playbookId: "cycle-a", relation: "RELATED" as const }] }
    ];
    const circularAnalysis = analyzePlaybookImport(circularImported, [], [script]);
    expect(circularAnalysis.circularIds).toContain("cycle-a");
    expect(circularAnalysis.circularIds).toContain("cycle-b");
  });
});
