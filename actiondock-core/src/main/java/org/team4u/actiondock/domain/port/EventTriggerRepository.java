package org.team4u.actiondock.domain.port;

import org.team4u.actiondock.domain.model.EventTrigger;

import java.util.List;
import java.util.Optional;

public interface EventTriggerRepository {
    EventTrigger save(EventTrigger trigger);

    Optional<EventTrigger> findById(String id);

    List<EventTrigger> findAll();

    List<EventTrigger> findBySourceId(String sourceId);

    List<EventTrigger> findBySourceIdAndEnabled(String sourceId, boolean enabled);

    void deleteById(String id);
}
