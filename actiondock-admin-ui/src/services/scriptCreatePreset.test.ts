import { describe, expect, it } from "vitest";
import { extractAiDependenciesFromSource } from "./aiDependencies";
import { buildAgentWrapperScriptPreset, buildWebhookScriptPreset, slugifyScriptId, suggestPresetScriptId } from "./scriptCreatePreset";

describe("scriptCreatePreset", () => {
  it("slugifies generated script ids", () => {
    expect(slugifyScriptId("agent/demo profile")).toBe("agent-demo-profile");
    expect(slugifyScriptId("中文")).toBe("agent");
  });

  it("suggests a non-conflicting preset script id", () => {
    expect(suggestPresetScriptId("agent-demo", ["agent-demo", "agent-demo-2"])).toBe("agent-demo-3");
  });

  it("builds an Agent wrapper preset with detectable AI dependency", () => {
    const preset = buildAgentWrapperScriptPreset({
      id: "script-dev-agent",
      name: "Script Dev",
      description: "dev agent"
    });

    expect(preset.idHint).toBe("agent-script-dev-agent");
    expect(preset.nameHint).toBe("Script Dev 脚本");
    expect(preset.type).toBe("GROOVY");
    expect(preset.packaging).toBe("TOOL");
    expect(preset.inputSchema.required).toEqual(["instruction"]);
    expect(preset.outputSchema.properties).toHaveProperty("runId");
    expect(extractAiDependenciesFromSource(preset.source)).toEqual([
      { capability: "AGENT_RUN", profile: undefined, agentProfile: "script-dev-agent", required: true }
    ]);
  });

  it("escapes Agent ids inside generated Groovy source", () => {
    const preset = buildAgentWrapperScriptPreset({
      id: "agent\\with'quote",
      name: "",
      description: ""
    });

    expect(preset.source).toContain("agentProfile: 'agent\\\\with\\'quote'");
  });

  it("builds a webhook preset with request envelope input schema", () => {
    const preset = buildWebhookScriptPreset({
      key: "github-webhook",
      name: "GitHub Webhook"
    });

    expect(preset.idHint).toBe("webhook-github-webhook");
    expect(preset.nameHint).toBe("GitHub Webhook 脚本");
    expect(preset.inputSchema.required).toEqual(["request", "webhook"]);
    expect((preset.inputSchema.properties as Record<string, unknown>)).toHaveProperty("request");
    expect((preset.inputSchema.properties as Record<string, unknown>)).toHaveProperty("webhook");
    expect(preset.outputSchema.required).toEqual(["status"]);
    expect(preset.source).toContain("def request = input.request instanceof Map ? input.request : [:]");
    expect(preset.source).toContain("\"Content-Type\": [\"application/json;charset=UTF-8\"]");
  });
});
