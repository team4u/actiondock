package org.team4u.actiondock.web.playbook;

import java.time.LocalDateTime;
import java.util.List;

public record PlaybookGroupView(
        String id,
        String name,
        String description,
        List<String> tags,
        List<String> defaultRepositoryIds,
        boolean enabled,
        boolean managed,
        LocalDateTime createdAt,
        LocalDateTime updatedAt,
        long playbookCount
) {
}
