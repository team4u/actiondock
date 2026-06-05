package org.team4u.actiondock.web.playbook;

public record PlaybookTraceEventAppendResponse(
        String eventId,
        String sessionId,
        long sequence
) {
}
