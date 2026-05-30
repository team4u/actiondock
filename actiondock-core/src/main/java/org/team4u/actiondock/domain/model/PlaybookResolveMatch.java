package org.team4u.actiondock.domain.model;

public record PlaybookResolveMatch(
        int score,
        Playbook playbook,
        PlaybookGroup group,
        PlaybookRiskLevel riskLevel,
        int knowledgeRefCount,
        int scriptRefCount
) {
}
