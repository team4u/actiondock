package org.team4u.actiondock.domain.model;

import java.util.List;

public record PlaybookGuideView(
        Playbook playbook,
        PlaybookGroup group,
        List<PlaybookKnowledgeRef> knowledgeRefs,
        List<PlaybookScriptRef> scriptRefs,
        String guideMarkdown,
        List<String> stopConditions
) {
}
