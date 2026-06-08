package org.team4u.actiondock.domain.port;

import org.team4u.actiondock.domain.model.PlaybookSession;
import org.team4u.actiondock.domain.model.PlaybookTraceEvent;

import java.util.List;
import java.util.Optional;

public interface PlaybookSessionRepository {
    PlaybookSession saveSession(PlaybookSession session);

    Optional<PlaybookSession> findSessionById(String id);

    List<PlaybookSession> findAllSessions();

    PlaybookTraceEvent saveEvent(PlaybookTraceEvent event);

    Optional<PlaybookTraceEvent> findEventBySessionIdAndExternalEventId(String sessionId, String externalEventId);

    List<PlaybookTraceEvent> findEventsBySessionId(String sessionId);

    long nextSequence(String sessionId);
}
