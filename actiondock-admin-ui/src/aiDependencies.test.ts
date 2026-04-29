import { describe, expect, it } from "vitest";
import { extractAiDependenciesFromSource } from "./aiDependencies";
import { extractPluginDependenciesFromSource } from "./pluginDependencies";

describe("extractAiDependenciesFromSource", () => {
  it("detects AI chat and agent profiles from Groovy plugin calls", () => {
    const dependencies = extractAiDependenciesFromSource(`
      def chat = plugins.invoke("actiondock-ai", "chat", [
        modelProfile: "default-chat",
        messages: []
      ])
      def agent = plugins.invoke("actiondock-ai", "agentRun", [
        agentProfile: "script-dev-agent",
        messages: []
      ])
    `);

    expect(dependencies).toEqual([
      { capability: "CHAT", profile: "default-chat", agentProfile: undefined, required: true },
      { capability: "AGENT_RUN", profile: undefined, agentProfile: "script-dev-agent", required: true }
    ]);
  });

  it("keeps actiondock-ai out of normal plugin dependencies", () => {
    const dependencies = extractPluginDependenciesFromSource(
      'plugins.invoke("actiondock-ai", "chat", [:])',
      []
    );

    expect(dependencies).toEqual([]);
  });

  it("detects AI dependencies from Python plugin calls", () => {
    const dependencies = extractAiDependenciesFromSource(`
      result = plugins.invoke("actiondock-ai", "chat", {
        "modelProfile": "default-chat",
        "messages": []
      })
      agent = plugins.invoke("actiondock-ai", "agentRun", {
        "agentProfile": "script-dev-agent",
        "messages": []
      })
    `);

    expect(dependencies).toEqual([
      { capability: "CHAT", profile: "default-chat", agentProfile: undefined, required: true },
      { capability: "AGENT_RUN", profile: undefined, agentProfile: "script-dev-agent", required: true }
    ]);
  });
});
