package org.team4u.actiondock.storage.jpa.repo;

import org.springframework.data.jpa.repository.JpaRepository;
import org.team4u.actiondock.storage.jpa.entity.EventTriggerEntity;

import java.util.List;

public interface SpringDataEventTriggerEntityRepository extends JpaRepository<EventTriggerEntity, String> {
    List<EventTriggerEntity> findAllByOrderByCreatedAtDesc();

    List<EventTriggerEntity> findBySourceIdOrderByCreatedAtDesc(String sourceId);

    List<EventTriggerEntity> findBySourceIdAndEnabledOrderByCreatedAtDesc(String sourceId, boolean enabled);

    List<EventTriggerEntity> findByRepositoryIdAndRepositoryEventSourceIdOrderByCreatedAtDesc(String repositoryId, String repositoryEventSourceId);
}
