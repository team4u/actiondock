package org.team4u.actiondock.storage.jpa.repo;

import org.springframework.data.jpa.repository.JpaRepository;
import org.team4u.actiondock.storage.jpa.entity.EventSourceEntity;

import java.util.List;
import java.util.Optional;

public interface SpringDataEventSourceEntityRepository extends JpaRepository<EventSourceEntity, String> {
    Optional<EventSourceEntity> findBySourceKey(String sourceKey);

    List<EventSourceEntity> findAllByOrderByCreatedAtDesc();
}
