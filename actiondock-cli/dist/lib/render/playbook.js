import { indent } from "./shared.js";
export function renderPlaybookList(items) {
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
export function summarizePlaybookList(items) {
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
export function renderPlaybookDetail(item) {
    const lines = [
        `Playbook: ${item.id}`,
        `Name: ${item.name}`,
        `Enabled: ${item.enabled === false ? "no" : "yes"}`,
        `Managed: ${item.managed ? "yes" : "no"}`
    ];
    if (item.description)
        lines.push(`Description: ${item.description}`);
    if (item.riskLevel)
        lines.push(`Risk: ${item.riskLevel}`);
    if (item.tags?.length)
        lines.push(`Tags: ${item.tags.join(", ")}`);
    if (item.repositoryIds?.length)
        lines.push(`Repositories: ${item.repositoryIds.join(", ")}`);
    if (item.knowledgeRefs?.length) {
        lines.push("Knowledge:");
        lines.push(...item.knowledgeRefs.map((ref) => {
            if (ref.type === "NOTE") {
                return `  NOTE ${ref.repositoryId}${ref.markdown ? ` - ${ref.markdown}` : ""}`;
            }
            return `  ${ref.type} ${ref.repositoryId}:${ref.path}`;
        }));
    }
    else {
        lines.push("KnowledgeRefs: 0");
    }
    if (item.scriptRefs?.length) {
        lines.push("Scripts:");
        lines.push(...item.scriptRefs.map((ref) => `  ${ref.scriptId}${ref.purpose ? ` - ${ref.purpose}` : ""}`));
    }
    else {
        lines.push("ScriptRefs: 0");
    }
    if (item.agentSkillRefs?.length) {
        lines.push("AgentSkills:");
        lines.push(...item.agentSkillRefs.map((ref) => `  ${ref.skillId}${ref.required ? " required" : " optional"}${ref.purpose ? ` - ${ref.purpose}` : ""}`));
    }
    else {
        lines.push("AgentSkillRefs: 0");
    }
    if (item.relatedPlaybookRefs?.length) {
        lines.push("RelatedPlaybooks:");
        lines.push(...item.relatedPlaybookRefs.map((ref) => `  ${ref.relation ?? "RELATED"} ${ref.playbookId}${ref.purpose ? ` - ${ref.purpose}` : ""}`));
    }
    else {
        lines.push("RelatedPlaybookRefs: 0");
    }
    lines.push("Guide:");
    lines.push(indent(item.guideMarkdown));
    if (item.stopConditions?.length) {
        lines.push("StopConditions:");
        lines.push(...item.stopConditions.map((condition) => `  - ${condition}`));
    }
    else {
        lines.push("StopConditions: 0");
    }
    return lines.join("\n");
}
export function renderPlaybookSession(session) {
    const lines = [
        `Session: ${session.id}`,
        `Playbook: ${session.playbookId}${session.playbookName ? ` (${session.playbookName})` : ""}`,
        `Status: ${session.status}`,
        `Phase: ${session.currentPhase}`
    ];
    if (session.agentName)
        lines.push(`Agent: ${session.agentName}`);
    if (session.agentRunId)
        lines.push(`AgentRun: ${session.agentRunId}`);
    if (session.riskLevelSnapshot)
        lines.push(`Risk: ${session.riskLevelSnapshot}`);
    if (session.finalSummary)
        lines.push(`Summary: ${session.finalSummary}`);
    if (session.failureReason)
        lines.push(`Failure: ${session.failureReason}`);
    return lines.join("\n");
}
export function renderPlaybookSessionDetail(detail, timeline = false) {
    if (!timeline) {
        const lines = [renderPlaybookSession(detail.session)];
        lines.push(`Events: ${detail.events?.length ?? 0}`);
        return lines.join("\n");
    }
    if (!detail.events || detail.events.length === 0) {
        return "没有 Trace 事件。";
    }
    return detail.events.map((event) => {
        const decision = event.decision ? ` ${event.decision}` : "";
        const ref = event.refId ? ` ${event.refType ?? "ref"}:${event.refId}` : "";
        const reason = event.reason ? ` - ${event.reason}` : event.message ? ` - ${event.message}` : "";
        return `[${event.phase}] ${event.type}${decision}${ref}${reason}`;
    }).join("\n");
}
