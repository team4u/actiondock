import type { AiDependency } from "../shared/types";

const AI_INVOKE_PATTERN = /plugins\s*\.\s*invoke\s*\(\s*(["'`])actiondock-ai\1\s*,\s*(["'`])([^"'`]+)\2\s*,?\s*([\s\S]*?)\)/g;
const MODEL_PROFILE_PATTERN = /["'`]?modelProfile["'`]?\s*:\s*(["'`])([^"'`]+)\1/;
const AGENT_PROFILE_PATTERN = /["'`]?agentProfile["'`]?\s*:\s*(["'`])([^"'`]+)\1/;

const ACTION_CAPABILITY: Record<string, AiDependency["capability"]> = {
  chat: "CHAT",
  structured: "STRUCTURED_OUTPUT",
  embed: "EMBEDDING",
  agentRun: "AGENT_RUN"
};

export function extractAiDependenciesFromSource(source: string): AiDependency[] {
  if (!source.trim()) {
    return [];
  }

  const dependencies = new Map<string, AiDependency>();
  let match: RegExpExecArray | null;
  while ((match = AI_INVOKE_PATTERN.exec(source)) !== null) {
    const action = match[3]?.trim();
    const capability = action ? ACTION_CAPABILITY[action] : undefined;
    if (!capability) {
      continue;
    }
    const argsText = match[4] ?? "";
    const modelProfile = MODEL_PROFILE_PATTERN.exec(argsText)?.[2];
    const agentProfile = AGENT_PROFILE_PATTERN.exec(argsText)?.[2];
    const key = [capability, modelProfile ?? "", agentProfile ?? ""].join(":");
    dependencies.set(key, {
      capability,
      profile: modelProfile,
      agentProfile,
      required: true
    });
  }
  return [...dependencies.values()];
}
