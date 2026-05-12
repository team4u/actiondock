package org.team4u.actiondock.web.script;

import java.time.LocalDateTime;

public record ScriptPublicationView(
        boolean published,
        boolean dirty,
        Integer publishedVersion,
        LocalDateTime publishedAt
) {
}
