import { describe, expect, it } from "vitest";
import { buildImpactPreview, buildImpactSummary, shouldMaskConfigValue } from "./configValueInsights";
import type { ConfigValueDetail } from "../shared/types";

const detail: ConfigValueDetail = {
  key: "api.host",
  usage: {
    configReferences: [{ key: "service.url" }],
    scriptReferences: [{ scriptId: "script-a", scriptName: "Script A" }],
    scheduleReferences: [{ scheduleId: "schedule-a", scheduleName: "Nightly", scriptId: "script-a", scriptName: "Script A" }],
    pluginConfigReferences: [{ pluginId: "plugin-a", pluginName: "Plugin A", dependentScriptCount: 2 }],
    modelReferences: [{ modelId: "model-a", modelName: "GPT-4", referenceType: "direct" }],
    templateDeclarations: [{
      repositoryId: "repo-a",
      repositoryName: "Repo A",
      repositoryScriptId: "tool-a",
      scriptName: "Tool A",
      version: "1.0.0",
      secret: false,
      publishMode: "INLINE"
    }]
  },
  impactedScripts: [{
    scriptId: "script-a",
    scriptName: "Script A",
    reasons: ["脚本源码直接引用", "定时任务 Nightly 通过配置 service.url 间接受影响"]
  }],
  availableActions: {
    canCopyAsLocalOverride: true,
    canRestoreRepositoryDefault: false
  }
};

describe("config value insight helpers", () => {
  it("masks secret and placeholder values", () => {
    expect(shouldMaskConfigValue({ secret: true, publishMode: "INLINE" })).toBe(true);
    expect(shouldMaskConfigValue({ secret: false, publishMode: "PLACEHOLDER" })).toBe(true);
    expect(shouldMaskConfigValue({ secret: false, publishMode: "INLINE" })).toBe(false);
  });

  it("builds impact summary counts", () => {
    expect(buildImpactSummary(detail)).toEqual([
      "受影响脚本 1 个",
      "直接脚本引用 1 个",
      "定时任务引用 1 个",
      "插件配置引用 1 个",
      "配置值依赖 1 个",
      "模板声明 1 个",
      "模型引用 1 个"
    ]);
  });

  it("builds impact preview lines", () => {
    expect(buildImpactPreview(detail)).toEqual([
      "script-a (Script A): 脚本源码直接引用；定时任务 Nightly 通过配置 service.url 间接受影响"
    ]);
  });
});
