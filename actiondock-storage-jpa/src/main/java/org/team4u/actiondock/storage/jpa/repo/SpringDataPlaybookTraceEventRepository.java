package org.team4u.actiondock.storage.jpa.repo;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.team4u.actiondock.storage.jpa.entity.PlaybookTraceEventEntity;

import java.util.List;
import java.util.Optional;

public interface SpringDataPlaybookTraceEventRepository extends JpaRepository<PlaybookTraceEventEntity, String> {
    Optional<PlaybookTraceEventEntity> findBySessionIdAndExternalEventId(String sessionId, String externalEventId);

    List<PlaybookTraceEventEntity> findBySessionIdOrderBySequenceAsc(String sessionId);

    @Query("select coalesce(max(e.sequence), 0) from PlaybookTraceEventEntity e where e.sessionId = :sessionId")
    long findMaxSequenceBySessionId(@Param("sessionId") String sessionId);
}
