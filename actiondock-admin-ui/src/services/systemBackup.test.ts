import { describe, expect, it } from "vitest";
import {
  analyzeBackupBundle,
  buildBackupJson,
  buildSharedStateBackupEntry,
  parseBackupJson,
  toSharedStateRestorePayload
} from "./systemBackup";
import type { SharedStateSummary } from "../shared/types";
import type { Playbook } from "../shared/types";

describe("systemBackup shared state support", () => {
  it("builds backup json with shared states and preserves explicit null values", () => {
    const backup = buildBackupJson({
      scripts: [],
      schedules: [],
      webhooks: [],
      configValues: [],
      executionPresets: [],
      repositories: [],
      plugins: [],
      pluginConfigs: new Map(),
      sharedStates: [
        buildSharedStateBackupEntry({
          namespace: "workflow.invoice",
          key: "cursor",
          secret: false,
          expiresAt: null,
          value: null
        }, { includeValue: true }),
        buildSharedStateBackupEntry({
          namespace: "oauth.github",
          key: "access-token",
          secret: true,
          expiresAt: "2026-04-29T10:00:00"
        })
      ],
      aiModels: [],
      aiAgents: [],
      aiToolsets: []
    });

    expect(backup.data.sharedStates).toEqual([
      {
        namespace: "oauth.github",
        key: "access-token",
        secret: true,
        expiresAt: "2026-04-29T10:00:00",
        valueIncluded: false
      },
      {
        namespace: "workflow.invoice",
        key: "cursor",
        secret: false,
        expiresAt: null,
        valueIncluded: true,
        value: null
      }
    ]);
  });

  it("parses old v1 backups without shared states as an empty list", () => {
    const parsed = parseBackupJson(JSON.stringify({
      version: 1,
      type: "actiondock-system-backup",
      exportedAt: "2026-04-29T00:00:00.000Z",
      data: {
        scripts: [],
        schedules: [],
        webhooks: [],
        configValues: [],
        executionPresets: [],
        repositories: [],
        plugins: [],
        aiModels: [],
        aiAgents: [],
        aiToolsets: []
      }
    }));

    expect(parsed.data.sharedStates).toEqual([]);
    expect(parsed.data.playbooks).toEqual([]);
  });

  it("builds and parses backup json with playbooks", () => {
    const playbook: Playbook = {
      id: "generic-project-investigation",
      name: "通用项目调查",
      description: "fallback",
      tags: ["project-knowledge"],
      riskLevel: "LOW",
      repositoryIds: [],
      knowledgeRefs: [],
      scriptRefs: [],
      agentSkillRefs: [],
      relatedPlaybookRefs: [],
      guideMarkdown: "先读取 ACTIONDOCK.md。",
      stopConditions: ["缺少目标项目"],
      enabled: true,
      managed: true
    };

    const backup = buildBackupJson({
      scripts: [],
      schedules: [],
      webhooks: [],
      configValues: [],
      executionPresets: [],
      repositories: [],
      playbooks: [playbook],
      plugins: [],
      pluginConfigs: new Map(),
      sharedStates: [],
      aiModels: [],
      aiAgents: [],
      aiToolsets: []
    });
    const parsed = parseBackupJson(JSON.stringify(backup));

    expect(parsed.data.playbooks).toEqual([
      expect.objectContaining({
        id: "generic-project-investigation",
        managed: false,
        guideMarkdown: "先读取 ACTIONDOCK.md。"
      })
    ]);
  });

  it("parses new backups with shared states", () => {
    const parsed = parseBackupJson(JSON.stringify({
      version: 1,
      type: "actiondock-system-backup",
      exportedAt: "2026-04-29T00:00:00.000Z",
      data: {
        scripts: [],
        schedules: [],
        webhooks: [],
        configValues: [],
        executionPresets: [],
        repositories: [],
        plugins: [],
        sharedStates: [
          {
            namespace: "oauth.github",
            key: "access-token",
            secret: true,
            expiresAt: "2026-04-29T10:00:00",
            valueIncluded: true,
            value: { accessToken: "gho_xxx" }
          },
          {
            namespace: "workflow.invoice",
            key: "cursor",
            secret: false,
            expiresAt: null,
            valueIncluded: false
          }
        ],
        aiModels: [],
        aiAgents: [],
        aiToolsets: []
      }
    }));

    expect(parsed.data.sharedStates).toEqual([
      {
        namespace: "oauth.github",
        key: "access-token",
        secret: true,
        expiresAt: "2026-04-29T10:00:00",
        valueIncluded: true,
        value: { accessToken: "gho_xxx" }
      },
      {
        namespace: "workflow.invoice",
        key: "cursor",
        secret: false,
        expiresAt: null,
        valueIncluded: false
      }
    ]);
  });

  it("rejects shared-state entries with missing values when valueIncluded is true", () => {
    expect(() => parseBackupJson(JSON.stringify({
      version: 1,
      type: "actiondock-system-backup",
      exportedAt: "2026-04-29T00:00:00.000Z",
      data: {
        scripts: [],
        schedules: [],
        webhooks: [],
        configValues: [],
        executionPresets: [],
        repositories: [],
        plugins: [],
        sharedStates: [
          {
            namespace: "oauth.github",
            key: "access-token",
            secret: true,
            expiresAt: null,
            valueIncluded: true
          }
        ],
        aiModels: [],
        aiAgents: [],
        aiToolsets: []
      }
    }))).toThrow("缺少 value");
  });

  it("analyzes shared states with create, overwrite, and skipped counts", () => {
    const bundle = buildBackupJson({
      scripts: [],
      schedules: [],
      webhooks: [],
      configValues: [],
      executionPresets: [],
      repositories: [],
      plugins: [],
      pluginConfigs: new Map(),
      sharedStates: [
        buildSharedStateBackupEntry({
          namespace: "oauth.github",
          key: "access-token",
          secret: true,
          expiresAt: "2026-04-29T10:00:00",
          value: { accessToken: "gho_xxx" }
        }, { includeValue: true }),
        buildSharedStateBackupEntry({
          namespace: "workflow.invoice",
          key: "cursor",
          secret: false,
          expiresAt: null,
          value: { page: 2 }
        }, { includeValue: true }),
        buildSharedStateBackupEntry({
          namespace: "cache.user-sync",
          key: "token",
          secret: true,
          expiresAt: null
        })
      ],
      aiModels: [],
      aiAgents: [],
      aiToolsets: []
    });
    const currentSharedStates: SharedStateSummary[] = [
      {
        namespace: "oauth.github",
        key: "access-token",
        secret: true
      }
    ];

    const analysis = analyzeBackupBundle(bundle, {
      scripts: [],
      schedules: [],
      webhooks: [],
      configValues: [],
      executionPresets: [],
      repositories: [],
      playbooks: [
        {
          id: "generic-project-investigation",
          name: "通用项目调查",
          tags: [],
          repositoryIds: [],
          knowledgeRefs: [],
          scriptRefs: [],
          agentSkillRefs: [],
          relatedPlaybookRefs: [],
          guideMarkdown: "guide",
          stopConditions: [],
          enabled: true,
          managed: false
        }
      ],
      plugins: [],
      sharedStates: currentSharedStates,
      aiModels: [],
      aiAgents: [],
      aiToolsets: []
    });

    expect(analysis.sharedStates).toEqual({
      total: 3,
      create: 1,
      overwrite: 1,
      skipped: 1
    });
    expect(analysis.playbooks).toEqual({
      total: 0,
      create: 0,
      overwrite: 0
    });
  });

  it("builds restore payloads only for entries with exported values", () => {
    expect(toSharedStateRestorePayload({
      namespace: "oauth.github",
      key: "access-token",
      secret: true,
      expiresAt: "2026-04-29T10:00:00",
      valueIncluded: false
    })).toBeNull();

    expect(toSharedStateRestorePayload({
      namespace: "workflow.invoice",
      key: "cursor",
      secret: false,
      expiresAt: null,
      valueIncluded: true,
      value: null
    })).toEqual({
      namespace: "workflow.invoice",
      key: "cursor",
      value: null,
      secret: false,
      expiresAt: null
    });
  });
});
