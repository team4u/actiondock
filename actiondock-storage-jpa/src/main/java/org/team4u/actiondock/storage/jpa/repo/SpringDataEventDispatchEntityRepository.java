package org.team4u.actiondock.storage.jpa.repo;

import org.springframework.data.jpa.repository.JpaRepository;
import org.team4u.actiondock.storage.jpa.entity.EventDispatchEntity;

import java.util.List;
import java.util.Optional;

public interface SpringDataEventDispatchEntityRepository extends JpaRepository<EventDispatchEntity, String> {
    Optional<EventDispatchEntity> findByTriggerIdAndIdempotencyKey(String triggerId, String idempotencyKey);

    List<EventDispatchEntity> findByEventIdOrderByCreatedAtAsc(String eventId);

    List<EventDispatchEntity> findByTriggerIdOrderByCreatedAtDesc(String triggerId);
}
