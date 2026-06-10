import type {
  Playbook,
  PlaybookListItemSummary
} from "../types.js";
import { indent } from "./shared.js";

export function renderPlaybookList(items: Playbook[]): string {
  if (items.length === 0) {
    return "没有任务手册。";
  }
  return items.map((item) => {
    const name = item.name ? ` ${item.name}` : "";
    const risk = item.riskLevel ? ` risk=${item.riskLevel}` : "";
    const managed = item.managed ? " managed" : "";
    const enabled = item.enabled === false ? " disabled" : " enabled";
    return `${item.id}${name}${risk}${enabled}${managed}`;
  }).join("\n");
}

export function summarizePlaybookList(items: Playbook[]): PlaybookListItemSummary[] {
  return items.map((item) => ({
    id: item.id,
    name: item.name,
    description: item.description,
    tags: item.tags,
    riskLevel: item.riskLevel,
    repositoryIds: item.repositoryIds,
    enabled: item.enabled,
    managed: item.managed
  }));
}

export function renderPlaybookDetail(item: Playbook): string {
  const lines = [
    `Playbook: ${item.id}`,
    `Name: ${item.name}`,
    `Enabled: ${item.enabled === false ? "no" : "yes"}`,
    `Managed: ${item.managed ? "yes" : "no"}`
  ];
  if (item.description) lines.push(`Description: ${item.description}`);
  if (item.riskLevel) lines.push(`Risk: ${item.riskLevel}`);
  if (item.tags?.length) lines.push(`Tags: ${item.tags.join(", ")}`);
  if (item.repositoryIds?.length) lines.push(`Repositories: ${item.repositoryIds.join(", ")}`);
  if (item.knowledgeRefs?.length) {
    lines.push("Knowledge:");
    lines.push(...item.knowledgeRefs.map((ref) => {
      if (ref.type === "NOTE") {
        return `  NOTE ${ref.repositoryId}${ref.markdown ? ` - ${ref.markdown}` : ""}`;
      }
      return `  ${ref.type} ${ref.repositoryId}:${ref.path}`;
    }));
  } else {
    lines.push("KnowledgeRefs: 0");
  }
  if (item.scriptRefs?.length) {
    lines.push("Scripts:");
    lines.push(...item.scriptRefs.map((ref) => `  ${ref.scriptId}${ref.purpose ? ` - ${ref.purpose}` : ""}`));
  } else {
    lines.push("ScriptRefs: 0");
  }
  if (item.agentSkillRefs?.length) {
    lines.push("AgentSkills:");
    lines.push(...item.agentSkillRefs.map((ref) => `  ${ref.skillId}${ref.required ? " required" : " optional"}${ref.purpose ? ` - ${ref.purpose}` : ""}`));
  } else {
    lines.push("AgentSkillRefs: 0");
  }
  if (item.relatedPlaybookRefs?.length) {
    lines.push("RelatedPlaybooks:");
    lines.push(...item.relatedPlaybookRefs.map((ref) => `  ${ref.relation ?? "RELATED"} ${ref.playbookId}${ref.purpose ? ` - ${ref.purpose}` : ""}`));
  } else {
    lines.push("RelatedPlaybookRefs: 0");
  }
  lines.push("Guide:");
  lines.push(indent(item.guideMarkdown));
  if (item.stopConditions?.length) {
    lines.push("StopConditions:");
    lines.push(...item.stopConditions.map((condition) => `  - ${condition}`));
  } else {
    lines.push("StopConditions: 0");
  }
  return lines.join("\n");
}
