package org.team4u.actiondock.domain.port;

import org.team4u.actiondock.domain.model.EventSourceDefinition;

import java.util.List;
import java.util.Optional;

public interface EventSourceRepository {
    EventSourceDefinition save(EventSourceDefinition source);

    Optional<EventSourceDefinition> findById(String id);

    Optional<EventSourceDefinition> findByKey(String key);

    List<EventSourceDefinition> findAll();

    void deleteById(String id);
}
