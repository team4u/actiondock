package org.team4u.actiondock.domain.port;

import org.team4u.actiondock.domain.model.EventDispatchRecord;

import java.util.List;
import java.util.Optional;

public interface EventDispatchRepository {
    EventDispatchRecord save(EventDispatchRecord record);

    Optional<EventDispatchRecord> findById(String id);

    Optional<EventDispatchRecord> findByTriggerIdAndIdempotencyKey(String triggerId, String idempotencyKey);

    List<EventDispatchRecord> findByEventId(String eventId);

    List<EventDispatchRecord> findByTriggerId(String triggerId);
}
