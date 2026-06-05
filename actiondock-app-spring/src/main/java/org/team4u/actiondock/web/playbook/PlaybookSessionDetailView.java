package org.team4u.actiondock.web.playbook;

import org.team4u.actiondock.domain.model.PlaybookSession;
import org.team4u.actiondock.domain.model.PlaybookTraceEvent;

import java.util.List;

public record PlaybookSessionDetailView(
        PlaybookSession session,
        List<PlaybookTraceEvent> events
) {
}
