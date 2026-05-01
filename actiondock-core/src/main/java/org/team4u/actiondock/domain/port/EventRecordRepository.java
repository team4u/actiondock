package org.team4u.actiondock.domain.port;

import org.team4u.actiondock.domain.model.EventRecord;

import java.util.List;
import java.util.Optional;

public interface EventRecordRepository {
    EventRecord save(EventRecord record);

    Optional<EventRecord> findById(String id);

    List<EventRecord> findAll();

    List<EventRecord> findBySourceId(String sourceId);
}
