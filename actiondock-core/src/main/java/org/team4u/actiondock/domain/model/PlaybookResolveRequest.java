package org.team4u.actiondock.domain.model;

import java.util.List;

public record PlaybookResolveRequest(
        String intent,
        String repositoryId,
        String groupId,
        List<String> tags
) {
}
